from __future__ import annotations

import json
from typing import Any

import httpx

from app.agents.contracts import HouseDesignChatRequest, HouseDesignIntentPatch
from app.config import Settings

SYSTEM_PROMPT = """You are the language/intent component of LandView's New Zealand house-design assistant.
Return one JSON object with exactly these keys: assistantMessage (string) and intentPatch (object).
Only propose fields explicitly requested or unambiguously implied by the user's message.
Allowed intentPatch fields and values:
- storeys: integer 1..4
- bedrooms: integer 1..10
- grossFloorAreaTargetM2: number >20 and <=2000
- style: Contemporary, Modern, Traditional, Minimalist, Coastal, Scandinavian
- roof: Gable roof, Hip roof, Flat roof, Mono-pitch roof, Mixed roof
- garage: No garage, Single garage, Double garage, Carport
- terrainAdaptation: Adapt to terrain, Level pad, Stepped floor plates
Do not include a field if the user did not specify it. Do not add unknown keys.
Never claim that a design is compliant, permitted, consent-free, structurally safe, or approved.
Do not invent District Plan clause numbers, zoning, measurements, survey facts, or legal interpretations.
Explain that planning compliance remains NOT EVALUATED until deterministic geometry checks are run against a verified, versioned rule pack.
Use the same language as the latest user message. Keep responses concise and identify proposed parameter updates."""


async def ask_llm_for_intent(
    request: HouseDesignChatRequest,
    settings: Settings,
) -> tuple[str, HouseDesignIntentPatch] | None:
    """Optional LLM adapter. Invalid/unavailable responses fall back to deterministic parsing."""
    if not settings.openai_api_key:
        return None

    messages: list[dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    for item in request.history[-8:]:
        messages.append({"role": item.role, "content": item.content})
    context: dict[str, Any] = {
        "currentDesign": request.current_design.model_dump(by_alias=True, exclude_none=True),
        "siteContext": request.site_context.model_dump(by_alias=True, exclude_none=True),
        "latestUserMessage": request.message,
    }
    messages.append({"role": "user", "content": json.dumps(context, ensure_ascii=False)})

    url = settings.openai_base_url.rstrip("/") + "/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=settings.http_timeout) as client:
            response = await client.post(
                url,
                headers={"Authorization": "Bearer " + settings.openai_api_key},
                json={
                    "model": settings.openai_model,
                    "temperature": 0.2,
                    "response_format": {"type": "json_object"},
                    "messages": messages,
                },
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            payload = json.loads(content)
            if not isinstance(payload, dict) or not isinstance(payload.get("assistantMessage"), str):
                return None
            patch_payload = payload.get("intentPatch", {})
            if not isinstance(patch_payload, dict):
                return None
            patch = HouseDesignIntentPatch.model_validate(patch_payload)
            return payload["assistantMessage"].strip(), patch
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError):
        return None
