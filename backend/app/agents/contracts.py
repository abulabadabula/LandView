from __future__ import annotations

from typing import Literal

from pydantic import ConfigDict, Field

from app.schemas import CamelModel


ChatRole = Literal["user", "assistant"]
RoofStyle = Literal["Gable roof", "Hip roof", "Flat roof", "Mono-pitch roof", "Mixed roof"]
GarageStyle = Literal["No garage", "Single garage", "Double garage", "Carport"]
TerrainAdaptation = Literal["Adapt to terrain", "Level pad", "Stepped floor plates"]
ArchitecturalStyle = Literal[
    "Contemporary",
    "Modern",
    "Traditional",
    "Minimalist",
    "Coastal",
    "Scandinavian",
]


class HouseChatHistoryItem(CamelModel):
    role: ChatRole
    content: str = Field(min_length=1, max_length=4000)


class CurrentHouseDesign(CamelModel):
    storeys: int = Field(default=2, ge=1, le=4)
    bedrooms: int = Field(default=4, ge=1, le=10)
    gross_floor_area_target_m2: float = Field(default=200, gt=20, le=2000)
    style: ArchitecturalStyle = "Contemporary"
    roof: RoofStyle = "Gable roof"
    garage: GarageStyle = "Double garage"
    terrain_adaptation: TerrainAdaptation = "Adapt to terrain"


class HouseChatSiteContext(CamelModel):
    address: str | None = None
    parcel_loaded: bool = False
    site_data_confidence: str | None = None


class HouseDesignChatRequest(CamelModel):
    conversation_id: str = Field(min_length=1, max_length=100)
    message: str = Field(min_length=1, max_length=4000)
    history: list[HouseChatHistoryItem] = Field(default_factory=list, max_length=20)
    blackboard_version: int = Field(default=0, ge=0)
    current_design: CurrentHouseDesign = Field(default_factory=CurrentHouseDesign)
    site_context: HouseChatSiteContext = Field(default_factory=HouseChatSiteContext)


class HouseDesignIntentPatch(CamelModel):
    model_config = ConfigDict(alias_generator=lambda value: "".join(
        [value.split("_")[0], *(piece.title() for piece in value.split("_")[1:])]
    ), populate_by_name=True, extra="forbid")

    storeys: int | None = Field(default=None, ge=1, le=4)
    bedrooms: int | None = Field(default=None, ge=1, le=10)
    gross_floor_area_target_m2: float | None = Field(default=None, gt=20, le=2000)
    style: ArchitecturalStyle | None = None
    roof: RoofStyle | None = None
    garage: GarageStyle | None = None
    terrain_adaptation: TerrainAdaptation | None = None


class AgentTraceStep(CamelModel):
    agent: str
    status: str
    summary: str


class HouseDesignChatResponse(CamelModel):
    conversation_id: str
    assistant_message: str
    intent_patch: HouseDesignIntentPatch = Field(default_factory=HouseDesignIntentPatch)
    workflow_stage: str
    audit_status: Literal["NOT_EVALUATED"] = "NOT_EVALUATED"
    audit_reason: str
    agent_trace: list[AgentTraceStep]
    provider: str
    blackboard_version: int = Field(ge=0)
