"""AI-assisted plan drafts.

The mentor asks for a draft; the backend collects the context of that one internship, asks the
provider for a proposal, and validates it against the context it offered. Nothing is written to
the database here: the draft opens in the plan editor and is saved and published through the
existing plan endpoints.
"""
import json
from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.ai_control import mark_invalid, metered_provider
from app.core import deps
from app.core.ai_provider import Provider, ProviderError, clip, planner_provider
from app.core.deps import Actor
from app.jira.sync import refresh_jira
from app.plans.context import _tasks, collect_context
from app.plans.crud import plan_parent
from app.plans.prompt import SYSTEM_PROMPT
from app.plans.schemas import GenerateInput, GeneratedDraft, Suggestion, proposal_schema
from app.plans.validate import validate_proposal

router = APIRouter(prefix="/api/organizations/{org_id}")


@router.get("/ai/status")
def ai_status(org_id: UUID, actor: Actor, provider: Annotated[Provider | None, Depends(planner_provider)]):
    with deps.program_connection(actor, org_id):
        pass
    return {"configured": provider is not None, "model": provider.model if provider else None}


@router.get("/internships/{internship_id}/plans/suggestions")
def focus_suggestions(org_id: UUID, internship_id: UUID, actor: Actor) -> list[Suggestion]:
    """Deterministic focus ideas from requested changes and overdue work. No AI involved."""
    with deps.program_connection(actor, org_id) as connection:
        plan_parent(connection, org_id, internship_id, actor)
        rows = _tasks(connection, internship_id)
    today = date.today()
    suggestions: list[Suggestion] = []
    for row in rows:
        if row["status"] == "changes_requested" and row["feedback"]:
            suggestions.append(Suggestion(focus=f"Address the review on “{row['title']}”: {clip(row['feedback'], 160)}",
                                          source=f"Review of version {row['version']}", task_id=row["id"], version=row["version"]))
    for row in rows:
        if row["status"] in ("planned", "changes_requested") and row["due_on"] < today:
            suggestions.append(Suggestion(focus=f"Finish the overdue task “{row['title']}”",
                                          source=f"Overdue since {row['due_on'].isoformat()}", task_id=row["id"], version=None))
    return suggestions[:4]



@router.post("/internships/{internship_id}/plans/generate")
def generate_plan(org_id: UUID, internship_id: UUID, actor: Actor, data: GenerateInput,
                  provider: Annotated[Provider | None, Depends(metered_provider)]) -> GeneratedDraft:
    if data.starts_on > data.ends_on:
        raise HTTPException(422, "The end date must follow the start date.")
    refresh_jira(actor, org_id, internship_id)  # outside the transaction: may call Jira
    # Read the context in a short transaction; the provider call happens without a database connection.
    with deps.program_connection(actor, org_id) as connection:
        context = collect_context(connection, org_id, internship_id, actor, data)
    if provider is None:
        raise HTTPException(503, "AI drafting is not configured on the server. You can still write the plan manually.")
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(context["payload"], ensure_ascii=False)},
    ]
    try:
        raw = provider.complete(messages, proposal_schema(list(context["open"])))
    except ProviderError as exc:
        raise HTTPException(exc.status, exc.message) from None
    try:
        draft, notes, workload, warnings = validate_proposal(raw, context, data)
    except ProviderError as exc:
        mark_invalid(provider)
        raise HTTPException(exc.status, exc.message) from None
    return GeneratedDraft(draft=draft, notes=notes, workload=workload, warnings=warnings, model=provider.model)
