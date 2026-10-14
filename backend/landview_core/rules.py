"""Versioned planning rule packs with explicit legal status and planner sign-off."""
import json
from datetime import date
from enum import StrEnum
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator


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
                if rule.value is None or not rule.clause_ref or not rule.source_url
            ]
            if missing_rule_details:
                raise ValueError(
                    "CURRENT rules require value, clause_ref and source_url: "
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
