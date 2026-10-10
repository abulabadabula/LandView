from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "LandView API"
    cors_origins: str = "http://localhost:5173"

    linz_api_key: str = ""
    linz_wfs_url: str = "https://data.linz.govt.nz/services;key={key}/wfs"
    linz_query_url: str = "https://data.linz.govt.nz/services/query/v1/vector.json"
    linz_address_layer: str = "53353"  # NZ Street Address
    linz_parcel_layer: str = "50772"  # NZ Primary Parcels

    open_meteo_elevation_url: str = "https://api.open-meteo.com/v1/elevation"
    open_meteo_archive_url: str = "https://archive-api.open-meteo.com/v1/archive"

    http_timeout: float = 20.0

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
