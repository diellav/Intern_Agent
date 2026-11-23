"""Task deadlines for the calendar."""
from datetime import date
from uuid import UUID

from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from app.core import deps
from app.core.deps import Actor

router = APIRouter(prefix="/api/organizations/{org_id}")


@router.get("/calendar")
def calendar(org_id: UUID, actor: Actor, start: date, end: date):
    """Task deadlines in a date range, limited by row-level security to internships the actor can see."""
    if end < start or (end - start).days > 92:
        raise HTTPException(422, "Choose a range of up to three months.")
    with deps.program_connection(actor, org_id) as c:
        rows = c.execute(text("""
            select t.id as task_id, t.title, t.status, t.due_on, t.estimated_hours, i.id as internship_id,
                p.name as program, people.intern_name, people.intern_email, people.mentor_name, people.mentor_email
            from app.tasks t
            join app.internships i on i.id = t.internship_id
            join app.programs p on p.id = i.program_id
            left join app.internship_people(:org) people on people.internship_id = i.id
            where i.org_id = :org and i.closed_at is null and t.due_on between :start and :end
            order by t.due_on, (t.status = 'completed'), t.title, t.id
            limit 500
        """), {"org": org_id, "start": start, "end": end}).mappings()
        return [dict(row) for row in rows]
