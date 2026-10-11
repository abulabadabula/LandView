"""Road and hydrography context from OpenStreetMap's Overpass API."""
from __future__ import annotations

import math

import httpx

from app.config import get_settings
from app.schemas import ContextCollection, ContextFeature
from app.services.geo import offset_latlon

MAX_FEATURES = 5000
OVERPASS_TIMEOUT_S = 35.0


def _width_m(value: object) -> float | None:
    """Parse common OSM width values such as '4.5' or '5 m'."""
    try:
        text = str(value or "").strip().lower()
        for unit in ("metres", "meters", "metre", "meter", "m"):
            text = text.replace(unit, "")
        number = float(text.strip())
        return number if math.isfinite(number) and number > 0 else None
    except (TypeError, ValueError):
        return None


def _coordinates(element: dict) -> list[list[float]]:
    return [
        [float(point["lon"]), float(point["lat"])]
        for point in element.get("geometry", [])
        if "lon" in point and "lat" in point
    ]


def _closed_ring(points: list[list[float]]) -> bool:
    if len(points) < 4:
        return False
    first, last = points[0], points[-1]
    return abs(first[0] - last[0]) < 1e-7 and abs(first[1] - last[1]) < 1e-7


async def context_around(lat: float, lon: float, size_m: float = 1000.0) -> ContextCollection:
    """Return OSM roads, waterways and closed water polygons around a location.

    Coverage is a square of size_m metres centred on the searched address.
    A failed Overpass request is non-fatal and is reported in osm_available.
    """
    half = size_m / 2
    south, west = offset_latlon(lat, lon, -half, -half)
    north, east = offset_latlon(lat, lon, half, half)
    bbox = f"{south:.6f},{west:.6f},{north:.6f},{east:.6f}"

    query = f"""
    [out:json][timeout:30];
    (
      way["highway"]({bbox});
      way["waterway"~"^(river|stream|canal|drain|ditch)$"]({bbox});
      way["natural"="water"]({bbox});
      way["landuse"="reservoir"]({bbox});
    );
    out body geom;
    """
    try:
        async with httpx.AsyncClient(
            timeout=OVERPASS_TIMEOUT_S,
            headers={"User-Agent": "LandView/0.2 (NZ property context viewer)"},
        ) as client:
            response = await client.post(get_settings().overpass_url, data={"data": query})
            response.raise_for_status()
            elements = response.json().get("elements", [])
    except (httpx.HTTPError, KeyError, ValueError):
        return ContextCollection(features=[], osm_available=False)

    features: list[ContextFeature] = []
    for element in elements:
        tags = element.get("tags", {})
        points = _coordinates(element)
        if len(points) < 2:
            continue

        kind: str | None = None
        subtype: str | None = None
        width_m: float | None = None
        if tags.get("highway"):
            kind = "road"
            subtype = str(tags["highway"])
            width_m = _width_m(tags.get("width"))
        elif tags.get("waterway"):
            kind = "waterway"
            subtype = str(tags["waterway"])
            width_m = _width_m(tags.get("width"))
        elif tags.get("natural") == "water" or tags.get("landuse") == "reservoir":
            if not _closed_ring(points):
                continue
            kind = "waterbody"
            subtype = str(tags.get("natural") or tags.get("landuse"))

        if kind is None:
            continue
        if kind == "waterbody":
            points = points[:-1]
        features.append(
            ContextFeature(
                id=f"{element.get('type', 'way')}/{element.get('id', len(features))}",
                kind=kind,
                coordinates=points,
                name=tags.get("name"),
                subtype=subtype,
                width_m=width_m,
            )
        )
        if len(features) >= MAX_FEATURES:
            break

    return ContextCollection(features=features, osm_available=True)
