"""Keeps a copy of each project's Jira issues and records what changed between syncs.

The copy is what the AI reads (plans, CV fit, project brief), so it does not call Jira on every request.
Changes between syncs (new issues, status moves, removed issues) are the project's recent history.
"""
import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text

from app.core import deps
from app.jira import client

log = logging.getLogger("internagent.jira")
FRESH_FOR = timedelta(minutes=15)
COLUMNS = ("key", "summary", "issue_type", "status", "status_category", "parent_key", "epic_key", "labels",
           "assigned", "assignee_account_id", "description", "jira_updated_at")


def project_row(c, org_id, project_id) -> dict:
    row = c.execute(text("select id, jira_key, jira_synced_at from app.projects where org_id=:org and id=:id"),
                    {"org": org_id, "id": project_id}).mappings().first()
    if row is None:
        raise HTTPException(404, "Project not found.")
    return dict(row)


def sync_project(actor: UUID, org_id: UUID, project_id: UUID) -> dict:
    """Fetches the project's issues from Jira and stores them. The Jira call runs outside any transaction."""
    with deps.program_connection(actor, org_id) as c:
        project = project_row(c, org_id, project_id)
    if not project["jira_key"]:
        raise HTTPException(422, "Add the Jira project key to this project first.")
    try:
        issues = client.fetch_issues(project["jira_key"])
    except client.JiraError as exc:
        raise HTTPException(exc.status, exc.message) from None

    with deps.program_connection(actor, org_id) as c:
        c.execute(text("select 1 from app.projects where id=:id for update"), {"id": project_id})
        before = {row["key"]: dict(row) for row in c.execute(text(
            "select key, summary, status from app.jira_issues where project_id=:id"), {"id": project_id}).mappings()}
        first_sync = project["jira_synced_at"] is None
        events = []
        for issue in issues:
            old = before.get(issue["key"])
            if old is None and not first_sync:
                events.append({"key": issue["key"], "kind": "created", "summary": issue["summary"], "from": None, "to": issue["status"]})
            elif old is not None and old["status"] != issue["status"]:
                events.append({"key": issue["key"], "kind": "status", "summary": issue["summary"], "from": old["status"], "to": issue["status"]})
        current = {issue["key"] for issue in issues}
        events += [{"key": key, "kind": "removed", "summary": old["summary"], "from": old["status"], "to": None}
                   for key, old in before.items() if key not in current]

        for issue in issues:
            c.execute(text(f"""
                insert into app.jira_issues (project_id, org_id, {", ".join(COLUMNS)}, synced_at)
                values (:project, :org, {", ".join(":" + col for col in COLUMNS)}, now())
                on conflict (project_id, key) do update set
                    {", ".join(f"{col}=excluded.{col}" for col in COLUMNS if col != "key")}, synced_at=now()
            """), {"project": project_id, "org": org_id, **{col: issue[col] for col in COLUMNS}})
        if before.keys() - current:
            c.execute(text("delete from app.jira_issues where project_id=:id and not (key = any(:keys))"),
                      {"id": project_id, "keys": list(current)})
        for event in events:
            c.execute(text("""
                insert into app.jira_events (project_id, org_id, key, kind, summary, from_status, to_status)
                values (:project, :org, :key, :kind, :summary, :from, :to)
            """), {"project": project_id, "org": org_id, **event})
        c.execute(text("update app.projects set jira_synced_at=now() where id=:id"), {"id": project_id})
    return {"issues": len(issues), "changes": len(events)}


def ensure_fresh(actor: UUID, org_id: UUID, project_id: UUID | None) -> None:
    """Syncs before AI work when the copy is older than FRESH_FOR. A Jira outage falls back to the stored copy."""
    if project_id is None or not client.configured():
        return
    with deps.program_connection(actor, org_id) as c:
        project = project_row(c, org_id, project_id)
    synced = project["jira_synced_at"]
    if not project["jira_key"] or (synced and datetime.now(timezone.utc) - synced < FRESH_FOR):
        return
    try:
        sync_project(actor, org_id, project_id)
    except HTTPException as exc:
        log.warning("Jira sync before AI work failed (HTTP %s); using the stored issues", exc.status_code)


def refresh_jira(actor: UUID, org_id: UUID, internship_id: UUID) -> None:
    """Before AI work for an internship: bring its project's Jira copy up to date."""
    if not client.configured():
        return
    with deps.program_connection(actor, org_id) as c:
        project_id = c.execute(text("select project_id from app.internships where org_id=:org and id=:id"),
                               {"org": org_id, "id": internship_id}).scalar()
    ensure_fresh(actor, org_id, project_id)


def project_ai_context(c, project_id, open_limit: int = 60) -> dict | None:
    """What the AI knows about a project: the mentor's description, the latest brief, and open Jira work.

    Repository and Jira links, assignees and Jira descriptions beyond a short excerpt stay out.
    """
    if project_id is None:
        return None
    project = c.execute(text("""
        select name, left(description, 1500) as description, tech_stack, left(current_focus, 1000) as current_focus,
            left(intern_areas, 1000) as intern_areas, status, jira_synced_at from app.projects where id=:id
    """), {"id": project_id}).mappings().first()
    if project is None:
        return None
    context = {key: value for key, value in project.items() if key != "jira_synced_at"}
    brief = c.execute(text("select brief from app.project_briefs where project_id=:id order by created_at desc, last_event_id desc nulls last limit 1"),
                      {"id": project_id}).scalar()
    if brief:
        context["current_state"] = brief.get("state")
        context["modules"] = brief.get("modules")
    if project["jira_synced_at"]:
        # Open work, unassigned and intern-friendly first. Epics are modules, not tasks.
        rows = c.execute(text("""
            select i.key, i.issue_type as type, i.status, e.summary as module, i.labels, i.assigned, i.summary,
                left(i.description, 300) as description
            from app.jira_issues i left join app.jira_issues e on e.project_id=i.project_id and e.key=i.epic_key
            where i.project_id=:id and i.status_category <> 'done' and i.issue_type <> 'Epic'
            order by i.assigned, ('good-first-issue' = any(i.labels)) desc, i.status_category, i.key
            limit :limit
        """), {"id": project_id, "limit": open_limit}).mappings()
        context["open_jira_issues"] = [dict(row) for row in rows]
    return context
