import json
from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.main import actor_id, program_connection

router = APIRouter(prefix="/api/organizations/{org_id}")
Actor = Annotated[UUID, Depends(actor_id)]


class AssignmentInput(BaseModel):
    program_id: UUID
    mentor_id: UUID
    intern_id: UUID
    starts_on: date
    ends_on: date


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


@router.get("/assignment-members")
def members(org_id: UUID, actor: Actor):
    with program_connection(actor, org_id, admin=True) as c:
        return [dict(row) for row in c.execute(text("select * from app.assignment_members(:org)"), {"org": org_id}).mappings()]


@router.get("/internships")
def internships(org_id: UUID, actor: Actor, program_id: UUID | None = None):
    # Row-level security limits the rows to internships the actor may see.
    with program_connection(actor, org_id) as c:
        rows = c.execute(text("""
            select i.id, i.program_id, i.mentor_id, i.intern_id, i.starts_on, i.ends_on,
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
    with program_connection(actor, org_id, admin=True) as c:
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


@router.get("/internships/{internship_id}/tasks")
def tasks(org_id: UUID, internship_id: UUID, actor: Actor):
    with program_connection(actor, org_id) as c:
        assignment(c, org_id, internship_id)
        rows = c.execute(text("""
            select id,title,criteria,due_on,status,estimated_hours from app.tasks where internship_id=:id order by due_on,id
        """), {"id": internship_id}).mappings()
        return [dict(row) for row in rows]


@router.post("/internships/{internship_id}/tasks", status_code=201)
def create_task(org_id: UUID, internship_id: UUID, actor: Actor, data: TaskInput):
    with program_connection(actor, org_id) as c:
        parent = assignment(c, org_id, internship_id)
        if parent["mentor_id"] != actor:
            raise HTTPException(403, "Only the assigned mentor can create tasks.")
        if not parent["starts_on"] <= data.due_on <= parent["ends_on"]:
            raise HTTPException(422, "The deadline must fall within the internship.")
        task_id = c.execute(text("""
            insert into app.tasks (internship_id,title,criteria,due_on,estimated_hours)
            values (:id,:title,:criteria,:due_on,:estimated_hours) returning id
        """), {"id": internship_id, **data.model_dump()}).scalar_one()
        return {"id": task_id}


def task_scope(c, org_id, task_id, lock=False):
    suffix = " for update of t" if lock else ""
    row = c.execute(text("""
        select t.id, t.status, i.mentor_id, i.intern_id
        from app.tasks t join app.internships i on i.id=t.internship_id
        where t.id=:id and i.org_id=:org
    """ + suffix), {"id": task_id, "org": org_id}).mappings().first()
    if row is None:
        raise HTTPException(404, "Task not found.")
    return row


@router.get("/tasks/{task_id}/submissions")
def submissions(org_id: UUID, task_id: UUID, actor: Actor):
    with program_connection(actor, org_id) as c:
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
    with program_connection(actor, org_id) as c:
        task = task_scope(c, org_id, task_id)
        if task["intern_id"] != actor:
            raise HTTPException(403, "Only the assigned intern can submit work.")
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
    with program_connection(actor, org_id) as c:
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


@router.get("/notifications")
def notifications(org_id: UUID, actor: Actor, unread: bool = False):
    with program_connection(actor, org_id) as c:
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
    with program_connection(actor, org_id) as c:
        # Join tasks like the inbox does, so notices for tasks the actor can no longer open are not counted.
        return {"unread": c.execute(text("""
            select count(*) from app.notifications n
            left join app.tasks t on t.id=n.task_id left join app.plans p on p.id=n.plan_id
            where n.org_id=:org and n.read_at is null and (t.id is not null or p.id is not null)
        """), {"org": org_id}).scalar_one()}


@router.post("/notifications/{notification_id}/read")
def read_notification(org_id: UUID, notification_id: UUID, actor: Actor):
    with program_connection(actor, org_id) as c:
        value = c.execute(text("""
            update app.notifications set read_at=coalesce(read_at, now())
            where org_id=:org and id=:id returning read_at
        """), {"org":org_id,"id":notification_id}).scalar()
        if value is None:
            raise HTTPException(404, "Notification not found.")
        return {"read_at":value}

class QuestionInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=180)
    body: str = Field(min_length=1, max_length=6000)


class AnswerInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    body: str = Field(min_length=1, max_length=6000)


@router.get("/questions")
def questions(org_id: UUID, actor: Actor, q: Annotated[str, Query(max_length=200)] = ""):
    with program_connection(actor, org_id) as c:
        rows = c.execute(text("""
            select q.id,q.title,q.body,q.created_at,
                (select count(*) from app.answers a where a.question_id=q.id) as answers,
                exists(select 1 from app.answers a where a.question_id=q.id and a.verified_at is not null) as verified,
                -- Questions asked from a task keep their context; RLS already hides tasks the viewer can't see.
                q.task_id, t.title as task_title, t.internship_id
            from app.questions q left join app.tasks t on t.id=q.task_id where q.org_id=:org
            and (:search='' or to_tsvector('simple',q.title || ' ' || q.body) @@ websearch_to_tsquery('simple',:search))
            order by q.created_at desc,q.id desc limit 30
        """), {"org":org_id,"search":q.strip()}).mappings()
        return [dict(row) for row in rows]


@router.post("/questions", status_code=201)
def ask(org_id: UUID, actor: Actor, data: QuestionInput):
    with program_connection(actor, org_id) as c:
        identifier = c.execute(text("""
            insert into app.questions(org_id,author_id,title,body) values (:org,:actor,:title,:body) returning id
        """), {"org":org_id,"actor":actor,**data.model_dump()}).scalar_one()
        return {"id":identifier}


def check_question(c, org_id, question_id):
    if not c.execute(text("select id from app.questions where org_id=:org and id=:id"), {"org":org_id,"id":question_id}).scalar():
        raise HTTPException(404, "Question not found.")


@router.get("/questions/{question_id}/answers")
def answers(org_id: UUID, question_id: UUID, actor: Actor):
    with program_connection(actor, org_id) as c:
        check_question(c, org_id, question_id)
        rows = c.execute(text("""
            select id,body,created_at,verified_at from app.answers where org_id=:org and question_id=:id
            order by (verified_at is null),created_at,id limit 50
        """), {"org":org_id,"id":question_id}).mappings()
        return [dict(row) for row in rows]


@router.post("/questions/{question_id}/answers", status_code=201)
def answer(org_id: UUID, question_id: UUID, actor: Actor, data: AnswerInput):
    with program_connection(actor, org_id) as c:
        check_question(c, org_id, question_id)
        identifier = c.execute(text("""
            insert into app.answers(org_id,question_id,author_id,body) values (:org,:question,:actor,:body) returning id
        """), {"org":org_id,"question":question_id,"actor":actor,"body":data.body}).scalar_one()
        return {"id":identifier}


@router.post("/questions/{question_id}/answers/{answer_id}/verify")
def verify_answer(org_id: UUID, question_id: UUID, answer_id: UUID, actor: Actor):
    with program_connection(actor, org_id) as c:
        check_question(c, org_id, question_id)
        role = c.execute(text("select role from app.memberships where org_id=:org and user_id=:actor and active"), {"org":org_id,"actor":actor}).scalar()
        if role not in ("admin","mentor"):
            raise HTTPException(403, "Only mentors and admins can verify answers.")
        try:
            changed = c.execute(text("""
                update app.answers set verified_at=now(),verified_by=:actor where
                org_id=:org and question_id=:question and id=:id and verified_at is null returning id
            """), {"org":org_id,"question":question_id,"id":answer_id,"actor":actor}).scalar()
        except IntegrityError as exc:
            if getattr(exc.orig,"sqlstate",None) == "23505":
                raise HTTPException(409, "This question already has a verified answer.") from exc
            raise
        if changed is None:
            raise HTTPException(404, "Unverified answer not found.")
        return {"id":changed}





OVERVIEW_LIMIT = 100


@router.get("/overview")
def overview(org_id: UUID, actor: Actor):
    # Scope comes from row-level security: admins see the organization, mentors and interns
    # only the internships they are assigned to.
    with program_connection(actor, org_id) as connection:
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
                where i.org_id=:org and t.status in ('planned','changes_requested','submitted')
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
            where i.org_id=:org and t.status in ('planned','changes_requested','submitted')
        """), {"org": org_id}).mappings().one()
        return {"role": role, "items": items, "counts": dict(counts), "limit": OVERVIEW_LIMIT}



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
    parent = assignment(connection, org_id, internship_id)
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
    with program_connection(actor, org_id) as connection:
        assignment(connection, org_id, internship_id)
        rows = connection.execute(text("""
            select * from app.plans where internship_id=:id order by starts_on desc,id
        """), {"id":internship_id}).mappings()
        return [dict(row) for row in rows]


@router.post("/internships/{internship_id}/plans", status_code=201)
def create_plan(org_id: UUID, internship_id: UUID, actor: Actor, data: PlanInput):
    with program_connection(actor, org_id) as connection:
        parent = plan_parent(connection, org_id, internship_id, actor)
        fields = plan_fields(connection, parent, data)
        row = connection.execute(text("""
            insert into app.plans(internship_id,title,goal,project,starts_on,ends_on,draft)
            values (:parent,:title,:goal,:project,:starts_on,:ends_on,cast(:draft as jsonb)) returning *
        """), {"parent":internship_id,**fields}).mappings().one()
        return dict(row)


@router.put("/internships/{internship_id}/plans/{plan_id}")
def edit_plan(org_id: UUID, internship_id: UUID, plan_id: UUID, actor: Actor, data: PlanEdit):
    with program_connection(actor, org_id) as connection:
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
    with program_connection(actor, org_id) as connection:
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
                insert into app.tasks(internship_id,title,criteria,due_on,estimated_hours)
                values (:parent,:title,:criteria,:due_on,:estimated_hours) returning id
            """), {"parent":internship_id,**task.model_dump()}).scalar_one())
        row = connection.execute(text("""
            update app.plans set published_at=now(),task_ids=:tasks where id=:id returning *
        """), {"id":plan_id,"tasks":task_ids}).mappings().one()
        return dict(row)



@router.get("/internships/{internship_id}/activity")
def internship_activity(org_id: UUID, internship_id: UUID, actor: Actor):
    with program_connection(actor, org_id) as c:
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


@router.get("/calendar")
def calendar(org_id: UUID, actor: Actor, start: date, end: date):
    """Task deadlines in a date range, limited by row-level security to internships the actor can see."""
    if end < start or (end - start).days > 92:
        raise HTTPException(422, "Choose a range of up to three months.")
    with program_connection(actor, org_id) as c:
        rows = c.execute(text("""
            select t.id as task_id, t.title, t.status, t.due_on, t.estimated_hours, i.id as internship_id,
                p.name as program, people.intern_name, people.intern_email, people.mentor_name, people.mentor_email
            from app.tasks t
            join app.internships i on i.id = t.internship_id
            join app.programs p on p.id = i.program_id
            left join app.internship_people(:org) people on people.internship_id = i.id
            where i.org_id = :org and t.due_on between :start and :end
            order by t.due_on, (t.status = 'completed'), t.title, t.id
            limit 500
        """), {"org": org_id, "start": start, "end": end}).mappings()
        return [dict(row) for row in rows]


@router.delete("/internships/{internship_id}/plans/{plan_id}")
def delete_plan(org_id: UUID, internship_id: UUID, plan_id: UUID, actor: Actor):
    """Deletes an unpublished draft. Published plans stay: their tasks were assigned and the intern notified."""
    with program_connection(actor, org_id) as connection:
        plan_parent(connection, org_id, internship_id, actor)
        record = plan_record(connection, internship_id, plan_id)
        if record["published_at"]:
            raise HTTPException(409, "Published plans can’t be deleted because their tasks are already assigned.")
        deleted = connection.execute(text("delete from app.plans where id=:id and published_at is null returning id"),
                                     {"id": plan_id}).scalar()
        if deleted is None:
            raise HTTPException(409, "This plan was just published. Reload the page.")
        return {"id": deleted}
