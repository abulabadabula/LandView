"""Versioned planning rule packs with explicit legal status and planner sign-off."""
import json
from datetime import date
from hashlib import sha256
from math import isfinite
from enum import StrEnum
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from pydantic.alias_generators import to_camel


class RulePackError(ValueError):
    """Raised when a rule pack cannot be trusted or loaded."""


class LegalStatus(StrEnum):
    DRAFT = "DRAFT"
    CURRENT = "CURRENT"
    SUPERSEDED = "SUPERSEDED"


class RuleOperator(StrEnum):
    MAX = "max"
    MIN = "min"
    EQUALS = "equals"
    BOOLEAN = "boolean"
    INFORMATIONAL = "informational"


class PlanningRule(BaseModel):
    """A single rule; interpretation is kept in data rather than hard-coded in the solver."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-z0-9][a-z0-9_.-]*$")
    title: str = Field(min_length=1)
    category: str = Field(min_length=1)
    operator: RuleOperator
    value: Any = None
    metric_key: str | None = Field(default=None, pattern=r"^[a-zA-Z][a-zA-Z0-9_.-]*$")
    unit: str | None = None
    clause_ref: str | None = None
    applicability: dict[str, Any] = Field(default_factory=dict)
    source_url: str | None = None
    notes: str | None = None


class RulePack(BaseModel):
    """One council, plan version, zone and development typology."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(pattern=r"^1\.0$")
    pack_id: str = Field(pattern=r"^[a-z0-9][a-z0-9_.-]*$")
    council: str = Field(min_length=1)
    plan_name: str = Field(min_length=1)
    plan_version: str | None = None
    legal_status: LegalStatus
    zone: str = Field(min_length=1)
    dwelling_typology: str = Field(min_length=1)
    pack_version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    effective_from: date | None = None
    reviewed_by: str | None = None
    reviewed_at: date | None = None
    source_url: str | None = None
    disclaimer: str = Field(min_length=1)
    rules: list[PlanningRule] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_pack_integrity(self) -> "RulePack":
        ids = [rule.id for rule in self.rules]
        duplicates = sorted({rule_id for rule_id in ids if ids.count(rule_id) > 1})
        if duplicates:
            raise ValueError("Duplicate rule id(s): " + ", ".join(duplicates))

        if self.legal_status is LegalStatus.CURRENT:
            missing = []
            if not self.plan_version:
                missing.append("plan_version")
            if not self.effective_from:
                missing.append("effective_from")
            if not self.reviewed_by:
                missing.append("reviewed_by")
            if not self.reviewed_at:
                missing.append("reviewed_at")
            if not self.rules:
                missing.append("at least one rule")
            if missing:
                raise ValueError(
                    "CURRENT rule packs require " + ", ".join(missing) + "; do not mark an unverified pack CURRENT"
                )
            missing_rule_details = [
                rule.id
                for rule in self.rules
                if rule.value is None or not rule.clause_ref or not rule.source_url or (rule.operator is not RuleOperator.INFORMATIONAL and not rule.metric_key)
            ]
            if missing_rule_details:
                raise ValueError(
                    "CURRENT rules require value, clause_ref, source_url and a metric_key for executable operators: "
                    + ", ".join(missing_rule_details)
                )
        return self


DEFAULT_SCHEMA_PATH = Path(__file__).resolve().parents[2] / "rules" / "schema" / "rule-pack.schema.json"


def load_rule_pack(
    path: str | Path,
    schema_path: str | Path | None = None,
) -> RulePack:
    """Load YAML only after JSON Schema validation, then enforce cross-field rules."""
    source_path = Path(path)
    schema_file = Path(schema_path) if schema_path else DEFAULT_SCHEMA_PATH

    try:
        data = yaml.safe_load(source_path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise RulePackError(f"Unable to read YAML rule pack {source_path}: {exc}") from exc

    if not isinstance(data, dict):
        raise RulePackError(f"Rule pack {source_path} must contain a YAML object at the top level")

    try:
        schema = json.loads(schema_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RulePackError(f"Unable to read rule-pack schema {schema_file}: {exc}") from exc

    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(data), key=lambda error: (str(error.absolute_path), error.message))
    if errors:
        details = []
        for error in errors:
            location = ".".join(str(part) for part in error.absolute_path) or "<root>"
            details.append(f"{location}: {error.message}")
        raise RulePackError("Schema validation failed: " + "; ".join(details))

    try:
        return RulePack.model_validate(data)
    except ValidationError as exc:
        details = "; ".join(
            f"{'.'.join(str(part) for part in error['loc']) or '<root>'}: {error['msg']}"
            for error in exc.errors()
        )
        raise RulePackError("Rule-pack integrity validation failed: " + details) from exc


def assert_usable_for_solving(pack: RulePack) -> None:
    """Fail closed: draft or superseded rules must never drive a design proposal."""
    if pack.legal_status is not LegalStatus.CURRENT:
        raise RulePackError(
            f"Rule pack {pack.pack_id} is {pack.legal_status.value}; only planner-reviewed CURRENT packs can be used"
        )


def diff_rule_packs(old: RulePack, new: RulePack) -> dict[str, Any]:
    """Return a stable machine-readable diff suitable for a review screen or CI artifact."""
    old_by_id = {rule.id: rule.model_dump(mode="json") for rule in old.rules}
    new_by_id = {rule.id: rule.model_dump(mode="json") for rule in new.rules}

    added = sorted(new_by_id.keys() - old_by_id.keys())
    removed = sorted(old_by_id.keys() - new_by_id.keys())
    changed: dict[str, dict[str, dict[str, Any]]] = {}
    for rule_id in sorted(old_by_id.keys() & new_by_id.keys()):
        before = old_by_id[rule_id]
        after = new_by_id[rule_id]
        fields = sorted(set(before) | set(after))
        delta = {
            field: {"from": before.get(field), "to": after.get(field)}
            for field in fields
            if before.get(field) != after.get(field)
        }
        if delta:
            changed[rule_id] = delta

    old_metadata = {
        "pack_id": old.pack_id,
        "pack_version": old.pack_version,
        "plan_version": old.plan_version,
        "legal_status": old.legal_status.value,
        "zone": old.zone,
        "dwelling_typology": old.dwelling_typology,
    }
    new_metadata = {
        "pack_id": new.pack_id,
        "pack_version": new.pack_version,
        "plan_version": new.plan_version,
        "legal_status": new.legal_status.value,
        "zone": new.zone,
        "dwelling_typology": new.dwelling_typology,
    }
    return {
        "from": old_metadata,
        "to": new_metadata,
        "added_rules": added,
        "removed_rules": removed,
        "changed_rules": changed,
    }


class RuleCheckStatus(StrEnum):
    PASS = "PASS"
    FAIL = "FAIL"
    NOT_EVALUATED = "NOT_EVALUATED"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class RulePackSummary(BaseModel):
    """Safe rule registry listing; does not expose server filesystem paths."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    pack_id: str
    council: str
    plan_name: str
    plan_version: str | None = None
    legal_status: LegalStatus
    zone: str
    dwelling_typology: str
    pack_version: str
    rule_count: int
    eligible_for_solving: bool
    status_note: str


class RulePackEvaluationRequest(BaseModel):
    """Deterministic scalar inputs extracted by upstream geometry/site engines."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    pack_id: str = Field(pattern=r"^[a-z0-9][a-z0-9_.-]*$")
    measurements: dict[str, Any] = Field(default_factory=dict)


class RuleEvaluationCheck(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    rule_id: str
    title: str
    category: str
    status: RuleCheckStatus
    operator: RuleOperator
    metric_key: str | None = None
    actual: Any = None
    limit: Any = None
    unit: str | None = None
    clause_ref: str | None = None
    source_url: str | None = None
    message: str


class RulePackEvaluationResult(BaseModel):
    """Auditable outcome with rule-pack and input hashes for reproducibility."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    pack_id: str
    pack_version: str
    legal_status: LegalStatus
    plan_version: str | None = None
    zone: str
    reviewed_by: str | None = None
    reviewed_at: date | None = None
    rule_source_url: str | None = None
    rules_hash: str
    inputs_hash: str
    overall_status: str
    checks: list[RuleEvaluationCheck]
    notes: list[str] = Field(default_factory=list)


def _stable_hash(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return sha256(payload.encode("utf-8")).hexdigest()


def _numeric(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(float(value))


def _rule_check(rule: PlanningRule, measurements: dict[str, Any], *, pack_usable: bool) -> RuleEvaluationCheck:
    actual = measurements.get(rule.metric_key) if rule.metric_key else None
    details = {
        "rule_id": rule.id,
        "title": rule.title,
        "category": rule.category,
        "operator": rule.operator,
        "metric_key": rule.metric_key,
        "actual": actual,
        "limit": rule.value,
        "unit": rule.unit,
        "clause_ref": rule.clause_ref,
        "source_url": rule.source_url,
    }

    if not pack_usable:
        return RuleEvaluationCheck(
            **details,
            status=RuleCheckStatus.NOT_EVALUATED,
            message="The rule pack is not CURRENT and planner-reviewed; no rule is evaluated.",
        )
    if rule.operator is RuleOperator.INFORMATIONAL:
        return RuleEvaluationCheck(
            **details,
            status=RuleCheckStatus.NOT_EVALUATED,
            message=rule.notes or "Informational rule only; it does not produce a pass/fail result.",
        )
    if not rule.metric_key:
        return RuleEvaluationCheck(
            **details,
            status=RuleCheckStatus.NOT_EVALUATED,
            message="This rule has no executable metric_key mapping.",
        )
    if rule.metric_key not in measurements:
        return RuleEvaluationCheck(
            **details,
            status=RuleCheckStatus.NOT_EVALUATED,
            message=f"Required measurement '{rule.metric_key}' was not supplied by a deterministic engine.",
        )
    if rule.value is None:
        return RuleEvaluationCheck(
            **details,
            status=RuleCheckStatus.NOT_EVALUATED,
            message="This rule has no configured threshold/value.",
        )

    passed: bool | None = None
    if rule.operator is RuleOperator.MAX:
        if _numeric(actual) and _numeric(rule.value):
            passed = float(actual) <= float(rule.value) + 1e-9
        else:
            return RuleEvaluationCheck(
                **details,
                status=RuleCheckStatus.NOT_EVALUATED,
                message="The max operator requires finite numeric measurement and rule value.",
            )
    elif rule.operator is RuleOperator.MIN:
        if _numeric(actual) and _numeric(rule.value):
            passed = float(actual) >= float(rule.value) - 1e-9
        else:
            return RuleEvaluationCheck(
                **details,
                status=RuleCheckStatus.NOT_EVALUATED,
                message="The min operator requires finite numeric measurement and rule value.",
            )
    elif rule.operator is RuleOperator.BOOLEAN:
        if isinstance(actual, bool) and isinstance(rule.value, bool):
            passed = actual is rule.value
        else:
            return RuleEvaluationCheck(
                **details,
                status=RuleCheckStatus.NOT_EVALUATED,
                message="The boolean operator requires boolean measurement and rule value.",
            )
    elif rule.operator is RuleOperator.EQUALS:
        if type(actual) is not type(rule.value) and not (_numeric(actual) and _numeric(rule.value)):
            passed = False
        else:
            passed = actual == rule.value
    else:
        return RuleEvaluationCheck(
            **details,
            status=RuleCheckStatus.NOT_EVALUATED,
            message="This rule operator is not supported by the deterministic evaluator.",
        )

    status = RuleCheckStatus.PASS if passed else RuleCheckStatus.FAIL
    operator_display = {
        RuleOperator.MAX: "≤",
        RuleOperator.MIN: "≥",
        RuleOperator.EQUALS: "==",
        RuleOperator.BOOLEAN: "is",
    }.get(rule.operator, rule.operator.value)
    return RuleEvaluationCheck(
        **details,
        status=status,
        message=(
            f"Measured value satisfies the configured rule ({operator_display} {rule.value}{' ' + rule.unit if rule.unit else ''})."
            if passed
            else f"Measured value breaches the configured rule ({operator_display} {rule.value}{' ' + rule.unit if rule.unit else ''})."
        ),
    )


def evaluate_rule_pack(pack: RulePack, measurements: dict[str, Any]) -> RulePackEvaluationResult:
    """Evaluate only a CURRENT reviewed pack; draft packs always return BLOCKED/NOT_EVALUATED."""
    is_usable = pack.legal_status is LegalStatus.CURRENT
    checks = [_rule_check(rule, measurements, pack_usable=is_usable) for rule in pack.rules]
    has_fail = any(check.status is RuleCheckStatus.FAIL for check in checks)
    has_unevaluated = any(check.status is RuleCheckStatus.NOT_EVALUATED for check in checks)
    if not is_usable or not checks or has_unevaluated:
        overall_status = "FAIL" if has_fail else "BLOCKED"
    else:
        overall_status = "FAIL" if has_fail else "PASS"

    notes = [
        pack.disclaimer,
        "Scalar measurements must be produced by deterministic site/geometry engines and retain their data provenance.",
        "This evaluation covers only rules in this pack; absence of a rule is not evidence that the corresponding planning control does not apply.",
    ]
    if not is_usable:
        notes.append("This draft/superseded pack was not executed. All rule checks are NOT_EVALUATED.")
    if has_unevaluated:
        notes.append("At least one configured rule could not be evaluated; do not treat the matrix as a complete pass.")
    return RulePackEvaluationResult(
        pack_id=pack.pack_id,
        pack_version=pack.pack_version,
        legal_status=pack.legal_status,
        plan_version=pack.plan_version,
        zone=pack.zone,
        reviewed_by=pack.reviewed_by,
        reviewed_at=pack.reviewed_at,
        rule_source_url=pack.source_url,
        rules_hash=_stable_hash(pack.model_dump(mode="json")),
        inputs_hash=_stable_hash(measurements),
        overall_status=overall_status,
        checks=checks,
        notes=notes,
    )


def list_registered_rule_pack_summaries(directory: str | Path | None = None) -> list[RulePackSummary]:
    """Return validated rule packs available to the API; corrupt packs are excluded from use."""
    root = Path(directory) if directory else DEFAULT_SCHEMA_PATH.parent.parent
    summaries: list[RulePackSummary] = []
    for path in sorted(root.rglob("*.yaml")):
        try:
            pack = load_rule_pack(path)
        except RulePackError:
            continue
        usable = pack.legal_status is LegalStatus.CURRENT
        summaries.append(
            RulePackSummary(
                pack_id=pack.pack_id,
                council=pack.council,
                plan_name=pack.plan_name,
                plan_version=pack.plan_version,
                legal_status=pack.legal_status,
                zone=pack.zone,
                dwelling_typology=pack.dwelling_typology,
                pack_version=pack.pack_version,
                rule_count=len(pack.rules),
                eligible_for_solving=usable,
                status_note=(
                    "Planner-reviewed CURRENT pack."
                    if usable
                    else "Draft or superseded; cannot drive design or compliance decisions."
                ),
            )
        )
    return summaries


def load_registered_rule_pack(pack_id: str, directory: str | Path | None = None) -> RulePack:
    """Resolve an ID from the on-disk registry; callers cannot supply arbitrary file paths."""
    root = Path(directory) if directory else DEFAULT_SCHEMA_PATH.parent.parent
    for path in sorted(root.rglob("*.yaml")):
        try:
            pack = load_rule_pack(path)
        except RulePackError:
            continue
        if pack.pack_id == pack_id:
            return pack
    raise RulePackError(f"Unknown or invalid rule pack id: {pack_id}")
