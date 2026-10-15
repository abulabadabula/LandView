from __future__ import annotations

from typing import Annotated, Literal

from pydantic import AnyUrl, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

from app.schemas import CamelModel

FiniteFloat = Annotated[float, Field(allow_inf_nan=False)]
Ring2D = Annotated[list[tuple[FiniteFloat, FiniteFloat]], Field(min_length=3)]
GfaBasis = Literal["includesGarage", "excludesGarage"]
RuleCode = Literal[
    "SETBACK_ENVELOPE",
    "MAX_STOREYS",
    "MAX_BUILDING_HEIGHT",
    "MAX_SITE_COVERAGE",
    "GFA_RANGE",
]
CheckStatus = Literal["PASS", "FAIL", "NOT_EVALUATED", "NOT_APPLICABLE"]
CheckSeverity = Literal["HARD", "DESIGN_TARGET"]


class HouseDesignSpec(CamelModel):
    """User intent only; this model is not a house geometry or a building-consent design."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )

    schema_version: Literal["1.0.0"] = "1.0.0"
    storeys: int = Field(ge=1, le=4, description="Requested number of storeys.")
    bedrooms: int = Field(ge=1, le=10, description="Requested bedroom count.")
    gross_floor_area_target_m2: FiniteFloat = Field(gt=20, le=2000)
    style: Literal[
        "Contemporary",
        "Modern",
        "Traditional",
        "Minimalist",
        "Coastal",
        "Scandinavian",
    ]
    roof: Literal[
        "Gable roof",
        "Hip roof",
        "Flat roof",
        "Mono-pitch roof",
        "Mixed roof",
    ]
    garage: Literal["No garage", "Single garage", "Double garage", "Carport"]
    terrain_adaptation: Literal[
        "Adapt to terrain",
        "Level pad",
        "Stepped floor plates",
    ]
    # The meaning of gross floor area varies by rule and project. Leave unset until agreed.
    gross_floor_area_basis: GfaBasis | None = None


class HouseDesignSpecValidationResult(CamelModel):
    valid: bool = True
    spec: HouseDesignSpec
    model_generated: Literal[False] = False


class HouseDesignFloorPlate(CamelModel):
    """Candidate floor plate; level 0 is the ground level and coordinates are NZTM2000 metres."""

    level: int = Field(ge=0, le=10)
    footprint_nztm: Ring2D
    gross_floor_area_m2: FiniteFloat = Field(gt=0)
    finished_floor_level_m: FiniteFloat | None = None


class HouseTerrainSample(CamelModel):
    nztm_e: FiniteFloat
    nztm_n: FiniteFloat
    elevation_m: FiniteFloat


class HouseDesignCandidate(CamelModel):
    """Geometry summary supplied by a future deterministic parametric geometry builder."""

    candidate_id: str = Field(min_length=1, max_length=100)
    storeys: int = Field(ge=1, le=10)
    bedrooms: int = Field(ge=1, le=20)
    gross_floor_area_m2: FiniteFloat = Field(gt=0)
    gross_floor_area_basis: GfaBasis | None = None
    overall_height_m: FiniteFloat = Field(gt=0)
    floor_plates: list[HouseDesignFloorPlate] = Field(min_length=1, max_length=20)
    terrain_adaptation_applied: bool | None = None


class HouseSiteDesignConstraints(CamelModel):
    """Surveyed parcel data and rule-derived limits; values must retain their source/provenance."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )

    parcel_boundary_nztm: Ring2D
    buildable_areas_nztm: list[Ring2D] | None = None
    planning_rules_confirmed: bool = False
    unverified_rules_remain: bool = True
    rule_source_name: str | None = None
    rule_source_version: str | None = None
    rule_source_url: AnyUrl | None = None
    not_applicable_rules: list[RuleCode] = Field(default_factory=list)

    max_storeys: int | None = Field(default=None, ge=1, le=20)
    max_building_height_m: FiniteFloat | None = Field(default=None, gt=0)
    max_site_coverage_ratio: FiniteFloat | None = Field(default=None, ge=0, le=1)
    min_gross_floor_area_m2: FiniteFloat | None = Field(default=None, gt=0)
    max_gross_floor_area_m2: FiniteFloat | None = Field(default=None, gt=0)
    gross_floor_area_basis: GfaBasis | None = None

    # Terrain-fit screening uses the same vertical datum for all levels and samples.
    terrain_source: str | None = None
    terrain_vertical_datum: str | None = None
    terrain_samples: list[HouseTerrainSample] | None = None
    max_cut_fill_depth_m: FiniteFloat | None = Field(default=None, gt=0, le=20)

    @model_validator(mode="after")
    def validate_rule_metadata(self) -> HouseSiteDesignConstraints:
        if (
            self.min_gross_floor_area_m2 is not None
            and self.max_gross_floor_area_m2 is not None
            and self.min_gross_floor_area_m2 > self.max_gross_floor_area_m2
        ):
            raise ValueError("minGrossFloorAreaM2 cannot exceed maxGrossFloorAreaM2.")
        if self.planning_rules_confirmed and not all(
            [self.rule_source_name, self.rule_source_version, self.rule_source_url]
        ):
            raise ValueError(
                "Confirmed planning rules require ruleSourceName, ruleSourceVersion and ruleSourceUrl."
            )
        return self


class HouseDesignValidationRequest(CamelModel):
    spec: HouseDesignSpec
    candidate: HouseDesignCandidate
    site_constraints: HouseSiteDesignConstraints
    gfa_target_tolerance_percent: FiniteFloat = Field(default=5.0, ge=0, le=50)


class HouseDesignConstraintCheck(CamelModel):
    code: str
    title: str
    severity: CheckSeverity
    status: CheckStatus
    message: str
    actual: float | int | str | bool | None = None
    limit: float | int | str | bool | None = None
    source_reference: str | None = None


class HouseDesignValidationResult(CamelModel):
    model_generated: Literal[False] = False
    overall_status: Literal["PASS", "FAIL", "BLOCKED"]
    candidate_id: str
    checks: list[HouseDesignConstraintCheck]
    notes: list[str] = Field(default_factory=list)
