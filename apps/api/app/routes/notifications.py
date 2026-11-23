"""In-app notifications."""
from uuid import UUID

from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from app.core import deps
from app.core.deps import Actor

router = APIRouter(prefix="/api/organizations/{org_id}")


@router.get("/notifications")
def notifications(org_id: UUID, actor: Actor, unread: bool = False):
    with deps.program_connection(actor, org_id) as c:
        rows = c.execute(text("""
            select n.id, n.event, n.internship_id, n.task_id, n.plan_id, n.created_at, n.read_at,
                coalesce(t.title, p.title) as title,
                -- Submit and review notices point at a submission; show which version they are about.
                (select s.version from app.submissions s where s.id = n.source_id) as version
            from app.notifications n
            left join app.tasks t on t.id=n.task_id
            left join app.plans p on p.id=n.plan_id
            -- Only notices whose task or plan the actor can still open under row-level security.
            where n.org_id=:org and (t.id is not null or p.id is not null) and (not :unread or n.read_at is null)
            order by n.created_at desc,n.id desc limit 50
        """), {"org":org_id, "unread": unread}).mappings()
        return [dict(row) for row in rows]


@router.get("/notifications/unread-count")
def unread_notifications(org_id: UUID, actor: Actor):
    with deps.program_connection(actor, org_id) as c:
        # Join tasks like the inbox does, so notices for tasks the actor can no longer open are not counted.
        return {"unread": c.execute(text("""
            select count(*) from app.notifications n
            left join app.tasks t on t.id=n.task_id left join app.plans p on p.id=n.plan_id
            where n.org_id=:org and n.read_at is null and (t.id is not null or p.id is not null)
        """), {"org": org_id}).scalar_one()}


@router.post("/notifications/{notification_id}/read")
def read_notification(org_id: UUID, notification_id: UUID, actor: Actor):
    with deps.program_connection(actor, org_id) as c:
        value = c.execute(text("""
            update app.notifications set read_at=coalesce(read_at, now())
            where org_id=:org and id=:id returning read_at
        """), {"org":org_id,"id":notification_id}).scalar()
        if value is None:
            raise HTTPException(404, "Notification not found.")
        return {"read_at":value}
