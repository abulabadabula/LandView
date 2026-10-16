from copy import deepcopy
from pathlib import Path

import pytest

from landview_core.rules import (
    LegalStatus,
    RulePackError,
    assert_usable_for_solving,
    diff_rule_packs,
    load_rule_pack,
    PlanningRule,
    RuleOperator,
    RulePack,
    RuleCheckStatus,
    evaluate_rule_pack,
    list_registered_rule_pack_summaries,
)

ROOT = Path(__file__).resolve().parents[3]
DRAFT_PACK = ROOT / "rules" / "auckland" / "draft" / "single-dwelling.yaml"


def test_draft_rule_pack_loads_but_is_not_eligible_for_solving():
    pack = load_rule_pack(DRAFT_PACK)
    assert pack.legal_status is LegalStatus.DRAFT
    assert pack.rules == []
    with pytest.raises(RulePackError, match="only planner-reviewed CURRENT"):
        assert_usable_for_solving(pack)


def test_lint_rejects_unknown_fields(tmp_path):
    content = DRAFT_PACK.read_text(encoding="utf-8").replace(
        "pack_version: 0.1.0",
        "pack_version: 0.1.0\nmade_up_planning_value: 8.0",
    )
    candidate = tmp_path / "invalid.yaml"
    candidate.write_text(content, encoding="utf-8")
    with pytest.raises(RulePackError, match="(?i)additional properties"):
        load_rule_pack(candidate)


def test_lint_rejects_current_pack_without_planner_signoff(tmp_path):
    content = DRAFT_PACK.read_text(encoding="utf-8").replace(
        "legal_status: DRAFT", "legal_status: CURRENT"
    )
    candidate = tmp_path / "unsigned.yaml"
    candidate.write_text(content, encoding="utf-8")
    with pytest.raises(RulePackError, match="Schema validation failed"):
        load_rule_pack(candidate)


def test_rule_pack_diff_reports_added_removed_and_changed_rules():
    old = load_rule_pack(DRAFT_PACK)
    old_data = old.model_dump(mode="python")
    old_data["rules"] = [
        {
            "id": "coverage.max",
            "title": "Building coverage",
            "category": "coverage",
            "operator": "max",
            "value": 0.4,
            "unit": "ratio",
            "clause_ref": None,
            "applicability": {},
            "source_url": None,
            "notes": None,
        },
        {
            "id": "permeability.min",
            "title": "Permeability",
            "category": "permeability",
            "operator": "min",
            "value": 0.35,
        },
    ]
    old_pack = old.__class__.model_validate(old_data)

    new_data = deepcopy(old_data)
    new_data["pack_version"] = "0.2.0"
    new_data["rules"][0]["value"] = 0.45
    new_data["rules"] = new_data["rules"][:1] + [
        {
            "id": "setback.front",
            "title": "Front yard setback",
            "category": "setback",
            "operator": "min",
            "value": 3.0,
            "unit": "m",
        }
    ]
    new_pack = old.__class__.model_validate(new_data)

    diff = diff_rule_packs(old_pack, new_pack)
    assert diff["added_rules"] == ["setback.front"]
    assert diff["removed_rules"] == ["permeability.min"]
    assert diff["changed_rules"]["coverage.max"]["value"] == {"from": 0.4, "to": 0.45}
    assert diff["to"]["pack_version"] == "0.2.0"



def _current_pack(rules: list[PlanningRule]) -> RulePack:
    from datetime import date

    return RulePack(
        schema_version="1.0",
        pack_id="test-current-pack",
        council="Synthetic test council",
        plan_name="Synthetic planning rules",
        plan_version="test-2026",
        legal_status=LegalStatus.CURRENT,
        zone="TEST_ZONE",
        dwelling_typology="test_house",
        pack_version="1.0.0",
        effective_from=date(2026, 1, 1),
        reviewed_by="Test planner",
        reviewed_at=date(2026, 1, 2),
        source_url="https://example.com/test-plan",
        disclaimer="Synthetic unit-test rule pack only; not legal planning advice.",
        rules=rules,
    )


def test_draft_pack_evaluation_is_blocked_and_is_auditable():
    pack = load_rule_pack(DRAFT_PACK)
    result = evaluate_rule_pack(pack, {"max_height_m": 6.5})

    assert result.overall_status == "BLOCKED"
    assert result.legal_status is LegalStatus.DRAFT
    assert result.checks == []
    assert len(result.rules_hash) == 64
    assert len(result.inputs_hash) == 64
    assert any("was not executed" in note for note in result.notes)


def test_current_rule_pack_evaluates_metrics_deterministically():
    pack = _current_pack(
        [
            PlanningRule(
                id="height.max",
                title="Maximum building height",
                category="height",
                operator=RuleOperator.MAX,
                value=8.0,
                metric_key="overall_height_m",
                unit="m",
                clause_ref="TEST-H1",
                source_url="https://example.com/test-plan#H1",
            ),
            PlanningRule(
                id="setback.front",
                title="Front yard setback",
                category="setback",
                operator=RuleOperator.MIN,
                value=3.0,
                metric_key="front_setback_m",
                unit="m",
                clause_ref="TEST-S1",
                source_url="https://example.com/test-plan#S1",
            ),
        ]
    )

    result = evaluate_rule_pack(pack, {"overall_height_m": 7.2, "front_setback_m": 2.5})

    assert result.overall_status == "FAIL"
    assert [check.status for check in result.checks] == [RuleCheckStatus.PASS, RuleCheckStatus.FAIL]
    assert all(check.clause_ref for check in result.checks)
    assert all(check.source_url for check in result.checks)


def test_missing_measurement_blocks_a_complete_rule_pack_pass():
    pack = _current_pack(
        [
            PlanningRule(
                id="coverage.max",
                title="Maximum site coverage",
                category="coverage",
                operator=RuleOperator.MAX,
                value=0.4,
                metric_key="site_coverage_ratio",
                unit="ratio",
                clause_ref="TEST-C1",
                source_url="https://example.com/test-plan#C1",
            )
        ]
    )

    result = evaluate_rule_pack(pack, {})

    assert result.overall_status == "BLOCKED"
    assert result.checks[0].status is RuleCheckStatus.NOT_EVALUATED
    assert "not supplied" in result.checks[0].message


def test_current_rule_pack_requires_executable_metric_keys():
    with pytest.raises(ValueError, match="metric_key"):
        _current_pack(
            [
                PlanningRule(
                    id="height.max",
                    title="Maximum building height",
                    category="height",
                    operator=RuleOperator.MAX,
                    value=8.0,
                    clause_ref="TEST-H1",
                    source_url="https://example.com/test-plan#H1",
                )
            ]
        )


def test_registry_exposes_draft_pack_as_not_eligible():
    summaries = list_registered_rule_pack_summaries(ROOT / "rules")
    summary = next(item for item in summaries if item.pack_id == "auckland-unconfigured-single-dwelling")

    assert summary.legal_status is LegalStatus.DRAFT
    assert summary.eligible_for_solving is False
    assert summary.rule_count == 0
