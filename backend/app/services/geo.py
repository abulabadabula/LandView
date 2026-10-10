import math

from pyproj import Transformer

_to_nztm = Transformer.from_crs(4326, 2193, always_xy=True)  # WGS84 -> NZTM2000

M_PER_DEG_LAT = 111_320.0


def to_nztm(lon: float, lat: float) -> tuple[float, float]:
    return _to_nztm.transform(lon, lat)


def ring_area_m2(ring: list[list[float]]) -> float:
    """Planar area of a lon/lat ring, computed in NZTM (metres)."""
    pts = [to_nztm(p[0], p[1]) for p in ring]
    s = sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]))
    return abs(s) / 2


def offset_latlon(lat: float, lon: float, east_m: float, north_m: float) -> tuple[float, float]:
    dlat = north_m / M_PER_DEG_LAT
    dlon = east_m / (M_PER_DEG_LAT * math.cos(math.radians(lat)))
    return lat + dlat, lon + dlon
