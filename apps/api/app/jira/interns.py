"""The Jira assistant for one intern: their Jira work, where they can start, and assigning it in Jira.

Jira stays the source of truth. InternAgent reads the board, suggests intern-friendly issues and, when the
mentor approves, assigns them in Jira. It keeps no separate task list for this work.
"""
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from app.core import deps
from app.core.deps import Actor
from app.jira import client
from app.jira.sync import refresh_jira
from app.routes.assignments import assignment

router = APIRouter(prefix="/api/organizations/{org_id}")


class AccountInput(BaseModel):
    email: str | None = Field(default=None, max_length=254, pattern=r"^[^@\s]+@[^@\s]+$")  # the intern's Jira email; empty unlinks


class AssignInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    issue_key: str = Field(pattern=r"^[A-Z][A-Z0-9_]{1,9}-[0-9]+$")


def manager(c, org_id, internship_id, actor) -> dict:
    """The internship, for an admin or its assigned mentor."""
    parent = assignment(c, org_id, internship_id)
    role = c.execute(text("select role from app.memberships where org_id=:org and user_id=:actor and active"),
                     {"org": org_id, "actor": actor}).scalar()
    if role != "admin" and parent["mentor_id"] != actor:
        raise HTTPException(403, "Only an admin or the assigned mentor can manage this intern's Jira work.")
    return dict(parent)


def work(c, org_id, internship_id, actor) -> dict:
    parent = manager(c, org_id, internship_id, actor)
    project = c.execute(text("select id, name, jira_key, jira_synced_at from app.projects where id=:id"),
                        {"id": parent["project_id"]}).mappings().first() if parent["project_id"] else None
    result = {"configured": client.configured(), "browse_url": client.browse_url(), "linked": bool(parent["jira_account_id"]),
              "project": dict(project) if project else None, "issues": [], "suggestions": [],
              "counts": {"done": 0, "in_progress": 0, "to_do": 0}}
    if not project or not project["jira_key"]:
        return result
    epic = "(select e.summary from app.jira_issues e where e.project_id=i.project_id and e.key=i.epic_key) as module"
    if parent["jira_account_id"]:
        result["issues"] = [dict(row) for row in c.execute(text(f"""
            select i.key, i.summary, i.issue_type as type, i.status, i.status_category, i.jira_updated_at, {epic}
            from app.jira_issues i where i.project_id=:project and i.assignee_account_id=:account and i.issue_type <> 'Epic'
            order by (i.status_category='done'), i.status_category desc, i.key
        """), {"project": project["id"], "account": parent["jira_account_id"]}).mappings()]
        for issue in result["issues"]:
            bucket = {"done": "done", "indeterminate": "in_progress"}.get(issue["status_category"], "to_do")
            result["counts"][bucket] += 1
    # Suggestions: the brief's intern-friendly issues, then the CV analysis' proposals, while still open and unassigned.
    reasons: dict[str, tuple[str, str]] = {}
    brief = c.execute(text("""
        select brief from app.project_briefs where project_id=:id
        order by created_at desc, last_event_id desc nulls last limit 1
    """), {"id": project["id"]}).scalar()
    for item in (brief or {}).get("intern_opportunities", []):
        reasons.setdefault(item["issue_key"], (item["why"], "Project analysis"))
    analysis = c.execute(text("select analysis from app.intern_cvs where internship_id=:id"), {"id": internship_id}).scalar() \
        if parent["mentor_id"] == actor else None  # the CV analysis is the assigned mentor's only
    for task in (analysis or {}).get("starter_tasks", []):
        if task.get("jira_key"):
            reasons[task["jira_key"]] = (task.get("why") or task["title"], "Fits the intern's CV")
    if reasons:
        rows = c.execute(text(f"""
            select i.key, i.summary, i.issue_type as type, i.status, {epic} from app.jira_issues i
            where i.project_id=:project and i.key = any(:keys) and i.status_category <> 'done' and not i.assigned
        """), {"project": project["id"], "keys": list(reasons)}).mappings()
        found = {row["key"]: dict(row) for row in rows}
        result["suggestions"] = [{**found[key], "why": why, "source": source}
                                 for key, (why, source) in reasons.items() if key in found]
    return result


@router.get("/internships/{internship_id}/jira-work")
def jira_work(org_id: UUID, internship_id: UUID, actor: Actor):
    with deps.program_connection(actor, org_id) as c:
        manager(c, org_id, internship_id, actor)
    refresh_jira(actor, org_id, internship_id)  # keeps the copy within 15 minutes of the board
    with deps.program_connection(actor, org_id) as c:
        return work(c, org_id, internship_id, actor)


@router.put("/internships/{internship_id}/jira-account")
def link_account(org_id: UUID, internship_id: UUID, actor: Actor, data: AccountInput):
    with deps.program_connection(actor, org_id) as c:
        manager(c, org_id, internship_id, actor)
    account = None
    if data.email:
        try:
            account = client.find_account(str(data.email))
        except client.JiraError as exc:
            raise HTTPException(exc.status, exc.message) from None
    with deps.program_connection(actor, org_id) as c:
        c.execute(text("select app.set_internship_jira_account(:id, :account)"), {"id": internship_id, "account": account})
        return work(c, org_id, internship_id, actor)


@router.post("/internships/{internship_id}/jira-work/assign")
def assign_issue(org_id: UUID, internship_id: UUID, actor: Actor, data: AssignInput):
    """The mentor's approval: assigns an open, unassigned project issue to the intern in Jira."""
    with deps.program_connection(actor, org_id) as c:
        parent = manager(c, org_id, internship_id, actor)
        if parent["closed_at"] is not None:
            raise HTTPException(409, "This internship is closed.")
        if not parent["jira_account_id"]:
            raise HTTPException(422, "Link the intern's Jira account first.")
        issue = c.execute(text("""
            select key, status_category, assigned, assignee_account_id, issue_type from app.jira_issues
            where project_id=:project and key=:key
        """), {"project": parent["project_id"], "key": data.issue_key}).mappings().first()
        if issue is None or issue["issue_type"] == "Epic":
            raise HTTPException(404, "This issue is not part of the intern's project board.")
        if issue["status_category"] == "done":
            raise HTTPException(409, "This issue is already done.")
        if issue["assigned"] and issue["assignee_account_id"] != parent["jira_account_id"]:
            raise HTTPException(409, "Someone else is assigned to this issue in Jira.")
    try:
        client.assign(data.issue_key, parent["jira_account_id"])
    except client.JiraError as exc:
        raise HTTPException(exc.status, exc.message) from None
    with deps.program_connection(actor, org_id) as c:
        c.execute(text("""
            update app.jira_issues set assigned=true, assignee_account_id=:account
            where project_id=:project and key=:key
        """), {"account": parent["jira_account_id"], "project": parent["project_id"], "key": data.issue_key})
        return work(c, org_id, internship_id, actor)


@router.get("/jira-overview")
def jira_overview(org_id: UUID, actor: Actor):
    """Each open internship with its project and the intern's Jira work by status. Row-level security scopes it."""
    with deps.program_connection(actor, org_id) as c:
        rows = c.execute(text("""
            select i.id as internship_id, people.intern_name, people.intern_email, people.mentor_name, people.mentor_email,
                pr.name as project, pr.jira_key, pr.jira_synced_at, i.jira_account_id is not null as linked,
                count(j.key) filter (where j.status_category='done') as done,
                count(j.key) filter (where j.status_category='indeterminate') as in_progress,
                count(j.key) filter (where j.status_category='new') as to_do,
                max(j.jira_updated_at) as last_update
            from app.internships i
            left join app.projects pr on pr.id=i.project_id
            left join app.internship_people(:org) people on people.internship_id=i.id
            left join app.jira_issues j on j.project_id=i.project_id and j.assignee_account_id=i.jira_account_id
                and j.issue_type <> 'Epic'
            where i.org_id=:org and i.closed_at is null
            group by i.id, people.intern_name, people.intern_email, people.mentor_name, people.mentor_email,
                pr.name, pr.jira_key, pr.jira_synced_at
            order by people.intern_name nulls last, people.intern_email
        """), {"org": org_id}).mappings()
        return [dict(row) for row in rows]
