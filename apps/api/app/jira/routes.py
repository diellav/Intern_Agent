"""Project status from Jira: sync the board, read the brief, see what changed."""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from app.ai_control import metered_provider
from app.core import deps
from app.core.ai_provider import Provider
from app.core.deps import Actor
from app.jira import brief as briefs
from app.jira import client
from app.jira.sync import project_row, sync_project
from app.routes.projects import staff

router = APIRouter(prefix="/api/organizations/{org_id}/projects/{project_id}")


def status(c, org_id, project_id) -> dict:
    project = project_row(c, org_id, project_id)
    modules = [dict(row) for row in c.execute(text("""
        select e.key, e.summary as name, count(i.key) as total,
            count(i.key) filter (where i.status_category='done') as done,
            count(i.key) filter (where i.status_category='indeterminate') as in_progress
        from app.jira_issues e left join app.jira_issues i on i.project_id=e.project_id and i.epic_key=e.key
        where e.project_id=:id and e.issue_type='Epic' group by e.key, e.summary order by e.key
    """), {"id": project_id}).mappings()]
    counts = c.execute(text("""
        select count(*) as total,
            count(*) filter (where status_category='done') as done,
            count(*) filter (where status_category='indeterminate') as in_progress,
            count(*) filter (where status_category='new') as to_do,
            count(*) filter (where status_category<>'done' and not assigned) as unassigned
        from app.jira_issues where project_id=:id and issue_type <> 'Epic'
    """), {"id": project_id}).mappings().one()
    latest = c.execute(text("""
        select brief, created_at, issue_count from app.project_briefs where project_id=:id order by created_at desc, last_event_id desc nulls last limit 1
    """), {"id": project_id}).mappings().first()
    events = [dict(row) for row in c.execute(text("""
        select key, kind, summary, from_status, to_status, occurred_at from app.jira_events
        where project_id=:id order by id desc limit 15
    """), {"id": project_id}).mappings()]
    return {
        "configured": client.configured(), "jira_key": project["jira_key"], "browse_url": client.browse_url(),
        "synced_at": project["jira_synced_at"], "counts": dict(counts), "modules": modules, "events": events,
        "brief": latest["brief"] if latest else None, "brief_at": latest["created_at"] if latest else None,
        "brief_outdated": bool(latest) and briefs.changed_since_brief(c, project_id),
    }


@router.get("/jira")
def project_status(org_id: UUID, project_id: UUID, actor: Actor):
    with deps.program_connection(actor, org_id) as c:
        staff(c, org_id, actor)
        return status(c, org_id, project_id)


@router.post("/jira/sync")
def sync_board(org_id: UUID, project_id: UUID, actor: Actor,
               provider: Annotated[Provider | None, Depends(metered_provider)], analyse: bool = True):
    """Syncs the board; when anything changed since the last brief, the AI updates the brief."""
    with deps.program_connection(actor, org_id) as c:
        staff(c, org_id, actor)
    result = sync_project(actor, org_id, project_id)
    with deps.program_connection(actor, org_id) as c:
        stale = briefs.changed_since_brief(c, project_id)
    if analyse and stale and provider is not None and result["issues"]:
        briefs.generate(actor, org_id, project_id, provider)
    with deps.program_connection(actor, org_id) as c:
        return {**status(c, org_id, project_id), "sync": result}


@router.post("/brief")
def refresh_brief(org_id: UUID, project_id: UUID, actor: Actor,
                  provider: Annotated[Provider | None, Depends(metered_provider)]):
    with deps.program_connection(actor, org_id) as c:
        staff(c, org_id, actor)
    if provider is None:
        raise HTTPException(503, "AI is not configured on the server.")
    briefs.generate(actor, org_id, project_id, provider)
    with deps.program_connection(actor, org_id) as c:
        return status(c, org_id, project_id)
