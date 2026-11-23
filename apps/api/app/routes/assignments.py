"""Mentor-intern assignments (internships) and their activity history."""
from datetime import date
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from app.core import deps
from app.core.deps import Actor

router = APIRouter(prefix="/api/organizations/{org_id}")


class AssignmentInput(BaseModel):
    program_id: UUID
    mentor_id: UUID
    intern_id: UUID
    starts_on: date
    ends_on: date



@router.get("/assignment-members")
def members(org_id: UUID, actor: Actor):
    with deps.program_connection(actor, org_id, admin=True) as c:
        return [dict(row) for row in c.execute(text("select * from app.assignment_members(:org)"), {"org": org_id}).mappings()]


@router.get("/internships")
def internships(org_id: UUID, actor: Actor, program_id: UUID | None = None):
    # Row-level security limits the rows to internships the actor may see.
    with deps.program_connection(actor, org_id) as c:
        rows = c.execute(text("""
            select i.id, i.program_id, i.mentor_id, i.intern_id, i.starts_on, i.ends_on, i.closed_at,
                p.name as program_name, people.mentor_email, people.intern_email, people.mentor_name, people.intern_name,
                count(t.id) as task_count,
                count(t.id) filter (where t.status = 'completed') as completed_count,
                count(t.id) filter (where t.status = 'submitted') as submitted_count,
                count(t.id) filter (where t.status = 'changes_requested') as changes_count,
                count(t.id) filter (where t.status = 'planned') as planned_count
            from app.internships i
            join app.programs p on p.id = i.program_id
            left join app.internship_people(:org) people on people.internship_id = i.id
            left join app.tasks t on t.internship_id = i.id
            where i.org_id = :org and (cast(:program as uuid) is null or i.program_id = :program)
            group by i.id, p.name, people.mentor_email, people.intern_email, people.mentor_name, people.intern_name
            order by i.starts_on desc, i.id
        """), {"org": org_id, "program": program_id}).mappings()
        return [dict(row) for row in rows]


@router.post("/internships", status_code=201)
def assign(org_id: UUID, actor: Actor, data: AssignmentInput):
    with deps.program_connection(actor, org_id, admin=True) as c:
        people = {r.id: r.role for r in c.execute(text("select * from app.assignment_members(:org)"), {"org": org_id})}
        if people.get(data.mentor_id) != "mentor" or people.get(data.intern_id) != "intern":
            raise HTTPException(422, "Choose an active mentor and intern in this organization.")
        if data.starts_on > data.ends_on:
            raise HTTPException(422, "End date must follow the start date.")
        program = c.execute(text("select id from app.programs where org_id=:org and id=:program"), {"org": org_id, "program": data.program_id}).scalar()
        if program is None:
            raise HTTPException(404, "Program not found.")
        result = c.execute(text("""
            insert into app.internships (org_id, program_id, mentor_id, intern_id, starts_on, ends_on)
            values (:org, :program_id, :mentor_id, :intern_id, :starts_on, :ends_on)
            on conflict (program_id, intern_id, starts_on) do nothing returning id
        """), {"org": org_id, **data.model_dump()}).scalar()
        if result is None:
            raise HTTPException(409, "This internship assignment already exists.")
        return {"id": result}


def assignment(c, org_id, internship_id):
    row = c.execute(text("select * from app.internships where org_id=:org and id=:id"), {"org": org_id, "id": internship_id}).mappings().first()
    if row is None:
        raise HTTPException(404, "Internship not found.")
    return row


def open_assignment(c, org_id, internship_id):
    """The internship, refusing changes once it is closed."""
    row = assignment(c, org_id, internship_id)
    if row["closed_at"] is not None:
        raise HTTPException(409, "This internship is closed. Reopen it to make changes.")
    return row


class ClosedInput(BaseModel):
    closed: bool


@router.put("/internships/{internship_id}/closed")
def set_closed(org_id: UUID, internship_id: UUID, actor: Actor, data: ClosedInput):
    """Closing ends the internship: no new tasks, submissions or plans, and it leaves the active lists."""
    with deps.program_connection(actor, org_id) as c:
        parent = assignment(c, org_id, internship_id)
        role = c.execute(text("select role from app.memberships where org_id=:org and user_id=:actor and active"),
                         {"org": org_id, "actor": actor}).scalar()
        if role != "admin" and parent["mentor_id"] != actor:
            raise HTTPException(403, "Only an admin or the assigned mentor can close this internship.")
        value = c.execute(text("select app.set_internship_closed(:id, :closed)"),
                          {"id": internship_id, "closed": data.closed}).scalar()
        return {"id": internship_id, "closed_at": value}



@router.get("/internships/{internship_id}/activity")
def internship_activity(org_id: UUID, internship_id: UUID, actor: Actor):
    with deps.program_connection(actor, org_id) as c:
        assignment(c, org_id, internship_id)
        rows = c.execute(text("""
            select kind, title, occurred_at, task_id, version
            from (
                select 'submission' as kind, t.title, s.submitted_at as occurred_at,
                    t.id as task_id, s.version
                from app.submissions s join app.tasks t on t.id=s.task_id
                where t.internship_id=:id
                union all
                select 'review', t.title, s.reviewed_at, t.id, s.version
                from app.submissions s join app.tasks t on t.id=s.task_id
                where t.internship_id=:id and s.reviewed_at is not null
                union all
                select 'plan', title, published_at, null, null
                from app.plans where internship_id=:id and published_at is not null
            ) activity
            order by occurred_at desc, kind, task_id, version limit 50
        """), {"id": internship_id}).mappings()
        return [dict(row) for row in rows]
