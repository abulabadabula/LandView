from app.agents.contracts import HouseDesignChatRequest
from app.agents.intent_parser import parse_design_intent
from app.agents.orchestrator import run_house_design_chat
from app.config import Settings


def test_deterministic_parser_extracts_chinese_and_english_preferences():
    patch = parse_design_intent("两层、4卧室，200 m²，双车库，钢板屋顶用双坡形式，不要错层")
    values = patch.model_dump(exclude_none=True, by_alias=True)

    assert values["storeys"] == 2
    assert values["bedrooms"] == 4
    assert values["grossFloorAreaTargetM2"] == 200
    assert values["garage"] == "Double garage"
    assert values["roof"] == "Gable roof"
    assert values["terrainAdaptation"] == "Level pad"


def test_deterministic_parser_does_not_invent_unspecified_changes():
    patch = parse_design_intent("Please make the front entrance feel more welcoming.")
    assert patch.model_dump(exclude_none=True) == {}


async def test_chat_workflow_never_claims_compliance_pass():
    request = HouseDesignChatRequest(
        conversationId="test-conversation",
        message="Please design a two storey, four bedroom house with 200 m2 and a double garage.",
        currentDesign={
            "storeys": 2,
            "bedrooms": 4,
            "grossFloorAreaTargetM2": 200,
            "style": "Contemporary",
            "roof": "Gable roof",
            "garage": "Double garage",
            "terrainAdaptation": "Adapt to terrain",
        },
    )
    response = await run_house_design_chat(request, Settings(openai_api_key=""))

    assert response.intent_patch.storeys == 2
    assert response.intent_patch.bedrooms == 4
    assert response.audit_status == "NOT_EVALUATED"
    assert response.blackboard_version == 1
    assert any(step.agent == "ComplianceAuditorAgent" for step in response.agent_trace)
