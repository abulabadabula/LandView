from __future__ import annotations


def make_chat_audit_record(planning_gate: dict[str, str]) -> dict[str, str]:
    """Chat-only turns are never compliance Pass/Fail results."""
    return {
        "status": "NOT_EVALUATED",
        "reason": (
            "No Pass/Fail is issued by the chat workflow. "
            + planning_gate["reason"]
            + " Submit candidate geometry and verified constraints to the deterministic validator."
        ),
    }
