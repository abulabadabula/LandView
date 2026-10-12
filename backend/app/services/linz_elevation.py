"""LINZ LiDAR-derived DEM, read from LINZ Basemaps' `elevation` tile set (Terrain-RGB).

Tiles are fetched as PNG with ``pipeline=terrain-rgb`` and decoded to metres:

    height_m = -10000 + (R * 65536 + G * 256 + B) * 0.1

Pixels with alpha == 0 are "no data" (outside LiDAR coverage, or open sea).
"""
import asyncio
import math

import httpx
import numpy as np
from PIL import Image
import io

from app.config import get_settings
from app.services.errors import UpstreamError

_TILE = 256
_MIN_Z, _MAX_Z = 10, 17
_MAX_RETRIES = 3
_CONCURRENCY = 8

# (z, x, y) -> float32[256, 256] elevation array (NaN = no data), or None if the tile does not exist.
_tile_cache: dict[tuple[int, int, int], np.ndarray | None] = {}
_sem = asyncio.Semaphore(_CONCURRENCY)


def choose_zoom(lat: float, spacing_m: float) -> int:
    """Pick a zoom whose pixel size is ~1/3 of the requested sample spacing."""
    target_px_m = max(spacing_m / 3.0, 0.1)
    z = math.floor(math.log2(156543.03 * math.cos(math.radians(lat)) / target_px_m))
    return max(_MIN_Z, min(_MAX_Z, z))


def _global_pixel(lat: float, lon: float, z: int) -> tuple[float, float]:
    n = _TILE * (2**z)
    x = (lon + 180.0) / 360.0 * n
    lat_r = math.radians(lat)
    y = (1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * n
    return x, y


def _decode(png: bytes) -> np.ndarray:
    img = Image.open(io.BytesIO(png)).convert("RGBA")
    a = np.asarray(img, dtype=np.float64)
    h = -10000.0 + (a[..., 0] * 65536.0 + a[..., 1] * 256.0 + a[..., 2]) * 0.1
    h[a[..., 3] == 0] = np.nan
    return h.astype(np.float32)


async def _fetch_tile(client: httpx.AsyncClient, z: int, x: int, y: int) -> np.ndarray | None:
    key = (z, x, y)
    if key in _tile_cache:
        return _tile_cache[key]
    s = get_settings()
    url = s.linz_elevation_tile_url.format(z=z, x=x, y=y)
    params = {"api": s.linz_basemaps_key, "pipeline": "terrain-rgb"}
    async with _sem:
        for attempt in range(_MAX_RETRIES + 1):
            try:
                r = await client.get(url, params=params)
                if r.status_code == 404:
                    _tile_cache[key] = None
                    return None
                if r.status_code in (429, 502, 503, 504) and attempt < _MAX_RETRIES:
                    await asyncio.sleep(min(6.0, 0.75 * 2**attempt))
                    continue
                r.raise_for_status()
                arr = _decode(r.content)
                _tile_cache[key] = arr
                return arr
            except httpx.TransportError:
                if attempt >= _MAX_RETRIES:
                    raise
                await asyncio.sleep(min(6.0, 0.75 * 2**attempt))
    raise RuntimeError("tile retry loop ended unexpectedly")


def _px(tiles: dict[tuple[int, int, int], np.ndarray | None], z: int, ix: int, iy: int) -> float:
    t = tiles.get((z, ix // _TILE, iy // _TILE))
    return float("nan") if t is None else float(t[iy % _TILE, ix % _TILE])


def _sample(tiles, z: int, x: float, y: float) -> float:
    """Bilinear sample at global pixel coords (pixel centres at +0.5); NaN-aware."""
    fx, fy = x - 0.5, y - 0.5
    x0, y0 = math.floor(fx), math.floor(fy)
    tx, ty = fx - x0, fy - y0
    vals = (
        (_px(tiles, z, x0, y0), (1 - tx) * (1 - ty)),
        (_px(tiles, z, x0 + 1, y0), tx * (1 - ty)),
        (_px(tiles, z, x0, y0 + 1), (1 - tx) * ty),
        (_px(tiles, z, x0 + 1, y0 + 1), tx * ty),
    )
    num = den = 0.0
    for v, w in vals:
        if not math.isnan(v):
            num += v * w
            den += w
    return num / den if den > 0 else float("nan")


async def elevations(points: list[tuple[float, float]], spacing_m: float = 25.0) -> list[float]:
    """Elevation (m, NZVD2016-ish LiDAR DEM) for (lat, lon) points.

    Cells with no LiDAR data (e.g. open water) are returned as 0.0 (sea level) so the
    3D scene shows water there. Raises UpstreamError if every point is no-data.
    """
    if not get_settings().linz_basemaps_key:
        raise UpstreamError("LINZ_BASEMAPS_KEY is not set. Add it to backend/.env.", 503)
    if not points:
        return []

    z = choose_zoom(sum(p[0] for p in points) / len(points), spacing_m)
    pix = [_global_pixel(la, lo, z) for la, lo in points]

    needed: set[tuple[int, int, int]] = set()
    for x, y in pix:
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                needed.add((z, int((x + dx) // _TILE), int((y + dy) // _TILE)))

    try:
        async with httpx.AsyncClient(timeout=max(get_settings().http_timeout, 30)) as client:
            keys = sorted(needed)
            results = await asyncio.gather(*(_fetch_tile(client, *k) for k in keys))
    except (httpx.HTTPError, ValueError, OSError) as e:
        raise UpstreamError(f"LINZ elevation tiles failed: {e}") from e
    tiles = dict(zip(keys, results))

    out = [_sample(tiles, z, x, y) for x, y in pix]
    if all(math.isnan(v) for v in out):
        raise UpstreamError("No LINZ LiDAR elevation coverage at this location.", 404)
    return [0.0 if math.isnan(v) else round(v, 2) for v in out]
