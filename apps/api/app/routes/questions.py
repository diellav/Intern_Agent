"""Questions and answers: one table for both general questions and questions asked from a task.

The AI answer suggestion for task questions lives in `app/question_assist.py`.
"""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core import deps
from app.core.deps import Actor
from app.routes.tasks import task_scope

router = APIRouter(prefix="/api/organizations/{org_id}")


class QuestionInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=180)
    body: str = Field(min_length=1, max_length=6000)


class AnswerInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    body: str = Field(min_length=1, max_length=6000)


@router.get("/questions")
def questions(org_id: UUID, actor: Actor, q: Annotated[str, Query(max_length=200)] = ""):
    with deps.program_connection(actor, org_id) as c:
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


def insert_question(c, org_id, actor, data: QuestionInput, task_id=None):
    return c.execute(text("""
        insert into app.questions(org_id,task_id,author_id,title,body) values (:org,:task,:actor,:title,:body) returning id
    """), {"org": org_id, "task": task_id, "actor": actor, **data.model_dump()}).scalar_one()


@router.post("/questions", status_code=201)
def ask(org_id: UUID, actor: Actor, data: QuestionInput):
    with deps.program_connection(actor, org_id) as c:
        return {"id": insert_question(c, org_id, actor, data)}


@router.get("/tasks/{task_id}/questions")
def task_questions(org_id: UUID, task_id: UUID, actor: Actor):
    with deps.program_connection(actor, org_id) as c:
        task_scope(c, org_id, task_id)
        rows = c.execute(text("""
            select id,title,body from app.questions where org_id=:org and task_id=:task
            order by created_at desc,id limit 50
        """), {"org": org_id, "task": task_id}).mappings()
        return [dict(row) for row in rows]


@router.post("/tasks/{task_id}/questions", status_code=201)
def ask_task(org_id: UUID, task_id: UUID, actor: Actor, data: QuestionInput):
    with deps.program_connection(actor, org_id) as c:
        task_scope(c, org_id, task_id)
        return {"id": insert_question(c, org_id, actor, data, task_id)}


def check_question(c, org_id, question_id):
    if not c.execute(text("select id from app.questions where org_id=:org and id=:id"), {"org":org_id,"id":question_id}).scalar():
        raise HTTPException(404, "Question not found.")


@router.get("/questions/{question_id}/answers")
def answers(org_id: UUID, question_id: UUID, actor: Actor):
    with deps.program_connection(actor, org_id) as c:
        check_question(c, org_id, question_id)
        rows = c.execute(text("""
            select id,body,created_at,verified_at from app.answers where org_id=:org and question_id=:id
            order by (verified_at is null),created_at,id limit 50
        """), {"org":org_id,"id":question_id}).mappings()
        return [dict(row) for row in rows]


@router.post("/questions/{question_id}/answers", status_code=201)
def answer(org_id: UUID, question_id: UUID, actor: Actor, data: AnswerInput):
    with deps.program_connection(actor, org_id) as c:
        check_question(c, org_id, question_id)
        identifier = c.execute(text("""
            insert into app.answers(org_id,question_id,author_id,body) values (:org,:question,:actor,:body) returning id
        """), {"org":org_id,"question":question_id,"actor":actor,"body":data.body}).scalar_one()
        return {"id":identifier}


@router.post("/questions/{question_id}/answers/{answer_id}/verify")
def verify_answer(org_id: UUID, question_id: UUID, answer_id: UUID, actor: Actor):
    with deps.program_connection(actor, org_id) as c:
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
