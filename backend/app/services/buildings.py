"""Building footprints (LINZ) enriched with storey counts (OpenStreetMap building:levels)."""
import asyncio
import re

import httpx
from shapely.geometry import Point, shape
from shapely.strtree import STRtree

from app.config import get_settings
from app.schemas import Building, BuildingCollection
from app.services import linz
from app.services.geo import offset_latlon, project_geom, to_nztm

STOREY_HEIGHT_M = 3.0
MIN_AREA_M2 = 12.0
MAX_BUILDINGS = 2500


def _num(v) -> float | None:
    m = re.match(r"\s*(\d+(?:\.\d+)?)", str(v or ""))
    return float(m.group(1)) if m else None


def _levels(tags: dict) -> tuple[int, float | None] | None:
    levels = _num(tags.get("building:levels"))
    height = _num(tags.get("height") or tags.get("building:height"))
    if levels is None and height is None:
        return None
    storeys = max(1, round(levels)) if levels is not None else max(1, round(height / STOREY_HEIGHT_M))
    return storeys, height


async def _osm_levels(w: float, s: float, e: float, n: float):
    """[(point in NZTM, (storeys, height|None))] for tagged OSM buildings, or None if Overpass failed."""
    query = f'[out:json][timeout:25];way["building"]({s:.6f},{w:.6f},{n:.6f},{e:.6f});out tags center;'
    try:
        async with httpx.AsyncClient(timeout=35, headers={"User-Agent": "LandView/0.1"}) as client:
            r = await client.post(get_settings().overpass_url, data={"data": query})
            r.raise_for_status()
            elements = r.json()["elements"]
    except (httpx.HTTPError, KeyError, ValueError):
        return None
    out = []
    for el in elements:
        center, info = el.get("center"), _levels(el.get("tags", {}))
        if center and info:
            out.append((Point(*to_nztm(center["lon"], center["lat"])), info))
    return out


def _assume_storeys(use: str | None, area_m2: float) -> int:
    """No open national storey data: houses are usually 1-2 storeys, bigger non-residential footprints taller."""
    residential = (use or "").lower() in {"", "residential", "unknown"}
    if residential:
        return 1
    return 2 if area_m2 >= 400 else 1


async def buildings_around(lat: float, lon: float, size_m: float = 1000.0) -> BuildingCollection:
    half = size_m / 2
    s, w = offset_latlon(lat, lon, -half, -half)
    n, e = offset_latlon(lat, lon, half, half)
    features, osm = await asyncio.gather(linz.building_outlines(w, s, e, n), _osm_levels(w, s, e, n))

    points = osm or []
    tree = STRtree([p for p, _ in points]) if points else None

    result: list[Building] = []
    for f in features:
        props = f.get("properties", {})
        geom = shape(f["geometry"])
        parts = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
        for part in parts:
            if part.geom_type != "Polygon" or part.is_empty:
                continue
            area = project_geom(part).area
            if area < MIN_AREA_M2:
                continue
            match = None
            if tree is not None:
                hits = tree.query(project_geom(part).buffer(3), predicate="intersects")
                if len(hits):
                    match = points[int(hits[0])][1]
            if match:
                storeys, tagged_h = match
                height, source = tagged_h or storeys * STOREY_HEIGHT_M, "osm"
            else:
                storeys = _assume_storeys(props.get("use"), area)
                height, source = storeys * STOREY_HEIGHT_M, "assumed"
            ring = [[round(x, 6), round(y, 6)] for x, y in part.exterior.coords][:-1]
            result.append(
                Building(
                    id=props.get("building_id"),
                    area_m2=round(area, 1),
                    storeys=storeys,
                    storeys_source=source,
                    height_m=round(height, 1),
                    use=props.get("use"),
                    ring=ring,
                )
            )
    return BuildingCollection(buildings=result[:MAX_BUILDINGS], osm_available=osm is not None)
