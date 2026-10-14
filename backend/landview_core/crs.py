"""Coordinate helpers. Metric work happens in NZTM2000 (EPSG:2193)."""

import math

from pyproj import Transformer
from shapely.ops import transform as _shp_transform

NZTM_EPSG = 2193
_to_nztm = Transformer.from_crs(4326, NZTM_EPSG, always_xy=True)
_from_nztm = Transformer.from_crs(NZTM_EPSG, 4326, always_xy=True)

M_PER_DEG_LAT = 111_320.0


def to_nztm(lon: float, lat: float) -> tuple[float, float]:
    return _to_nztm.transform(lon, lat)


def from_nztm(e: float, n: float) -> tuple[float, float]:
    """Return (lon, lat)."""
    return _from_nztm.transform(e, n)


def ring_area_m2(ring: list[list[float]]) -> float:
    """Planar area of a lon/lat ring, computed in NZTM (metres)."""
    pts = [to_nztm(p[0], p[1]) for p in ring]
    s = sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1], strict=True))
    return abs(s) / 2


def offset_latlon(lat: float, lon: float, east_m: float, north_m: float) -> tuple[float, float]:
    dlat = north_m / M_PER_DEG_LAT
    dlon = east_m / (M_PER_DEG_LAT * math.cos(math.radians(lat)))
    return lat + dlat, lon + dlon


def project_geom(geom):
    """Project a shapely lon/lat geometry to NZTM (metres)."""
    return _shp_transform(_to_nztm.transform, geom)
