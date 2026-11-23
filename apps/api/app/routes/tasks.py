"""Tasks, versioned submissions and mentor reviews."""
from datetime import date
from typing import Literal
from urllib.parse import urlparse
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import text

from app.core import deps
from app.core.deps import Actor
from app.routes.assignments import assignment, open_assignment

router = APIRouter(prefix="/api/organizations/{org_id}")


class TaskInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=120)
    criteria: str = Field(min_length=1, max_length=3000)
    due_on: date
    estimated_hours: float | None = Field(default=None, gt=0, le=1000)


class LinkInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    url: str = Field(min_length=8, max_length=2000)
    title: str = Field(default="", max_length=120)

    @field_validator("url")
    @classmethod
    def http_only(cls, value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme.lower() not in ("http", "https") or not parsed.netloc or any(ch.isspace() for ch in value):
            raise ValueError("Links must start with http:// or https://")
        return value


class SubmissionInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    evidence: str = Field(default="", max_length=6000)  # the written description
    links: list[LinkInput] = Field(default_factory=list, max_length=10)
    file_ids: list[UUID] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def has_content(self):
        if not self.evidence and not self.links and not self.file_ids:
            raise ValueError("Add a description, a link or a file.")
        if len(set(self.file_ids)) != len(self.file_ids):
            raise ValueError("Each file may be attached once.")
        return self


class ReviewInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    submission_id: UUID
    decision: Literal["changes_requested", "completed"]
    feedback: str = Field(min_length=1, max_length=3000)



@router.get("/internships/{internship_id}/tasks")
def tasks(org_id: UUID, internship_id: UUID, actor: Actor):
    with deps.program_connection(actor, org_id) as c:
        assignment(c, org_id, internship_id)
        rows = c.execute(text("""
            select id,title,criteria,due_on,status,estimated_hours from app.tasks where internship_id=:id order by due_on,id
        """), {"id": internship_id}).mappings()
        return [dict(row) for row in rows]


@router.post("/internships/{internship_id}/tasks", status_code=201)
def create_task(org_id: UUID, internship_id: UUID, actor: Actor, data: TaskInput):
    with deps.program_connection(actor, org_id) as c:
        parent = open_assignment(c, org_id, internship_id)
        if parent["mentor_id"] != actor:
            raise HTTPException(403, "Only the assigned mentor can create tasks.")
        if not parent["starts_on"] <= data.due_on <= parent["ends_on"]:
            raise HTTPException(422, "The deadline must fall within the internship.")
        task_id = c.execute(text("""
            insert into app.tasks (internship_id,title,criteria,due_on,estimated_hours)
            values (:id,:title,:criteria,:due_on,:estimated_hours) returning id
        """), {"id": internship_id, **data.model_dump()}).scalar_one()
        # A single task joins the published plan that covers its deadline, so every task has a plan when one exists.
        plan = c.execute(text("select * from app.attach_task_to_plan(:id)"), {"id": task_id}).mappings().first()
        return {"id": task_id, "plan": {"id": plan["plan_id"], "title": plan["plan_title"]} if plan else None}


def task_scope(c, org_id, task_id, lock=False):
    suffix = " for update of t" if lock else ""
    row = c.execute(text("""
        select t.id, t.status, i.mentor_id, i.intern_id, i.closed_at
        from app.tasks t join app.internships i on i.id=t.internship_id
        where t.id=:id and i.org_id=:org
    """ + suffix), {"id": task_id, "org": org_id}).mappings().first()
    if row is None:
        raise HTTPException(404, "Task not found.")
    return row


@router.get("/tasks/{task_id}/submissions")
def submissions(org_id: UUID, task_id: UUID, actor: Actor):
    with deps.program_connection(actor, org_id) as c:
        task_scope(c, org_id, task_id)
        rows = [dict(row) for row in c.execute(text("""
            select id,version,evidence,submitted_at,decision,feedback,reviewed_at
            from app.submissions where task_id=:id order by version desc
        """), {"id": task_id}).mappings()]
        files = c.execute(text("""
            select id, submission_id, file_name, size_bytes, content_type from app.submission_files
            where task_id=:id and submission_id is not null order by created_at, id
        """), {"id": task_id}).mappings().all()
        links = c.execute(text("""
            select l.submission_id, l.url, l.title from app.submission_links l
            join app.submissions s on s.id=l.submission_id where s.task_id=:id order by l.position
        """), {"id": task_id}).mappings().all()
        for row in rows:
            row["files"] = [dict(f) for f in files if f["submission_id"] == row["id"]]
            row["links"] = [{"url": l["url"], "title": l["title"]} for l in links if l["submission_id"] == row["id"]]
        return rows


@router.post("/tasks/{task_id}/submissions", status_code=201)
def submit(org_id: UUID, task_id: UUID, actor: Actor, data: SubmissionInput):
    with deps.program_connection(actor, org_id) as c:
        task = task_scope(c, org_id, task_id)
        if task["intern_id"] != actor:
            raise HTTPException(403, "Only the assigned intern can submit work.")
        if task["closed_at"] is not None:
            raise HTTPException(409, "This internship is closed, so it no longer accepts submissions.")
        task = task_scope(c, org_id, task_id, lock=True)
        if task["status"] not in ("planned", "changes_requested"):
            raise HTTPException(409, "This task is not accepting a submission.")
        submission_id = c.execute(text("""
            insert into app.submissions (task_id, version, evidence)
            select :id, coalesce(max(version),0)+1, :evidence
            from app.submissions where task_id=:id returning id
        """), {"id": task_id, "evidence": data.evidence}).scalar_one()
        if data.file_ids:
            attached = c.execute(text("""
                update app.submission_files set submission_id=:submission
                where id = any(:ids) and task_id=:task and uploaded_by=:actor and submission_id is null
            """), {"submission": submission_id, "ids": data.file_ids, "task": task_id, "actor": actor}).rowcount
            if attached != len(data.file_ids):
                raise HTTPException(409, "A file is missing or already attached. Remove it and upload it again.")
        for position, link in enumerate(data.links):
            c.execute(text("""
                insert into app.submission_links (submission_id, position, url, title) values (:s, :p, :url, :title)
            """), {"s": submission_id, "p": position, **link.model_dump()})
        c.execute(text("update app.tasks set status='submitted' where id=:id"), {"id": task_id})
        return {"id": submission_id}


@router.post("/tasks/{task_id}/review")
def review(org_id: UUID, task_id: UUID, actor: Actor, data: ReviewInput):
    with deps.program_connection(actor, org_id) as c:
        task = task_scope(c, org_id, task_id)
        if task["mentor_id"] != actor:
            raise HTTPException(403, "Only the assigned mentor can review work.")
        task = task_scope(c, org_id, task_id, lock=True)
        latest = c.execute(text("""
            select id,decision from app.submissions where task_id=:id order by version desc limit 1
        """), {"id": task_id}).first()
        if task["status"] != "submitted" or latest is None or latest.id != data.submission_id or latest.decision is not None:
            raise HTTPException(409, "The submission has changed. Refresh the task before reviewing.")
        result = c.execute(text("""
            update app.submissions set decision=:decision, feedback=:feedback, reviewed_at=now()
            where id=:submission_id and decision is null
        """), data.model_dump())
        if result.rowcount != 1:
            raise HTTPException(409, "The submission is no longer awaiting review.")
        c.execute(text("update app.tasks set status=:decision where id=:id"), {"id": task_id, "decision": data.decision})
        return {"id": data.submission_id, "status": data.decision}
