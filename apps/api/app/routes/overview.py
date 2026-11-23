"""The role-aware overview: open work ordered by who must act next."""
from uuid import UUID

from fastapi import APIRouter
from sqlalchemy import text

from app.core import deps
from app.core.deps import Actor

router = APIRouter(prefix="/api/organizations/{org_id}")


OVERVIEW_LIMIT = 100


@router.get("/overview")
def overview(org_id: UUID, actor: Actor):
    # Closed internships drop out. Scope comes from row-level security: admins see the organization, mentors and interns
    # only the internships they are assigned to.
    with deps.program_connection(actor, org_id) as connection:
        role = connection.execute(text("""
            select role from app.memberships where org_id=:org and user_id=:actor and active
        """), {"org": org_id, "actor": actor}).scalar_one()
        # Interns act on change requests and deadlines first. Mentors and admins clear the review queue first.
        priority = ("case t.status when 'changes_requested' then 0 when 'planned' then 1 else 2 end"
                    if role == "intern" else
                    "case t.status when 'submitted' then 0 when 'changes_requested' then 1 else 2 end")
        rows = connection.execute(text(f"""
            with open_tasks as (
                select t.*, i.org_id, i.program_id from app.tasks t
                join app.internships i on i.id=t.internship_id
                where i.org_id=:org and i.closed_at is null and t.status in ('planned','changes_requested','submitted')
            )
            select t.internship_id, t.id as task_id, p.name as program,
                   (select pl.project from app.plans pl
                    where pl.internship_id=t.internship_id and pl.published_at is not null
                    and t.id = any(pl.task_ids) and pl.project <> ''
                    order by pl.published_at desc limit 1) as project,
                   people.intern_email, people.mentor_email, people.intern_name, people.mentor_name,
                   t.title, t.status, t.due_on,
                   case when t.status='submitted' then 'mentor' else 'intern' end as waiting_on,
                   case when t.status = 'submitted' then (
                       select s.submitted_at from app.submissions s
                       where s.task_id=t.id order by s.version desc limit 1
                   ) end as submitted_at
            from open_tasks t
            join app.programs p on p.id=t.program_id
            left join app.internship_people(:org) people on people.internship_id=t.internship_id
            order by {priority}, submitted_at asc nulls last, t.due_on, t.id
            limit {OVERVIEW_LIMIT}
        """), {"org": org_id}).mappings()
        items = [dict(row) for row in rows]
        counts = connection.execute(text("""
            select count(*) as open,
                count(*) filter (where t.status='submitted') as submitted,
                count(*) filter (where t.status='changes_requested') as changes_requested,
                count(*) filter (where t.status='planned') as planned,
                count(*) filter (where t.status<>'submitted' and t.due_on < current_date) as overdue
            from app.tasks t join app.internships i on i.id=t.internship_id
            where i.org_id=:org and i.closed_at is null and t.status in ('planned','changes_requested','submitted')
        """), {"org": org_id}).mappings().one()
        return {"role": role, "items": items, "counts": dict(counts), "limit": OVERVIEW_LIMIT}
