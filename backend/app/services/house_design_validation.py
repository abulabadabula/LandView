from __future__ import annotations

from math import isfinite

from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

from app.schemas_house import (
    HouseDesignCandidate,
    HouseDesignConstraintCheck,
    HouseDesignValidationRequest,
    HouseDesignValidationResult,
)

PASS = "PASS"
FAIL = "FAIL"
NOT_EVALUATED = "NOT_EVALUATED"
NOT_APPLICABLE = "NOT_APPLICABLE"


def _check(
    code: str,
    title: str,
    status: str,
    message: str,
    *,
    severity: str = "HARD",
    actual: float | int | str | bool | None = None,
    limit: float | int | str | bool | None = None,
    source_reference: str | None = None,
) -> HouseDesignConstraintCheck:
    return HouseDesignConstraintCheck(
        code=code,
        title=title,
        severity=severity,
        status=status,
        message=message,
        actual=actual,
        limit=limit,
        source_reference=source_reference,
    )


def _polygon(ring: list[tuple[float, float]]) -> Polygon:
    return Polygon([(float(e), float(n)) for e, n in ring])


def _rule_status_without_value(site, code: str) -> tuple[str, str]:
    if not site.planning_rules_confirmed:
        return NOT_EVALUATED, "Planning-rule source has not been confirmed."
    if code in site.not_applicable_rules:
        return NOT_APPLICABLE, "The confirmed rule set explicitly marks this check as not applicable."
    return NOT_EVALUATED, "No applicable limit/geometry was supplied for this rule."


def _numeric_rule_check(
    request: HouseDesignValidationRequest,
    *,
    code: str,
    title: str,
    limit: float | int | None,
    actual: float | int,
    comparison: str,
    display_unit: str,
) -> HouseDesignConstraintCheck:
    site = request.site_constraints
    source = str(site.rule_source_url) if site.rule_source_url else None
    if not site.planning_rules_confirmed:
        return _check(
            code,
            title,
            NOT_EVALUATED,
            "Cannot treat this limit as authoritative until the planning rule source is confirmed.",
            actual=actual,
            limit=limit,
            source_reference=source,
        )
    if limit is None:
        status, message = _rule_status_without_value(site, code)
        return _check(
            code,
            title,
            status,
            message,
            actual=actual,
            source_reference=source,
        )

    if comparison == "max":
        passed = actual <= limit + 1e-9
        operator = "≤"
    else:
        passed = actual >= limit - 1e-9
        operator = "≥"
    return _check(
        code,
        title,
        PASS if passed else FAIL,
        (
            f"Actual value {actual:.3f} {display_unit} is within the supplied limit."
            if passed
            else f"Actual value {actual:.3f} {display_unit} exceeds the supplied hard limit."
        ),
        actual=actual,
        limit=f"{operator} {limit} {display_unit}",
        source_reference=source,
    )


def _terrain_fit_check(request: HouseDesignValidationRequest) -> HouseDesignConstraintCheck:
    spec = request.spec
    candidate = request.candidate
    site = request.site_constraints

    if spec.terrain_adaptation != "Adapt to terrain":
        return _check(
            "TERRAIN_FIT",
            "Terrain adaptation",
            NOT_APPLICABLE,
            "The selected input does not request terrain adaptation.",
        )
    if candidate.terrain_adaptation_applied is False:
        return _check(
            "TERRAIN_FIT",
            "Terrain adaptation",
            FAIL,
            "The candidate explicitly reports that terrain adaptation was not applied.",
        )
    if (
        not site.terrain_source
        or not site.terrain_vertical_datum
        or not site.terrain_samples
        or site.max_cut_fill_depth_m is None
    ):
        return _check(
            "TERRAIN_FIT",
            "Terrain adaptation",
            NOT_EVALUATED,
            "Terrain samples, their source/datum and a project cut/fill screening tolerance are required.",
        )

    ground_plates = [plate for plate in candidate.floor_plates if plate.level == 0]
    if not ground_plates or any(plate.finished_floor_level_m is None for plate in ground_plates):
        return _check(
            "TERRAIN_FIT",
            "Terrain adaptation",
            NOT_EVALUATED,
            "Every ground-level plate needs a finished floor level in the terrain sample vertical datum.",
        )

    deviations: list[float] = []
    for plate in ground_plates:
        footprint = _polygon(plate.footprint_nztm)
        if not footprint.is_valid or footprint.area <= 0:
            return _check(
                "TERRAIN_FIT",
                "Terrain adaptation",
                FAIL,
                "A ground-level footprint is invalid, so terrain fit cannot be checked.",
            )
        samples_inside = [
            sample
            for sample in site.terrain_samples
            if footprint.covers(Point(sample.nztm_e, sample.nztm_n))
        ]
        if len(samples_inside) < 3:
            return _check(
                "TERRAIN_FIT",
                "Terrain adaptation",
                NOT_EVALUATED,
                "At least three terrain samples inside each ground-level footprint are required for this screening check.",
            )
        floor_level = plate.finished_floor_level_m
        deviations.extend(abs(sample.elevation_m - floor_level) for sample in samples_inside)

    maximum_deviation = max(deviations, default=float("inf"))
    passed = isfinite(maximum_deviation) and maximum_deviation <= site.max_cut_fill_depth_m + 1e-9
    return _check(
        "TERRAIN_FIT",
        "Terrain adaptation",
        PASS if passed else FAIL,
        (
            "Sampled ground-to-finished-floor deviations are within the supplied screening tolerance. "
            "This is not a geotechnical or earthworks design check."
            if passed
            else "Sampled ground-to-finished-floor deviation exceeds the supplied project screening tolerance."
        ),
        actual=round(maximum_deviation, 3) if isfinite(maximum_deviation) else None,
        limit=f"≤ {site.max_cut_fill_depth_m} m",
        source_reference=site.terrain_source,
    )


def validate_house_design(request: HouseDesignValidationRequest) -> HouseDesignValidationResult:
    """Validate supplied candidate geometry; this function does not generate a house model."""
    spec = request.spec
    candidate = request.candidate
    site = request.site_constraints
    checks: list[HouseDesignConstraintCheck] = []
    planning_source = str(site.rule_source_url) if site.rule_source_url else None

    checks.append(
        _check(
            "PLANNING_RULE_COMPLETENESS",
            "Planning rule source and coverage",
            PASS if site.planning_rules_confirmed and not site.unverified_rules_remain else NOT_EVALUATED,
            (
                "Rule source is identified and the caller reports no unverified rule categories."
                if site.planning_rules_confirmed and not site.unverified_rules_remain
                else "A verified source and an explicit confirmation that all applicable hard-rule categories are represented are required."
            ),
            source_reference=planning_source,
        )
    )

    checks.append(
        _check(
            "STOREYS_MATCH_INTENT",
            "Storey count matches design input",
            PASS if candidate.storeys == spec.storeys else FAIL,
            "Candidate storey count matches the requested input."
            if candidate.storeys == spec.storeys
            else "Candidate storey count does not match the requested input.",
            actual=candidate.storeys,
            limit=spec.storeys,
        )
    )
    checks.append(
        _check(
            "BEDROOMS_MATCH_INTENT",
            "Bedroom count matches design input",
            PASS if candidate.bedrooms == spec.bedrooms else FAIL,
            "Candidate bedroom count matches the requested input."
            if candidate.bedrooms == spec.bedrooms
            else "Candidate bedroom count does not match the requested input.",
            actual=candidate.bedrooms,
            limit=spec.bedrooms,
        )
    )

    candidate_levels = sorted({plate.level for plate in candidate.floor_plates})
    expected_levels = list(range(candidate.storeys))
    levels_pass = candidate_levels == expected_levels and candidate.storeys == len(candidate_levels)
    checks.append(
        _check(
            "FLOOR_PLATE_LEVELS",
            "Floor plates cover each storey",
            PASS if levels_pass else FAIL,
            "Floor plate levels are contiguous from ground level 0."
            if levels_pass
            else "Floor plates must represent every storey using contiguous levels beginning at 0.",
            actual=str(candidate_levels),
            limit=str(expected_levels),
        )
    )

    try:
        parcel = _polygon(site.parcel_boundary_nztm)
        parcel_valid = parcel.is_valid and not parcel.is_empty and parcel.area > 0
    except (TypeError, ValueError):
        parcel = Polygon()
        parcel_valid = False

    floor_polygons: list[Polygon] = []
    floor_polygons_valid = True
    for plate in candidate.floor_plates:
        try:
            polygon = _polygon(plate.footprint_nztm)
            polygon_valid = polygon.is_valid and not polygon.is_empty and polygon.area > 0
        except (TypeError, ValueError):
            polygon = Polygon()
            polygon_valid = False
        floor_polygons.append(polygon)
        floor_polygons_valid = floor_polygons_valid and polygon_valid

    geometry_valid = parcel_valid and floor_polygons_valid
    checks.append(
        _check(
            "GEOMETRY_VALIDITY",
            "Parcel and candidate footprints are valid polygons",
            PASS if geometry_valid else FAIL,
            "Parcel and all supplied floor footprints are valid, non-zero-area polygons."
            if geometry_valid
            else "At least one parcel/floor footprint is invalid or has zero area.",
        )
    )

    if geometry_valid:
        inside_parcel = all(parcel.covers(footprint) for footprint in floor_polygons)
        checks.append(
            _check(
                "WITHIN_PARCEL",
                "All floor footprints remain inside the parcel",
                PASS if inside_parcel else FAIL,
                "All supplied floor footprints are covered by the parcel boundary."
                if inside_parcel
                else "At least one floor footprint extends outside the supplied parcel boundary.",
            )
        )
    else:
        checks.append(
            _check(
                "WITHIN_PARCEL",
                "All floor footprints remain inside the parcel",
                NOT_EVALUATED,
                "Requires valid parcel and candidate polygon geometry.",
            )
        )

    if not site.planning_rules_confirmed:
        setback_status, setback_message = NOT_EVALUATED, "Planning rules are not confirmed; the setback geometry is not authoritative."
    elif site.buildable_areas_nztm:
        try:
            buildable_parts = [_polygon(ring) for ring in site.buildable_areas_nztm]
            buildable_valid = all(part.is_valid and part.area > 0 for part in buildable_parts)
            buildable = unary_union(buildable_parts) if buildable_valid else Polygon()
            if not buildable_valid:
                setback_status, setback_message = FAIL, "Supplied buildable/setback polygon is invalid."
            elif not geometry_valid:
                setback_status, setback_message = NOT_EVALUATED, "Requires valid candidate footprints."
            elif all(buildable.covers(footprint) for footprint in floor_polygons):
                setback_status, setback_message = PASS, "All supplied floor footprints remain within the supplied buildable area."
            else:
                setback_status, setback_message = FAIL, "At least one floor footprint crosses the supplied buildable/setback boundary."
        except (TypeError, ValueError):
            setback_status, setback_message = FAIL, "Supplied buildable/setback geometry could not be interpreted."
    elif "SETBACK_ENVELOPE" in site.not_applicable_rules:
        setback_status, setback_message = NOT_APPLICABLE, "The confirmed rule set explicitly marks this check as not applicable."
    else:
        setback_status, setback_message = NOT_EVALUATED, "A rule-derived buildable/setback polygon is required."
    checks.append(
        _check(
            "SETBACK_ENVELOPE",
            "Setback/buildable envelope",
            setback_status,
            setback_message,
            source_reference=planning_source,
        )
    )

    checks.append(
        _numeric_rule_check(
            request,
            code="MAX_STOREYS",
            title="Maximum permitted storeys",
            limit=site.max_storeys,
            actual=candidate.storeys,
            comparison="max",
            display_unit="storeys",
        )
    )
    checks.append(
        _numeric_rule_check(
            request,
            code="MAX_BUILDING_HEIGHT",
            title="Maximum building height",
            limit=site.max_building_height_m,
            actual=candidate.overall_height_m,
            comparison="max",
            display_unit="m",
        )
    )

    ground_polygons = [
        footprint
        for plate, footprint in zip(candidate.floor_plates, floor_polygons)
        if plate.level == 0
    ]
    if geometry_valid and parcel_valid and ground_polygons:
        site_coverage = float(unary_union(ground_polygons).area / parcel.area)
        checks.append(
            _numeric_rule_check(
                request,
                code="MAX_SITE_COVERAGE",
                title="Maximum site coverage",
                limit=site.max_site_coverage_ratio,
                actual=site_coverage,
                comparison="max",
                display_unit="ratio",
            )
        )
    else:
        status, message = _rule_status_without_value(site, "MAX_SITE_COVERAGE")
        checks.append(
            _check(
                "MAX_SITE_COVERAGE",
                "Maximum site coverage",
                NOT_EVALUATED if status != NOT_APPLICABLE else status,
                "A valid ground-level footprint and parcel are required to calculate site coverage. " + message,
                source_reference=planning_source,
            )
        )

    floor_gfa_sum = sum(plate.gross_floor_area_m2 for plate in candidate.floor_plates)
    gfa_accounting_tolerance = max(0.5, 0.005 * candidate.gross_floor_area_m2)
    gfa_accounting_pass = abs(floor_gfa_sum - candidate.gross_floor_area_m2) <= gfa_accounting_tolerance
    checks.append(
        _check(
            "GFA_ACCOUNTING",
            "Floor-area schedule matches candidate total",
            PASS if gfa_accounting_pass else FAIL,
            "Sum of floor-level gross floor areas matches the candidate total within numerical tolerance."
            if gfa_accounting_pass
            else "Sum of floor-level gross floor areas does not match the candidate total.",
            actual=round(floor_gfa_sum, 3),
            limit=f"{candidate.gross_floor_area_m2:.3f} m² ± {gfa_accounting_tolerance:.3f} m²",
        )
    )

    gfa_basis_matches = (
        candidate.gross_floor_area_basis is not None
        and site.gross_floor_area_basis is not None
        and candidate.gross_floor_area_basis == site.gross_floor_area_basis
    )
    gfa_has_limits = (
        site.min_gross_floor_area_m2 is not None or site.max_gross_floor_area_m2 is not None
    )
    if not site.planning_rules_confirmed:
        gfa_status, gfa_message = NOT_EVALUATED, "Planning rules are not confirmed."
    elif not gfa_has_limits:
        gfa_status, gfa_message = _rule_status_without_value(site, "GFA_RANGE")
    elif not gfa_basis_matches:
        gfa_status, gfa_message = NOT_EVALUATED, "Candidate and rule GFA accounting bases must be explicitly declared and match."
    else:
        lower_pass = (
            site.min_gross_floor_area_m2 is None
            or candidate.gross_floor_area_m2 >= site.min_gross_floor_area_m2 - 1e-9
        )
        upper_pass = (
            site.max_gross_floor_area_m2 is None
            or candidate.gross_floor_area_m2 <= site.max_gross_floor_area_m2 + 1e-9
        )
        gfa_status = PASS if lower_pass and upper_pass else FAIL
        gfa_message = (
            "Candidate GFA is within the supplied rule range."
            if gfa_status == PASS
            else "Candidate GFA is outside the supplied rule range."
        )
    checks.append(
        _check(
            "GFA_RANGE",
            "Gross floor area rule range",
            gfa_status,
            gfa_message,
            actual=candidate.gross_floor_area_m2,
            limit=(
                f"{site.min_gross_floor_area_m2 or 'no minimum'} to "
                f"{site.max_gross_floor_area_m2 or 'no maximum'} m²"
                if gfa_has_limits
                else None
            ),
            source_reference=planning_source,
        )
    )

    if spec.gross_floor_area_basis is None or candidate.gross_floor_area_basis != spec.gross_floor_area_basis:
        target_status = NOT_EVALUATED
        target_message = (
            "The target GFA accounting basis is unset or does not match the candidate; clarify whether the garage is included."
        )
        target_limit = f"{spec.gross_floor_area_target_m2} m² target"
    else:
        target_delta = spec.gross_floor_area_target_m2 * request.gfa_target_tolerance_percent / 100
        target_low = spec.gross_floor_area_target_m2 - target_delta
        target_high = spec.gross_floor_area_target_m2 + target_delta
        target_status = PASS if target_low <= candidate.gross_floor_area_m2 <= target_high else FAIL
        target_message = (
            "Candidate GFA is within the non-statutory design-target tolerance."
            if target_status == PASS
            else "Candidate GFA is outside the non-statutory design-target tolerance; this is not by itself a planning-rule failure."
        )
        target_limit = f"{target_low:.1f} to {target_high:.1f} m² (design target)"
    checks.append(
        _check(
            "GFA_DESIGN_TARGET",
            "Gross floor area target",
            target_status,
            target_message,
            severity="DESIGN_TARGET",
            actual=candidate.gross_floor_area_m2,
            limit=target_limit,
        )
    )

    checks.append(_terrain_fit_check(request))

    hard_checks = [check for check in checks if check.severity == "HARD"]
    if any(check.status == FAIL for check in hard_checks):
        overall_status = FAIL
    elif any(check.status == NOT_EVALUATED for check in hard_checks):
        overall_status = "BLOCKED"
    else:
        overall_status = PASS

    return HouseDesignValidationResult(
        overall_status=overall_status,
        candidate_id=candidate.candidate_id,
        checks=checks,
        notes=[
            "This endpoint validates only the supplied candidate summary, geometry and rule data; it does not generate a house model.",
            "PASS is limited to the checks and confirmed rule sources supplied here. It is not building-consent approval or an architectural, structural, fire, accessibility or geotechnical sign-off.",
            "The terrain-fit check is a sampled cut/fill screening check only, not an earthworks quantity or foundation design.",
            "The caller must not mark planning rules complete until applicable zone rules and overlays have been checked against a reliable, current source.",
        ],
    )
