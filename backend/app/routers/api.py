from fastapi import APIRouter, Query

from app.schemas import (
    AddressResult,
    BuildingCollection,
    ContextCollection,
    Environment,
    Parcel,
    TerrainGrid,
)
from app.services import buildings as building_service
from app.services import context as context_service
from app.services import environment, linz

router = APIRouter(prefix="/api")


@router.get("/health")
async def health():
    return {"status": "ok"}


@router.get("/address/search", response_model=list[AddressResult])
async def search_address(q: str = Query(min_length=3, max_length=120)):
    return await linz.search_addresses(q)


@router.get("/lot", response_model=Parcel | None)
async def lot(lat: float = Query(ge=-48, le=-33), lon: float = Query(ge=165, le=180)):
    return await linz.get_parcel_at(lat, lon)


@router.get("/environment", response_model=Environment)
async def env(lat: float = Query(ge=-48, le=-33), lon: float = Query(ge=165, le=180)):
    return await environment.environment_at(lat, lon)


@router.get("/terrain", response_model=TerrainGrid)
async def terrain(
    lat: float = Query(ge=-48, le=-33),
    lon: float = Query(ge=165, le=180),
    size_m: float = Query(1000, ge=200, le=5000),
    # Open-Meteo's DEM is 90 m resolution and its elevation endpoint accepts 100
    # coordinate pairs per request. 25x25 gives a smoother visual interpolation
    # without creating the 1000+ point request burst used previously.
    n: int = Query(25, ge=5, le=33),
):
    return await environment.terrain_grid(lat, lon, size_m, n)


@router.get("/buildings", response_model=BuildingCollection)
async def buildings(
    lat: float = Query(ge=-48, le=-33),
    lon: float = Query(ge=165, le=180),
    size_m: float = Query(1000, ge=200, le=3000),
):
    return await building_service.buildings_around(lat, lon, size_m)


@router.get("/context", response_model=ContextCollection)
async def context(
    lat: float = Query(ge=-48, le=-33),
    lon: float = Query(ge=165, le=180),
    size_m: float = Query(1000, ge=200, le=3000),
):
    return await context_service.context_around(lat, lon, size_m)
