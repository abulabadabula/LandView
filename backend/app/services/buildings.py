"""LINZ footprints enriched with OSM attributes and optional LiDAR-derived heights."""
import asyncio
import logging
import math
import re

import httpx
from pyproj import Transformer
from shapely.geometry import Point, shape
from shapely.strtree import STRtree

from app.config import get_settings
from app.schemas import Building, BuildingCollection
from app.services import linz, linz_elevation
from app.services.errors import UpstreamError
from app.services.geo import offset_latlon, project_geom, to_nztm

STOREY_HEIGHT_M = 3.0
MIN_AREA_M2 = 12.0
MAX_BUILDINGS = 2500
MAX_ROOF_SAMPLES = 48
_FROM_NZTM = Transformer.from_crs(2193, 4326, always_xy=True)
logger = logging.getLogger(__name__)


def _num(value) -> float | None:
    match = re.match(r"\s*(\d+(?:\.\d+)?)", str(value or ""))
    return float(match.group(1)) if match else None


def _levels(tags: dict) -> tuple[int, float | None] | None:
    levels = _num(tags.get("building:levels"))
    height = _num(tags.get("height") or tags.get("building:height"))
    if levels is None and height is None:
        return None
    storeys = max(1, round(levels)) if levels is not None else max(1, round(height / STOREY_HEIGHT_M))
    return storeys, height


async def _osm_levels(w: float, s: float, e: float, n: float):
    """Return tagged building centres and (storeys, explicit height), or None if unavailable."""
    query = f'[out:json][timeout:25];way["building"]({s:.6f},{w:.6f},{n:.6f},{e:.6f});out tags center;'
    try:
        async with httpx.AsyncClient(timeout=35, headers={"User-Agent": "LandView/0.3 (NZ property context viewer)"}) as client:
            response = await client.post(get_settings().overpass_url, data={"data": query})
            response.raise_for_status()
            elements = response.json()["elements"]
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        logger.warning("[LandView][OSM-buildings] levels_query_failed bbox=(%.6f, %.6f, %.6f, %.6f) error=%s", w, s, e, n, exc)
        return None

    out = []
    for element in elements:
        center = element.get("center")
        info = _levels(element.get("tags", {}))
        if center and info:
            out.append((Point(*to_nztm(center["lon"], center["lat"])), info))
    logger.info("[LandView][OSM-buildings] levels_query_success raw_elements=%s tagged_buildings=%s", len(elements), len(out))
    return out


def _assume_storeys(use: str | None, area_m2: float) -> int:
    residential = (use or "").lower() in {"", "residential", "unknown"}
    if residential:
        return 1
    return 2 if area_m2 >= 400 else 1


def _roof_sample_points(polygon) -> list[tuple[float, float]]:
    """Create a bounded sample of points inside a building polygon in NZTM coordinates."""
    min_x, min_y, max_x, max_y = polygon.bounds
    area = max(float(polygon.area), 1.0)
    spacing = max(2.0, min(8.0, math.sqrt(area / 36.0)))
    samples: list[tuple[float, float]] = []
    y = min_y + spacing / 2
    while y < max_y and len(samples) < 1200:
        x = min_x + spacing / 2
        while x < max_x and len(samples) < 1200:
            if polygon.contains(Point(x, y)):
                lon, lat = _FROM_NZTM.transform(x, y)
                samples.append((lat, lon))
            x += spacing
        y += spacing

    if not samples:
        point = polygon.representative_point()
        lon, lat = _FROM_NZTM.transform(point.x, point.y)
        return [(lat, lon)]
    if len(samples) > MAX_ROOF_SAMPLES:
        stride = math.ceil(len(samples) / MAX_ROOF_SAMPLES)
        samples = samples[::stride][:MAX_ROOF_SAMPLES]
    return samples


def _lidar_height(dem_values, dsm_values) -> float | None:
    """Estimate roof height from paired DSM/DEM samples, rejecting no-data and extreme outliers."""
    differences = []
    for ground, surface in zip(dem_values, dsm_values):
        if ground is None or surface is None:
            continue
        difference = float(surface) - float(ground)
        if 2.0 <= difference <= 120.0:
            differences.append(difference)
    if len(differences) < 3:
        return None
    differences.sort()
    index = round(0.70 * (len(differences) - 1))
    return round(differences[index], 1)


async def _height_overrides(records: list[dict]) -> None:
    """Populate LiDAR estimates in one batched DEM/DSM sampling pass, best-effort."""
    sample_sets: list[list[tuple[float, float]]] = []
    flat_points: list[tuple[float, float]] = []
    for record in records:
        if record["explicit_height"] is not None:
            sample_sets.append([])
            continue
        samples = _roof_sample_points(record["projected"])
        sample_sets.append(samples)
        flat_points.extend(samples)

    if not flat_points:
        return
    try:
        dem, dsm = await asyncio.gather(
            linz_elevation.elevations(flat_points, spacing_m=2.0, surface="dem", allow_nodata=True),
            linz_elevation.elevations(flat_points, spacing_m=2.0, surface="dsm", allow_nodata=True),
        )
    except (UpstreamError, httpx.HTTPError, ValueError, OSError) as exc:
        logger.warning("[LandView][LiDAR-buildings] height_sampling_failed sample_points=%s error=%s", len(flat_points), exc)
        return

    logger.info("[LandView][LiDAR-buildings] sampled_points=%s dem_values=%s dsm_values=%s", len(flat_points), len(dem), len(dsm))
    cursor = 0
    for record, samples in zip(records, sample_sets):
        if not samples:
            continue
        next_cursor = cursor + len(samples)
        record["lidar_height"] = _lidar_height(dem[cursor:next_cursor], dsm[cursor:next_cursor])
        cursor = next_cursor


async def buildings_around(lat: float, lon: float, size_m: float = 1000.0) -> BuildingCollection:
    half = size_m / 2
    south, west = offset_latlon(lat, lon, -half, -half)
    north, east = offset_latlon(lat, lon, half, half)
    logger.info(
        "[LandView][buildings] pipeline_start center=(%.6f, %.6f) size_m=%.1f bbox_lonlat=(%.6f, %.6f, %.6f, %.6f)",
        lat, lon, size_m, west, south, east, north,
    )
    try:
        features, osm = await asyncio.gather(
            linz.building_outlines(west, south, east, north),
            _osm_levels(west, south, east, north),
        )
    except Exception:
        logger.exception("[LandView][buildings] upstream_fetch_failed center=(%.6f, %.6f) size_m=%.1f", lat, lon, size_m)
        raise

    osm_points = osm or []
    logger.info(
        "[LandView][buildings] upstream_result linz_features=%s osm_query=%s osm_tagged_buildings=%s lidar_key_configured=%s",
        len(features), "failed" if osm is None else "success", len(osm_points), bool(get_settings().linz_basemaps_key),
    )
    tree = STRtree([point for point, _ in osm_points]) if osm_points else None
    settings = get_settings()
    # Keep extra DEM/DSM requests limited to the 100 m-radius scene.
    infer_lidar = bool(settings.linz_basemaps_key) and size_m <= 300.0
    records: list[dict] = []
    geometry_errors = 0
    non_polygon_parts = 0
    small_parts_filtered = 0
    osm_matches = 0
    polygon_parts_seen = 0

    for feature in features:
        properties = feature.get("properties", {})
        try:
            geometry = shape(feature["geometry"])
        except Exception as exc:
            geometry_errors += 1
            logger.warning("[LandView][buildings] invalid_geometry feature_id=%s error=%s", properties.get("building_id"), exc)
            continue
        parts = list(geometry.geoms) if geometry.geom_type == "MultiPolygon" else [geometry]
        for part in parts:
            polygon_parts_seen += 1
            if part.geom_type != "Polygon" or part.is_empty:
                non_polygon_parts += 1
                continue
            projected = project_geom(part)
            area = float(projected.area)
            if area < MIN_AREA_M2:
                small_parts_filtered += 1
                continue

            matched = None
            if tree is not None:
                hits = tree.query(projected.buffer(3), predicate="intersects")
                if len(hits):
                    matched = osm_points[int(hits[0])][1]
                    osm_matches += 1

            levels, explicit_height = matched if matched else (None, None)
            ring = [[round(x, 6), round(y, 6)] for x, y in part.exterior.coords][:-1]
            records.append(
                {
                    "id": properties.get("building_id"),
                    "area": area,
                    "use": properties.get("use"),
                    "ring": ring,
                    "projected": projected,
                    "levels": levels,
                    "explicit_height": explicit_height,
                    "lidar_height": None,
                }
            )

    logger.info(
        "[LandView][buildings] geometry_summary input_features=%s parts_seen=%s invalid_geometries=%s non_polygon_parts=%s below_min_area=%s accepted_footprints=%s osm_spatial_matches=%s",
        len(features), polygon_parts_seen, geometry_errors, non_polygon_parts, small_parts_filtered, len(records), osm_matches,
    )
    if records:
        sample = records[0]
        xs = [point[0] for point in sample["ring"]]
        ys = [point[1] for point in sample["ring"]]
        logger.info(
            "[LandView][buildings] sample_footprint id=%s area_m2=%.1f ring_points=%s lon_range=(%.6f, %.6f) lat_range=(%.6f, %.6f) first_point=%s",
            sample["id"], sample["area"], len(sample["ring"]), min(xs), max(xs), min(ys), max(ys), sample["ring"][0] if sample["ring"] else None,
        )
    if infer_lidar and records:
        await _height_overrides(records)
    elif records and not settings.linz_basemaps_key:
        logger.info("[LandView][LiDAR-buildings] skipped reason=LINZ_BASEMAPS_KEY_not_configured size_m=%.1f", size_m)
    elif records and size_m > 300.0:
        logger.info("[LandView][LiDAR-buildings] skipped reason=coverage_over_300m size_m=%.1f", size_m)

    result: list[Building] = []
    for record in records[:MAX_BUILDINGS]:
        levels = record["levels"]
        explicit_height = record["explicit_height"]
        lidar_height = record["lidar_height"]

        if explicit_height is not None and explicit_height > 0:
            height = float(explicit_height)
            height_source = "osm_height"
            confidence = "high"
        elif lidar_height is not None:
            height = float(lidar_height)
            height_source = "lidar_estimated"
            confidence = "medium"
        elif levels is not None:
            height = max(1.0, levels * STOREY_HEIGHT_M)
            height_source = "osm_levels"
            confidence = "medium"
        else:
            levels = _assume_storeys(record["use"], record["area"])
            height = levels * STOREY_HEIGHT_M
            height_source = "assumed"
            confidence = "low"

        if levels is None:
            levels = max(1, round(height / STOREY_HEIGHT_M))
        storeys_source = "osm" if record["levels"] is not None else (
            "lidar" if height_source == "lidar_estimated" else "assumed"
        )
        result.append(
            Building(
                id=record["id"],
                area_m2=round(record["area"], 1),
                storeys=levels,
                storeys_source=storeys_source,
                height_m=round(max(1.0, min(height, 120.0)), 1),
                height_source=height_source,
                height_confidence=confidence,
                use=record["use"],
                ring=record["ring"],
            )
        )

    height_sources: dict[str, int] = {}
    for building in result:
        height_sources[building.height_source] = height_sources.get(building.height_source, 0) + 1
    logger.info(
        "[LandView][buildings] response_ready returned_buildings=%s height_sources=%s osm_available=%s",
        len(result), height_sources, osm is not None,
    )
    return BuildingCollection(buildings=result, osm_available=osm is not None)
