"""Plan drafts: create, edit, delete, and publish (which turns draft tasks into real tasks)."""
import json
from datetime import date
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from app.core import deps
from app.core.deps import Actor
from app.routes.assignments import assignment, open_assignment
from app.routes.tasks import TaskInput

router = APIRouter(prefix="/api/organizations/{org_id}")


class PlanTask(TaskInput):
    pass


class PlanInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=120)
    goal: str = Field(min_length=1, max_length=3000)
    project: str = Field(default="", max_length=120)
    starts_on: date
    ends_on: date
    carry: list[UUID] = Field(default_factory=list, max_length=30)
    new_tasks: list[PlanTask] = Field(default_factory=list, max_length=30)


class PlanEdit(PlanInput):
    revision: int = Field(ge=1)


class PlanApproval(BaseModel):
    revision: int = Field(ge=1)


def plan_parent(connection, org_id, internship_id, actor):
    parent = open_assignment(connection, org_id, internship_id)
    if parent["mentor_id"] != actor:
        raise HTTPException(403, "Only the assigned mentor can change this plan.")
    return parent


def plan_record(connection, internship_id, plan_id, lock=False):
    suffix = " for update" if lock else ""
    row = connection.execute(text(
        "select * from app.plans where internship_id=:parent and id=:id" + suffix
    ), {"parent": internship_id, "id": plan_id}).mappings().first()
    if row is None:
        raise HTTPException(404, "Plan not found.")
    return dict(row)


def plan_fields(connection, parent, data, lock=False):
    if not parent["starts_on"] <= data.starts_on <= data.ends_on <= parent["ends_on"]:
        raise HTTPException(422, "The plan dates must fall within the internship.")
    if not data.new_tasks and not data.carry:
        raise HTTPException(422, "Add at least one task.")
    if any(not data.starts_on <= task.due_on <= data.ends_on for task in data.new_tasks):
        raise HTTPException(422, "New task deadlines must fall within the plan.")
    if len(set(data.carry)) != len(data.carry):
        raise HTTPException(422, "Each carried task may appear once.")
    carried = []
    for task_id in sorted(data.carry):
        row = connection.execute(text("""
            select id,title,status,due_on from app.tasks where internship_id=:parent and id=:id
        """ + (" for update" if lock else "")), {"parent":parent["id"],"id":task_id}).mappings().first()
        if row is None or row["status"] == "completed":
            raise HTTPException(409, "A carried task is no longer open in this internship.")
        carried.append({"id":str(row["id"]),"title":row["title"],"status":row["status"],"due_on":row["due_on"].isoformat()})
    fields = data.model_dump(exclude={"carry","new_tasks","revision"})
    fields["draft"] = json.dumps({"carry":carried,"new_tasks":[task.model_dump(mode="json") for task in data.new_tasks]})
    return fields


@router.get("/internships/{internship_id}/plans")
def plans(org_id: UUID, internship_id: UUID, actor: Actor):
    with deps.program_connection(actor, org_id) as connection:
        assignment(connection, org_id, internship_id)
        rows = connection.execute(text("""
            select * from app.plans where internship_id=:id order by starts_on desc,id
        """), {"id":internship_id}).mappings()
        return [dict(row) for row in rows]


@router.post("/internships/{internship_id}/plans", status_code=201)
def create_plan(org_id: UUID, internship_id: UUID, actor: Actor, data: PlanInput):
    with deps.program_connection(actor, org_id) as connection:
        parent = plan_parent(connection, org_id, internship_id, actor)
        fields = plan_fields(connection, parent, data)
        row = connection.execute(text("""
            insert into app.plans(internship_id,title,goal,project,starts_on,ends_on,draft)
            values (:parent,:title,:goal,:project,:starts_on,:ends_on,cast(:draft as jsonb)) returning *
        """), {"parent":internship_id,**fields}).mappings().one()
        return dict(row)


@router.put("/internships/{internship_id}/plans/{plan_id}")
def edit_plan(org_id: UUID, internship_id: UUID, plan_id: UUID, actor: Actor, data: PlanEdit):
    with deps.program_connection(actor, org_id) as connection:
        parent = plan_parent(connection, org_id, internship_id, actor)
        record = plan_record(connection, internship_id, plan_id, lock=True)
        if record["published_at"] or record["revision"] != data.revision:
            raise HTTPException(409, "This plan changed. Reload it before editing.")
        fields = plan_fields(connection, parent, data)
        row = connection.execute(text("""
            update app.plans set title=:title,goal=:goal,project=:project,starts_on=:starts_on,
                ends_on=:ends_on,draft=cast(:draft as jsonb),revision=revision+1
            where id=:id returning *
        """), {"id":plan_id,**fields}).mappings().one()
        return dict(row)


@router.post("/internships/{internship_id}/plans/{plan_id}/publish")
def publish_plan(org_id: UUID, internship_id: UUID, plan_id: UUID, actor: Actor, data: PlanApproval):
    with deps.program_connection(actor, org_id) as connection:
        parent = plan_parent(connection, org_id, internship_id, actor)
        record = plan_record(connection, internship_id, plan_id)
        if not record["published_at"]:
            try:
                record = plan_record(connection, internship_id, plan_id, lock=True)
            except HTTPException as exc:
                if exc.status_code != 404:
                    raise
                # A concurrent publisher may have moved the row outside the update policy.
                record = plan_record(connection, internship_id, plan_id)
                if not record["published_at"]:
                    raise exc
        if record["revision"] != data.revision:
            raise HTTPException(409, "This draft changed. Reload it before publishing.")
        if record["published_at"]:
            return record
        draft = record["draft"]
        inputs = PlanInput.model_validate({
            **record, "carry":[item["id"] for item in draft["carry"]], "new_tasks":draft["new_tasks"],
        })
        fields = plan_fields(connection, parent, inputs, lock=True)
        if json.loads(fields["draft"])["carry"] != draft["carry"]:
            raise HTTPException(409, "A carried task changed. Review and save the draft again.")
        task_ids = list(inputs.carry)
        for task in inputs.new_tasks:
            task_ids.append(connection.execute(text("""
                insert into app.tasks(internship_id,title,criteria,due_on,estimated_hours,jira_key)
                values (:parent,:title,:criteria,:due_on,:estimated_hours,:jira_key) returning id
            """), {"parent":internship_id,**task.model_dump()}).scalar_one())
        row = connection.execute(text("""
            update app.plans set published_at=now(),task_ids=:tasks where id=:id returning *
        """), {"id":plan_id,"tasks":task_ids}).mappings().one()
        return dict(row)


@router.delete("/internships/{internship_id}/plans/{plan_id}")
def delete_plan(org_id: UUID, internship_id: UUID, plan_id: UUID, actor: Actor):
    """Deletes an unpublished draft. Published plans stay: their tasks were assigned and the intern notified."""
    with deps.program_connection(actor, org_id) as connection:
        plan_parent(connection, org_id, internship_id, actor)
        record = plan_record(connection, internship_id, plan_id)
        if record["published_at"]:
            raise HTTPException(409, "Published plans can’t be deleted because their tasks are already assigned.")
        deleted = connection.execute(text("delete from app.plans where id=:id and published_at is null returning id"),
                                     {"id": plan_id}).scalar()
        if deleted is None:
            raise HTTPException(409, "This plan was just published. Reload the page.")
        return {"id": deleted}
