from __future__ import annotations

import json
from pathlib import Path

import jsonschema
import pytest
from pydantic import ValidationError

from app.schemas_house import (
    HouseDesignCandidate,
    HouseDesignFloorPlate,
    HouseDesignSpec,
    HouseDesignValidationRequest,
    HouseSiteDesignConstraints,
    HouseTerrainSample,
)
from app.services.house_design_validation import validate_house_design

REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMA_PATH = REPO_ROOT / "docs" / "schemas" / "HouseDesignSpec.schema.json"
EXAMPLE_PATH = REPO_ROOT / "docs" / "examples" / "house-design-input.example.json"

EXAMPLE_INPUT = {
    "storeys": 2,
    "bedrooms": 4,
    "grossFloorAreaTargetM2": 200,
    "style": "Contemporary",
    "roof": "Gable roof",
    "garage": "Double garage",
    "terrainAdaptation": "Adapt to terrain",
}


def make_request(*, rules_confirmed: bool = True, footprint_offset: float = 2.0):
    spec = HouseDesignSpec.model_validate(
        {**EXAMPLE_INPUT, "grossFloorAreaBasis": "excludesGarage"}
    )
    ground_ring = [
        (footprint_offset, footprint_offset),
        (footprint_offset + 10, footprint_offset),
        (footprint_offset + 10, footprint_offset + 10),
        (footprint_offset, footprint_offset + 10),
    ]
    upper_ring = list(ground_ring)
    candidate = HouseDesignCandidate(
        candidateId="candidate-test-001",
        storeys=2,
        bedrooms=4,
        grossFloorAreaM2=200,
        grossFloorAreaBasis="excludesGarage",
        overallHeightM=6.5,
        terrainAdaptationApplied=True,
        floorPlates=[
            HouseDesignFloorPlate(
                level=0,
                footprintNztm=ground_ring,
                grossFloorAreaM2=100,
                finishedFloorLevelM=100.0,
            ),
            HouseDesignFloorPlate(
                level=1,
                footprintNztm=upper_ring,
                grossFloorAreaM2=100,
                finishedFloorLevelM=103.0,
            ),
        ],
    )
    site_data = {
        "parcelBoundaryNztm": [(0, 0), (30, 0), (30, 30), (0, 30)],
        "buildableAreasNztm": [[(1, 1), (29, 1), (29, 29), (1, 29)]],
        "planningRulesConfirmed": rules_confirmed,
        "unverifiedRulesRemain": not rules_confirmed,
        "maxStoreys": 2,
        "maxBuildingHeightM": 8.0,
        "maxSiteCoverageRatio": 0.5,
        "minGrossFloorAreaM2": 150,
        "maxGrossFloorAreaM2": 250,
        "grossFloorAreaBasis": "excludesGarage",
        "maxCutFillDepthM": 1.0,
        "terrainSource": "unit-test-grid",
        "terrainVerticalDatum": "NZVD2016",
        "terrainSamples": [
            HouseTerrainSample(nztmE=3, nztmN=3, elevationM=99.5),
            HouseTerrainSample(nztmE=5, nztmN=5, elevationM=100.0),
            HouseTerrainSample(nztmE=8, nztmN=8, elevationM=100.5),
        ],
    }
    if rules_confirmed:
        site_data.update(
            {
                "ruleSourceName": "Unit-test planning rule set",
                "ruleSourceVersion": "2026-01",
                "ruleSourceUrl": "https://example.com/planning-rules",
                "unverifiedRulesRemain": False,
            }
        )
    site = HouseSiteDesignConstraints(**site_data)
    return HouseDesignValidationRequest(
        spec=spec,
        candidate=candidate,
        siteConstraints=site,
    )


def test_house_design_example_passes_json_schema_and_pydantic():
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    example = json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))

    jsonschema.Draft202012Validator.check_schema(schema)
    jsonschema.validate(instance=example, schema=schema)

    parsed = HouseDesignSpec.model_validate(example)
    assert parsed.storeys == 2
    assert parsed.bedrooms == 4
    assert parsed.gross_floor_area_target_m2 == 200
    assert parsed.style == "Contemporary"
    assert parsed.roof == "Gable roof"
    assert parsed.garage == "Double garage"
    assert parsed.terrain_adaptation == "Adapt to terrain"


def test_house_design_spec_rejects_unknown_fields():
    with pytest.raises(ValidationError):
        HouseDesignSpec.model_validate({**EXAMPLE_INPUT, "inventedDimension": 12})


def test_fully_supplied_rule_data_can_pass_supported_checks():
    result = validate_house_design(make_request())
    assert result.overall_status == "PASS"
    assert result.model_generated is False
    assert all(
        check.status in {"PASS", "NOT_APPLICABLE"}
        for check in result.checks
        if check.severity == "HARD"
    )


def test_missing_verified_planning_rules_blocks_a_pass():
    result = validate_house_design(make_request(rules_confirmed=False))
    assert result.overall_status == "BLOCKED"
    assert any(
        check.code == "PLANNING_RULE_COMPLETENESS" and check.status == "NOT_EVALUATED"
        for check in result.checks
    )


def test_footprint_outside_the_parcel_fails_hard_validation():
    request = make_request(footprint_offset=25)
    result = validate_house_design(request)
    assert result.overall_status == "FAIL"
    assert any(check.code == "WITHIN_PARCEL" and check.status == "FAIL" for check in result.checks)


def test_unknown_gfa_basis_does_not_claim_target_compliance():
    request = make_request()
    request.spec.gross_floor_area_basis = None
    result = validate_house_design(request)
    target_check = next(check for check in result.checks if check.code == "GFA_DESIGN_TARGET")
    assert target_check.status == "NOT_EVALUATED"
    assert "garage" in target_check.message
