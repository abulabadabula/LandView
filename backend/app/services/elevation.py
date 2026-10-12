"""Elevation facade: LINZ LiDAR DEM when a Basemaps key is configured, else Open-Meteo (90 m)."""
from app.config import get_settings
from app.services import linz_elevation, openmeteo


def source_name() -> str:
    return "LINZ LiDAR DEM" if get_settings().linz_basemaps_key else "Open-Meteo 90 m DEM (fallback)"


async def elevations(points: list[tuple[float, float]], spacing_m: float = 25.0) -> list[float]:
    if get_settings().linz_basemaps_key:
        return await linz_elevation.elevations(points, spacing_m)
    return await openmeteo.elevations(points)
