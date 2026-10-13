"""LINZ Data Service: address search (WFS) and parcel lookup (Query API)."""
import logging
import re

import httpx
from pyproj import Transformer

from app.config import get_settings
from app.schemas import AddressResult, BoundaryPoint, Parcel
from app.services.errors import UpstreamError
from app.services.geo import ring_area_m2, to_nztm

logger = logging.getLogger(__name__)
_TO_NZTM = Transformer.from_crs(4326, 2193, always_xy=True)

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
    # LDS WFS evaluates CQL spatial filters in the layer's native CRS. The NZ
    # Building Outlines layer is stored in EPSG:2193 (NZTM2000 metres), even though
    # srsName=EPSG:4326 below requests longitude/latitude in the response. Transform
    # all four corners so the extent remains correct, then build an envelope in NZTM.
    corners = [
        _TO_NZTM.transform(w, s),
        _TO_NZTM.transform(w, n),
        _TO_NZTM.transform(e, s),
        _TO_NZTM.transform(e, n),
    ]
    min_e = min(point[0] for point in corners)
    max_e = max(point[0] for point in corners)
    min_n = min(point[1] for point in corners)
    max_n = max(point[1] for point in corners)

    # EPSG:2193 axis order in LDS WFS 2.0 spatial filters is northing/easting.
    # Keep an easting/northing retry for diagnostics/compatibility if the service
    # returns no results using the documented order.
    filters = (
        ("n/e", f"bbox(shape,{min_n:.3f},{min_e:.3f},{max_n:.3f},{max_e:.3f})"),
        ("e/n", f"bbox(shape,{min_e:.3f},{min_n:.3f},{max_e:.3f},{max_n:.3f})"),
    )
    logger.info(
        "[LandView][LINZ-buildings] request_start layer=%s bbox_lonlat=(%.6f, %.6f, %.6f, %.6f) bbox_nztm_e_n=(%.2f, %.2f, %.2f, %.2f) limit=%s",
        st.linz_building_layer, w, s, e, n, min_e, min_n, max_e, max_n, limit,
    )
    last_error: Exception | None = None
    async with httpx.AsyncClient(timeout=max(st.http_timeout, 40)) as client:
        for attempt, (axis_order, cql) in enumerate(filters, start=1):
            try:
                r = await client.get(st.linz_wfs_url.format(key=key), params={**base, "cql_filter": cql})
                r.raise_for_status()
                payload = r.json()
                feats = payload.get("features", [])
                logger.info(
                    "[LandView][LINZ-buildings] attempt=%s axis_order=%s http_status=%s raw_features=%s",
                    attempt, axis_order, r.status_code, len(feats),
                )
            except (httpx.HTTPError, ValueError) as ex:
                last_error = ex
                logger.warning(
                    "[LandView][LINZ-buildings] attempt=%s axis_order=%s request_failed status=%s error=%s",
                    attempt, axis_order, getattr(getattr(ex, "response", None), "status_code", None), ex,
                )
                continue
            feats = [{**f, "geometry": _normalize_geometry(f["geometry"])} for f in feats if f.get("geometry")]
            logger.info(
                "[LandView][LINZ-buildings] attempt=%s axis_order=%s features_with_geometry=%s geometry_types_sample=%s",
                attempt,
                axis_order,
                len(feats),
                [f.get("geometry", {}).get("type") for f in feats[:5]],
            )
            if feats:
                logger.info("[LandView][LINZ-buildings] request_success returned_features=%s", len(feats))
                return feats
    if last_error:
        logger.error(
            "[LandView][LINZ-buildings] request_failed_all_attempts bbox_lonlat=(%.6f, %.6f, %.6f, %.6f) last_error=%s",
            w, s, e, n, last_error,
        )
        raise UpstreamError(f"LINZ building outlines failed: {last_error}") from last_error
    logger.warning(
        "[LandView][LINZ-buildings] request_completed_no_features bbox_lonlat=(%.6f, %.6f, %.6f, %.6f)",
        w, s, e, n,
    )
    return []
