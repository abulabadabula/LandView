"""LINZ Data Service: address search (WFS) and parcel lookup (Query API)."""
import re

import httpx

from app.config import get_settings
from app.schemas import AddressResult, BoundaryPoint, Parcel
from app.services.errors import UpstreamError
from app.services.geo import ring_area_m2, to_nztm

_SKIP_INTENTS = {"Road", "Hydro", "Railway"}


def _require_key() -> str:
    key = get_settings().linz_api_key
    if not key:
        raise UpstreamError("LINZ_API_KEY is not set. Add it to backend/.env (free key from data.linz.govt.nz).", 503)
    return key


def _lonlat(coords: list[float]) -> tuple[float, float]:
    """Return (lon, lat); tolerate servers that answer in lat/lon order (NZ lat is negative)."""
    a, b = coords[0], coords[1]
    return (b, a) if a < 0 < b else (a, b)


async def search_addresses(q: str, limit: int = 8) -> list[AddressResult]:
    s = get_settings()
    key = _require_key()
    tokens = re.findall(r"[\w/]+", q)  # word chars only -> safe to embed in CQL
    if not tokens:
        return []
    pattern = "%".join(tokens) + "%"
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": f"layer-{s.linz_address_layer}",
        "outputFormat": "application/json",
        "srsName": "EPSG:4326",
        "count": limit,
        "cql_filter": f"full_address ILIKE '{pattern}'",
    }
    async with httpx.AsyncClient(timeout=s.http_timeout) as client:
        try:
            r = await client.get(s.linz_wfs_url.format(key=key), params=params)
            r.raise_for_status()
            data = r.json()
        except (httpx.HTTPError, ValueError) as e:
            raise UpstreamError(f"LINZ address search failed: {e}") from e

    out: list[AddressResult] = []
    for f in data.get("features", []):
        props, geom = f.get("properties", {}), f.get("geometry") or {}
        if geom.get("type") != "Point":
            continue
        lon, lat = _lonlat(geom["coordinates"])
        out.append(AddressResult(id=int(props["address_id"]), full_address=props["full_address"], lat=lat, lon=lon))
    return out


async def get_parcel_at(lat: float, lon: float) -> Parcel | None:
    s = get_settings()
    key = _require_key()
    params = {
        "key": key,
        "layer": s.linz_parcel_layer,
        "x": lon,
        "y": lat,
        "max_results": 5,
        "geometry": "true",
        "with_field_names": "true",
    }
    async with httpx.AsyncClient(timeout=s.http_timeout) as client:
        try:
            r = await client.get(s.linz_query_url, params=params)
            r.raise_for_status()
            layers = r.json()["vectorQuery"]["layers"]
        except (httpx.HTTPError, ValueError, KeyError) as e:
            raise UpstreamError(f"LINZ parcel lookup failed: {e}") from e

    features = next(iter(layers.values()), {}).get("features", [])
    features = [f for f in features if f.get("geometry")]
    if not features:
        return None
    # prefer titled, non-road parcels
    features.sort(key=lambda f: (f["properties"].get("parcel_intent") in _SKIP_INTENTS, not f["properties"].get("titles")))
    f = features[0]
    props, geom = f["properties"], f["geometry"]

    if geom["type"] == "Polygon":
        ring = geom["coordinates"][0]
    elif geom["type"] == "MultiPolygon":
        ring = geom["coordinates"][0][0]
    else:
        return None
    pts = ring[:-1] if ring[0] == ring[-1] else ring  # drop closing vertex

    boundary = []
    for i, p in enumerate(pts, start=1):
        e, n = to_nztm(p[0], p[1])
        boundary.append(BoundaryPoint(index=i, lon=p[0], lat=p[1], nztm_e=round(e, 2), nztm_n=round(n, 2)))

    area = props.get("calc_area") or props.get("survey_area") or ring_area_m2(pts)
    return Parcel(
        id=props.get("id"),
        appellation=props.get("appellation"),
        titles=props.get("titles"),
        parcel_intent=props.get("parcel_intent"),
        land_district=props.get("land_district"),
        area_m2=round(float(area), 1),
        geometry=geom,
        boundary=boundary,
    )


def _normalize_geometry(geom: dict) -> dict:
    """Make sure coordinates are [lon, lat] (some WFS servers answer lat/lon)."""

    def first(c):
        while isinstance(c[0], list):
            c = c[0]
        return c

    a, b = first(geom["coordinates"])[:2]
    if not (a < 0 < b):
        return geom

    def swap(c):
        return [c[1], c[0], *c[2:]] if not isinstance(c[0], list) else [swap(x) for x in c]

    return {**geom, "coordinates": swap(geom["coordinates"])}


async def building_outlines(w: float, s: float, e: float, n: float, limit: int = 3000) -> list[dict]:
    """NZ Building Outlines inside a lon/lat bbox (LINZ WFS). Returns GeoJSON features."""
    st = get_settings()
    key = _require_key()
    base = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": f"layer-{st.linz_building_layer}",
        "outputFormat": "application/json",
        "srsName": "EPSG:4326",
        "count": limit,
    }
    # Axis order in CQL BBOX differs between servers, so try lon/lat first, then lat/lon.
    filters = (f"bbox(shape,{w:.6f},{s:.6f},{e:.6f},{n:.6f})", f"bbox(shape,{s:.6f},{w:.6f},{n:.6f},{e:.6f})")
    last_error: Exception | None = None
    async with httpx.AsyncClient(timeout=max(st.http_timeout, 40)) as client:
        for cql in filters:
            try:
                r = await client.get(st.linz_wfs_url.format(key=key), params={**base, "cql_filter": cql})
                r.raise_for_status()
                feats = r.json().get("features", [])
            except (httpx.HTTPError, ValueError) as ex:
                last_error = ex
                continue
            feats = [{**f, "geometry": _normalize_geometry(f["geometry"])} for f in feats if f.get("geometry")]
            if feats:
                return feats
    if last_error:
        raise UpstreamError(f"LINZ building outlines failed: {last_error}") from last_error
    return []
