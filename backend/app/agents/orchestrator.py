from __future__ import annotations

import logging

from app.agents.compliance_auditor import make_chat_audit_record
from app.agents.contracts import (
    AgentTraceStep,
    HouseDesignChatRequest,
    HouseDesignChatResponse,
    HouseDesignIntentPatch,
)
from app.agents.intent_parser import parse_design_intent
from app.agents.llm_agent import ask_llm_for_intent
from app.agents.planning_agent import assess_planning_readiness
from app.agents.strategy_agent import build_strategy_reply
from app.config import Settings

logger = logging.getLogger(__name__)


async def run_house_design_chat(
    request: HouseDesignChatRequest,
    settings: Settings,
) -> HouseDesignChatResponse:
    """Orchestrate proposed changes while keeping legal/audit decisions outside the LLM."""
    deterministic_patch = parse_design_intent(request.message)
    selected_patch = deterministic_patch
    assistant_message = build_strategy_reply(request, deterministic_patch)
    provider = "deterministic"

    if settings.openai_api_key:
        llm_result = await ask_llm_for_intent(request, settings)
        if llm_result is not None:
            llm_message, llm_patch = llm_result
            merged = llm_patch.model_dump(exclude_none=True)
            merged.update(deterministic_patch.model_dump(exclude_none=True))
            try:
                selected_patch = HouseDesignIntentPatch.model_validate(merged)
                assistant_message = llm_message or build_strategy_reply(request, selected_patch)
                base_url = settings.openai_base_url.lower()
                provider = "gemini" if "generativelanguage.googleapis.com" in base_url else "openai-compatible"
            except ValueError:
                logger.warning("Rejected invalid house-design intent patch returned by LLM")
                selected_patch = deterministic_patch
                assistant_message = build_strategy_reply(request, deterministic_patch)

    patch_values = selected_patch.model_dump(exclude_none=True)
    planning_gate = assess_planning_readiness(request)
    audit = make_chat_audit_record(planning_gate)
    trace = [
        AgentTraceStep(
            agent="IntentParserAgent",
            status="SUCCEEDED",
            summary="Extracted structured design intent; no compliance decision was made.",
        ),
        AgentTraceStep(
            agent="StrategyAgent",
            status="PATCH_PROPOSED" if patch_values else "NO_PARAMETER_CHANGE",
            summary="Prepared a typed parameter patch for the frontend design blackboard.",
        ),
        AgentTraceStep(
            agent="PlanningAgent",
            status=planning_gate["status"],
            summary=planning_gate["reason"],
        ),
        AgentTraceStep(
            agent="ComplianceAuditorAgent",
            status=audit["status"],
            summary=audit["reason"],
        ),
    ]

    return HouseDesignChatResponse(
        conversation_id=request.conversation_id,
        assistant_message=assistant_message,
        intent_patch=selected_patch,
        workflow_stage="CHAT_PROPOSAL_AUDIT_BLOCKED",
        audit_status="NOT_EVALUATED",
        audit_reason=audit["reason"],
        agent_trace=trace,
        provider=provider,
        blackboard_version=request.blackboard_version + (1 if patch_values else 0),
    )
