"""Open-Meteo (free, no key): elevation (Copernicus 90 m DEM) and ERA5 climate archive."""
import asyncio
from datetime import date, timedelta

import httpx

from app.config import get_settings
from app.services.errors import UpstreamError

# Open-Meteo's elevation endpoint accepts at most 100 coordinate pairs per request.
# More importantly, sending many batches concurrently can trigger HTTP 429 responses.
# Keep upstream requests serialized, retry 429 responses, and cache values in-process.
_elev_cache: dict[tuple[float, float], float] = {}
_climate_cache: dict[tuple[float, float, int], dict] = {}
_UPSTREAM_LOCK = asyncio.Lock()
_BATCH = 100
_MAX_RETRIES = 4


async def _get_json(
    client: httpx.AsyncClient,
    url: str,
    params: dict,
) -> dict:
    """GET JSON from Open-Meteo without creating a burst of upstream requests."""
    for attempt in range(_MAX_RETRIES + 1):
        try:
            response = await client.get(url, params=params)
            if response.status_code == 429:
                retry_after = response.headers.get("Retry-After")
                try:
                    delay = float(retry_after) if retry_after else 0.0
                except ValueError:
                    delay = 0.0
                # If the server does not provide Retry-After, use conservative exponential backoff.
                delay = max(delay, min(8.0, 0.75 * (2**attempt)))
                if attempt >= _MAX_RETRIES:
                    response.raise_for_status()
                await asyncio.sleep(delay)
                continue
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError:
            raise
        except httpx.HTTPError:
            if attempt >= _MAX_RETRIES:
                raise
            await asyncio.sleep(min(8.0, 0.75 * (2**attempt)))
    raise RuntimeError("Open-Meteo request retry loop ended unexpectedly")


async def _elevation_batch(client: httpx.AsyncClient, pts: list[tuple[float, float]]) -> list[float]:
    s = get_settings()
    params = {
        "latitude": ",".join(f"{p[0]:.5f}" for p in pts),
        "longitude": ",".join(f"{p[1]:.5f}" for p in pts),
    }
    data = await _get_json(client, s.open_meteo_elevation_url, params)
    elevations = data.get("elevation")
    if not isinstance(elevations, list) or len(elevations) != len(pts):
        raise ValueError("Open-Meteo returned an unexpected elevation array")
    return [float(value) for value in elevations]


async def elevations(points: list[tuple[float, float]]) -> list[float]:
    """Elevation (m) for (lat, lon) points; batched, serialized and cached."""
    keys = [(round(la, 5), round(lo, 5)) for la, lo in points]
    missing = list(dict.fromkeys(k for k in keys if k not in _elev_cache))
    if missing:
        batches = [missing[i : i + _BATCH] for i in range(0, len(missing), _BATCH)]
        try:
            async with _UPSTREAM_LOCK:
                async with httpx.AsyncClient(timeout=get_settings().http_timeout) as client:
                    # Do not gather these concurrently: a 1 km/3 km terrain grid can contain
                    # hundreds/thousands of points and otherwise produces a burst of requests.
                    for batch in batches:
                        result = await _elevation_batch(client, batch)
                        _elev_cache.update(zip(batch, result))
        except (httpx.HTTPError, KeyError, ValueError) as e:
            raise UpstreamError(f"Open-Meteo elevation failed: {e}") from e
    return [_elev_cache[k] for k in keys]


async def climate_summary(lat: float, lon: float, years: int = 5) -> dict:
    """Daily ERA5 archive over the last `years` full years -> max gust, mean temp, annual rain."""
    key = (round(lat, 5), round(lon, 5), years)
    cached = _climate_cache.get(key)
    if cached is not None:
        return cached

    end = date.today() - timedelta(days=10)  # archive lags a few days
    start = end.replace(year=end.year - years)
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "daily": "temperature_2m_mean,precipitation_sum,wind_gusts_10m_max",
        "wind_speed_unit": "ms",
        "timezone": "Pacific/Auckland",
    }
    try:
        async with _UPSTREAM_LOCK:
            async with httpx.AsyncClient(timeout=max(get_settings().http_timeout, 30)) as client:
                data = await _get_json(client, get_settings().open_meteo_archive_url, params)
                d = data["daily"]
    except (httpx.HTTPError, KeyError, ValueError) as e:
        raise UpstreamError(f"Open-Meteo climate archive failed: {e}") from e

    temps = [t for t in d["temperature_2m_mean"] if t is not None]
    rain = [x for x in d["precipitation_sum"] if x is not None]
    gusts = [g for g in d["wind_gusts_10m_max"] if g is not None]
    result = {
        "mean_temp_c": sum(temps) / len(temps) if temps else 0.0,
        "annual_rain_mm": sum(rain) / years if rain else 0.0,
        "max_gust_ms": max(gusts) if gusts else 0.0,
        "years": years,
    }
    _climate_cache[key] = result
    return result
