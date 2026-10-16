from fastapi import APIRouter, HTTPException, Query

from app.agents.contracts import HouseDesignChatRequest, HouseDesignChatResponse
from app.agents.orchestrator import run_house_design_chat
from app.config import get_settings
from app.schemas import (
    AddressResult,
    BuildingCollection,
    ContextCollection,
    Environment,
    Parcel,
    ParcelSetbackRequest,
    ParcelSetbackResult,
    TerrainGrid,
)
from app.schemas_house import (
    HouseDesignSpec,
    HouseDesignSpecValidationResult,
    HouseDesignValidationRequest,
    HouseDesignValidationResult,
)
from app.services import buildings as building_service
from app.services import context as context_service
from app.services import environment, linz
from app.services import setback as setback_service
from app.services.house_design_validation import validate_house_design

from landview_core.rules import (
    RulePackError,
    RulePackEvaluationRequest,
    RulePackEvaluationResult,
    RulePackSummary,
    evaluate_rule_pack,
    list_registered_rule_pack_summaries,
    load_registered_rule_pack,
)


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

@router.post("/parcel/setback", response_model=ParcelSetbackResult)
async def parcel_setback(request: ParcelSetbackRequest):
    """Return an inward parcel buffer and its WGS84/NZTM control coordinates."""
    return setback_service.create_parcel_setback(request)


@router.get("/house-design/spec/schema")
async def house_design_spec_schema():
    """Return the machine-readable HouseDesignSpec JSON Schema."""
    schema = HouseDesignSpec.model_json_schema(by_alias=True)
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    schema["$id"] = "urn:landview:HouseDesignSpec:1.0.0"
    return schema


@router.post("/house-design/spec/validate", response_model=HouseDesignSpecValidationResult)
async def validate_house_design_spec(spec: HouseDesignSpec):
    """Validate and normalise design intent. This does not generate geometry."""
    return HouseDesignSpecValidationResult(valid=True, spec=spec)


@router.post("/house-design/constraints/validate", response_model=HouseDesignValidationResult)
async def house_design_constraints_validate(request: HouseDesignValidationRequest):
    """Check a supplied candidate against supplied site geometry and rule data."""
    return validate_house_design(request)


@router.post("/house-design/agent/chat", response_model=HouseDesignChatResponse, response_model_exclude_none=True)
async def house_design_agent_chat(request: HouseDesignChatRequest):
    """Run the house-design chat workflow; this endpoint does not issue compliance Pass/Fail."""
    return await run_house_design_chat(request, get_settings())


@router.get("/house-design/rules/packs", response_model=list[RulePackSummary])
async def house_design_rule_packs():
    """List the versioned planning rule packs registered on the backend."""
    return list_registered_rule_pack_summaries()


@router.post("/house-design/rules/evaluate", response_model=RulePackEvaluationResult)
async def evaluate_house_design_rule_pack(request: RulePackEvaluationRequest):
    """Evaluate scalar measurements against a registry pack; drafts are always blocked."""
    try:
        pack = load_registered_rule_pack(request.pack_id)
    except RulePackError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return evaluate_rule_pack(pack, request.measurements)


@router.get("/environment", response_model=Environment)
async def env(lat: float = Query(ge=-48, le=-33), lon: float = Query(ge=165, le=180)):
    return await environment.environment_at(lat, lon)

@router.get("/terrain", response_model=TerrainGrid)
async def terrain(
    lat: float = Query(ge=-48, le=-33),
    lon: float = Query(ge=165, le=180),
    size_m: float = Query(1000, ge=200, le=5000),
    # LINZ LiDAR tiles have no per-request point limit, so a denser grid is cheap.
    n: int = Query(65, ge=5, le=129),
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
