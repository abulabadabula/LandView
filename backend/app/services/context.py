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


def _same_point(a: list[float], b: list[float]) -> bool:
    return abs(a[0] - b[0]) < 1e-7 and abs(a[1] - b[1]) < 1e-7


def _closed_ring(points: list[list[float]]) -> bool:
    return len(points) >= 4 and _same_point(points[0], points[-1])


def _relation_outer_rings(element: dict) -> list[list[list[float]]]:
    """Stitch outer member ways of an OSM water multipolygon into closed rings."""
    segments = [
        _coordinates(member)
        for member in element.get("members", [])
        if member.get("type") == "way" and member.get("role") in {"outer", ""}
    ]
    segments = [segment for segment in segments if len(segment) >= 2]
    rings: list[list[list[float]]] = []

    while segments:
        current = segments.pop(0)
        changed = True
        while not _closed_ring(current) and changed:
            changed = False
            for index, segment in enumerate(segments):
                if _same_point(current[-1], segment[0]):
                    current.extend(segment[1:])
                elif _same_point(current[-1], segment[-1]):
                    current.extend(reversed(segment[:-1]))
                elif _same_point(current[0], segment[-1]):
                    current = segment[:-1] + current
                elif _same_point(current[0], segment[0]):
                    current = list(reversed(segment[1:])) + current
                else:
                    continue
                segments.pop(index)
                changed = True
                break
        if _closed_ring(current):
            rings.append(current[:-1])
    return rings


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
      relation["natural"="water"]({bbox});
      relation["landuse"="reservoir"]({bbox});
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
        is_waterbody = tags.get("natural") == "water" or tags.get("landuse") == "reservoir"

        # Water polygons are often mapped as multipolygon relations rather than a
        # single closed way. Stitch member outer rings before creating the feature.
        if element.get("type") == "relation" and is_waterbody:
            for ring_index, ring in enumerate(_relation_outer_rings(element)):
                features.append(
                    ContextFeature(
                        id=f"relation/{element.get('id', 'water')}/{ring_index}",
                        kind="waterbody",
                        coordinates=ring,
                        name=tags.get("name"),
                        subtype=str(tags.get("natural") or tags.get("landuse")),
                        width_m=None,
                    )
                )
                if len(features) >= MAX_FEATURES:
                    break
            if len(features) >= MAX_FEATURES:
                break
            continue

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
        elif is_waterbody:
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
