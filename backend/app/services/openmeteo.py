"""Open-Meteo (free, no key): elevation (Copernicus 90 m DEM) and ERA5 climate archive."""
import asyncio
from datetime import date, timedelta

import httpx

from app.config import get_settings
from app.services.errors import UpstreamError

_elev_cache: dict[tuple[float, float], float] = {}
_BATCH = 100


async def _elevation_batch(client: httpx.AsyncClient, pts: list[tuple[float, float]]) -> list[float]:
    s = get_settings()
    params = {
        "latitude": ",".join(f"{p[0]:.5f}" for p in pts),
        "longitude": ",".join(f"{p[1]:.5f}" for p in pts),
    }
    r = await client.get(s.open_meteo_elevation_url, params=params)
    r.raise_for_status()
    return r.json()["elevation"]


async def elevations(points: list[tuple[float, float]]) -> list[float]:
    """Elevation (m) for (lat, lon) points; batched, concurrent and cached."""
    keys = [(round(la, 5), round(lo, 5)) for la, lo in points]
    missing = list(dict.fromkeys(k for k in keys if k not in _elev_cache))
    if missing:
        batches = [missing[i : i + _BATCH] for i in range(0, len(missing), _BATCH)]
        try:
            async with httpx.AsyncClient(timeout=get_settings().http_timeout) as client:
                results = await asyncio.gather(*(_elevation_batch(client, b) for b in batches))
        except (httpx.HTTPError, KeyError, ValueError) as e:
            raise UpstreamError(f"Open-Meteo elevation failed: {e}") from e
        for b, res in zip(batches, results):
            _elev_cache.update(zip(b, res))
    return [_elev_cache[k] for k in keys]


async def climate_summary(lat: float, lon: float, years: int = 5) -> dict:
    """Daily ERA5 archive over the last `years` full years -> max gust, mean temp, annual rain."""
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
        async with httpx.AsyncClient(timeout=max(get_settings().http_timeout, 30)) as client:
            r = await client.get(get_settings().open_meteo_archive_url, params=params)
            r.raise_for_status()
            d = r.json()["daily"]
    except (httpx.HTTPError, KeyError, ValueError) as e:
        raise UpstreamError(f"Open-Meteo climate archive failed: {e}") from e

    temps = [t for t in d["temperature_2m_mean"] if t is not None]
    rain = [x for x in d["precipitation_sum"] if x is not None]
    gusts = [g for g in d["wind_gusts_10m_max"] if g is not None]
    return {
        "mean_temp_c": sum(temps) / len(temps) if temps else 0.0,
        "annual_rain_mm": sum(rain) / years if rain else 0.0,
        "max_gust_ms": max(gusts) if gusts else 0.0,
        "years": years,
    }
