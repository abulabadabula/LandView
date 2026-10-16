from __future__ import annotations

from app.agents.contracts import HouseDesignChatRequest


def assess_planning_readiness(request: HouseDesignChatRequest) -> dict[str, str]:
    """Gate planning work until verified rules and candidate/site geometry are provided."""
    missing = []
    if not request.site_context.parcel_loaded:
        missing.append("selected parcel terrain/site data is not loaded")
    missing.append("a planner-confirmed, versioned planning rule pack is not attached")
    missing.append("a calculated 3D Legal Envelope and candidate geometry are not supplied")
    return {
        "status": "BLOCKED",
        "reason": "; ".join(missing) + ".",
    }
