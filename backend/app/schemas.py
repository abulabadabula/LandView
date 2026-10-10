from typing import Any

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Serialises to camelCase JSON for the TypeScript frontend."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class AddressResult(CamelModel):
    id: int
    full_address: str
    lat: float
    lon: float


class BoundaryPoint(CamelModel):
    index: int
    lon: float
    lat: float
    nztm_e: float
    nztm_n: float


class Parcel(CamelModel):
    id: int | None = None
    appellation: str | None = None
    titles: str | None = None
    parcel_intent: str | None = None
    land_district: str | None = None
    area_m2: float
    geometry: dict[str, Any]
    boundary: list[BoundaryPoint]


class Topography(CamelModel):
    elevation_m: float
    slope_deg: float
    aspect_deg: float | None = None


class WindInfo(CamelModel):
    zone: str
    max_gust_ms: float
    basis: str
    disclaimer: str


class Climate(CamelModel):
    mean_temp_c: float
    annual_rain_mm: float
    years: int


class Environment(CamelModel):
    topography: Topography
    wind: WindInfo
    climate: Climate


class TerrainGrid(CamelModel):
    center_lat: float
    center_lon: float
    size_m: float
    n: int
    elevations: list[float]  # row-major, rows south->north, columns west->east
    min_elevation: float
    max_elevation: float
