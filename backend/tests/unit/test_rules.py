from copy import deepcopy
from pathlib import Path

import pytest

from landview_core.rules import (
    LegalStatus,
    RulePackError,
    assert_usable_for_solving,
    diff_rule_packs,
    load_rule_pack,
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
