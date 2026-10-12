"""Elevation facade with source-aware LINZ LiDAR and Open-Meteo fallback."""
from app.config import get_settings
from app.services import linz_elevation, openmeteo
from app.services.errors import UpstreamError


def source_name() -> str:
    """Return the preferred source, not a guarantee of coverage at every address."""
    return "LINZ LiDAR DEM" if get_settings().linz_basemaps_key else "Open-Meteo 90 m DEM (fallback)"


async def elevations_with_source(
    points: list[tuple[float, float]],
    spacing_m: float = 25.0,
) -> tuple[list[float | None], str]:
    """Read LINZ DEM where available, otherwise fall back to the coarse global DEM."""
    if get_settings().linz_basemaps_key:
        try:
            values = await linz_elevation.elevations(points, spacing_m, surface="dem")
            return values, "LINZ LiDAR DEM"
        except UpstreamError:
            # LINZ coverage can vary by area. Keep the address/model usable when tiles
            # are missing, but label the fallback honestly in the viewer.
            values = await openmeteo.elevations(points)
            return values, "Open-Meteo 90 m DEM fallback (LINZ data unavailable)"

    return await openmeteo.elevations(points), "Open-Meteo 90 m DEM fallback"


async def elevations(
    points: list[tuple[float, float]],
    spacing_m: float = 25.0,
) -> list[float | None]:
    values, _source = await elevations_with_source(points, spacing_m)
    return values
