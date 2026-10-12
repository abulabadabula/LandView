"""Read LINZ DEM/DSM Terrain-RGB tiles and sample elevations in metres."""
import asyncio
import io
import math

import httpx
import numpy as np
from PIL import Image

from app.config import get_settings
from app.services.errors import UpstreamError

_TILE = 256
_MIN_Z, _MAX_Z = 10, 18
_MAX_RETRIES = 3
_CONCURRENCY = 8

# (surface, z, x, y) -> float32 tile; None means there is no source tile.
_tile_cache: dict[tuple[str, int, int, int], np.ndarray | None] = {}
_sem = asyncio.Semaphore(_CONCURRENCY)


def choose_zoom(lat: float, spacing_m: float) -> int:
    """Choose a web-mercator zoom with pixel size near one third of sample spacing."""
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
    """Decode Mapbox Terrain-RGB into metres."""
    img = Image.open(io.BytesIO(png)).convert("RGBA")
    rgba = np.asarray(img, dtype=np.float64)
    h = -10000.0 + (rgba[..., 0] * 65536.0 + rgba[..., 1] * 256.0 + rgba[..., 2]) * 0.1
    h[rgba[..., 3] == 0] = np.nan
    return h.astype(np.float32)


async def _fetch_tile(
    client: httpx.AsyncClient,
    surface: str,
    z: int,
    x: int,
    y: int,
) -> np.ndarray | None:
    key = (surface, z, x, y)
    if key in _tile_cache:
        return _tile_cache[key]

    settings = get_settings()
    template = settings.linz_dsm_tile_url if surface == "dsm" else settings.linz_elevation_tile_url
    url = template.format(z=z, x=x, y=y)
    params = {"api": settings.linz_basemaps_key, "pipeline": "terrain-rgb"}

    async with _sem:
        for attempt in range(_MAX_RETRIES + 1):
            try:
                response = await client.get(url, params=params)
                if response.status_code == 404:
                    _tile_cache[key] = None
                    return None
                if response.status_code in (429, 502, 503, 504) and attempt < _MAX_RETRIES:
                    await asyncio.sleep(min(6.0, 0.75 * (2**attempt)))
                    continue
                response.raise_for_status()
                tile = _decode(response.content)
                _tile_cache[key] = tile
                return tile
            except httpx.TransportError:
                if attempt >= _MAX_RETRIES:
                    raise
                await asyncio.sleep(min(6.0, 0.75 * (2**attempt)))

    raise RuntimeError("LINZ tile retry loop ended unexpectedly")


def _pixel(
    tiles: dict[tuple[str, int, int, int], np.ndarray | None],
    surface: str,
    z: int,
    pixel_x: int,
    pixel_y: int,
) -> float:
    tile = tiles.get((surface, z, pixel_x // _TILE, pixel_y // _TILE))
    if tile is None:
        return float("nan")
    return float(tile[pixel_y % _TILE, pixel_x % _TILE])


def _sample(
    tiles: dict[tuple[str, int, int, int], np.ndarray | None],
    surface: str,
    z: int,
    x: float,
    y: float,
) -> float:
    """Bilinear, no-data-aware sample; pixel centres are at global coordinate +0.5."""
    fx, fy = x - 0.5, y - 0.5
    x0, y0 = math.floor(fx), math.floor(fy)
    tx, ty = fx - x0, fy - y0
    weighted = (
        (_pixel(tiles, surface, z, x0, y0), (1 - tx) * (1 - ty)),
        (_pixel(tiles, surface, z, x0 + 1, y0), tx * (1 - ty)),
        (_pixel(tiles, surface, z, x0, y0 + 1), (1 - tx) * ty),
        (_pixel(tiles, surface, z, x0 + 1, y0 + 1), tx * ty),
    )
    numerator = denominator = 0.0
    for value, weight in weighted:
        if not math.isnan(value):
            numerator += value * weight
            denominator += weight
    return numerator / denominator if denominator > 0 else float("nan")


async def elevations(
    points: list[tuple[float, float]],
    spacing_m: float = 25.0,
    surface: str = "dem",
    allow_nodata: bool = False,
) -> list[float | None]:
    """Sample DEM or DSM elevations for (latitude, longitude) points.

    allow_nodata=True returns None for uncovered pixels. Terrain generation defaults
    missing ocean/out-of-coverage values to sea level, while height estimation excludes them.
    """
    if surface not in {"dem", "dsm"}:
        raise ValueError("surface must be 'dem' or 'dsm'")
    settings = get_settings()
    if not settings.linz_basemaps_key:
        raise UpstreamError("LINZ_BASEMAPS_KEY is not set. Add it to backend/.env.", 503)
    if not points:
        return []

    mean_lat = sum(point[0] for point in points) / len(points)
    z = choose_zoom(mean_lat, spacing_m)
    pixels = [_global_pixel(lat, lon, z) for lat, lon in points]

    needed: set[tuple[str, int, int, int]] = set()
    for x, y in pixels:
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                needed.add((surface, z, int((x + dx) // _TILE), int((y + dy) // _TILE)))

    keys = sorted(needed)
    try:
        async with httpx.AsyncClient(timeout=max(settings.http_timeout, 30)) as client:
            results = await asyncio.gather(
                *(_fetch_tile(client, surface, tile_z, tile_x, tile_y) for _, tile_z, tile_x, tile_y in keys)
            )
    except (httpx.HTTPError, ValueError, OSError) as error:
        raise UpstreamError("LINZ " + surface.upper() + " tiles failed: " + str(error)) from error

    tiles = dict(zip(keys, results))
    sampled = [_sample(tiles, surface, z, x, y) for x, y in pixels]
    if all(math.isnan(value) for value in sampled) and not allow_nodata:
        raise UpstreamError("No LINZ " + surface.upper() + " elevation coverage at this location.", 404)
    if allow_nodata:
        return [None if math.isnan(value) else round(value, 2) for value in sampled]
    return [0.0 if math.isnan(value) else round(value, 2) for value in sampled]
