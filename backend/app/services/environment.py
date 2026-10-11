import math

from app.schemas import Climate, Environment, TerrainGrid, Topography, WindInfo
from app.services import openmeteo
from app.services.geo import offset_latlon

WIND_DISCLAIMER = (
    "Indicative only, estimated from 5 years of ERA5 reanalysis gusts. It is not an NZS 3604 "
    "site-specific wind zone. Confirm with your council or a structural engineer."
)


def indicative_wind_zone(max_gust_ms: float) -> str:
    # Heuristic buckets named after the NZS 3604 zones; replace with council wind-zone data when available.
    for limit, name in ((22, "Low"), (27, "Medium"), (32, "High"), (37, "Very High")):
        if max_gust_ms < limit:
            return name
    return "Extra High"


async def topography_at(lat: float, lon: float, spacing_m: float = 100.0) -> Topography:
    """Slope/aspect from a 3x3 elevation grid (Horn's method). Rows run south->north."""
    pts = [offset_latlon(lat, lon, dx * spacing_m, dy * spacing_m) for dy in (-1, 0, 1) for dx in (-1, 0, 1)]
    z = await openmeteo.elevations(pts)
    e = [z[0:3], z[3:6], z[6:9]]
    dzdx = ((e[0][2] + 2 * e[1][2] + e[2][2]) - (e[0][0] + 2 * e[1][0] + e[2][0])) / (8 * spacing_m)
    dzdy = ((e[2][0] + 2 * e[2][1] + e[2][2]) - (e[0][0] + 2 * e[0][1] + e[0][2])) / (8 * spacing_m)
    slope = math.degrees(math.atan(math.hypot(dzdx, dzdy)))
    aspect = None if slope < 1 else (math.degrees(math.atan2(-dzdx, -dzdy)) + 360) % 360  # downslope direction
    return Topography(elevation_m=e[1][1], slope_deg=round(slope, 1), aspect_deg=None if aspect is None else round(aspect))


async def environment_at(lat: float, lon: float) -> Environment:
    import asyncio

    topo, clim = await asyncio.gather(topography_at(lat, lon), openmeteo.climate_summary(lat, lon))
    gust = clim["max_gust_ms"]
    return Environment(
        topography=topo,
        wind=WindInfo(
            zone=indicative_wind_zone(gust),
            max_gust_ms=round(gust, 1),
            basis="Open-Meteo ERA5 archive, 5-year maximum daily gust at 10 m",
            disclaimer=WIND_DISCLAIMER,
        ),
        climate=Climate(mean_temp_c=round(clim["mean_temp_c"], 1), annual_rain_mm=round(clim["annual_rain_mm"]), years=clim["years"]),
    )


async def terrain_grid(lat: float, lon: float, size_m: float = 1000.0, n: int = 25) -> TerrainGrid:
    """Build a visual terrain grid from the Open-Meteo 90 m DEM."""
    pts = [
        offset_latlon(lat, lon, (c / (n - 1) - 0.5) * size_m, (r / (n - 1) - 0.5) * size_m)
        for r in range(n)
        for c in range(n)
    ]
    z = await openmeteo.elevations(pts)
    return TerrainGrid(center_lat=lat, center_lon=lon, size_m=size_m, n=n, elevations=z, min_elevation=min(z), max_elevation=max(z))
