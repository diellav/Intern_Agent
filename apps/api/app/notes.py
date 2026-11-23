"""Internship notes. Visibility is enforced by row-level security: private notes reach only their author."""
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from app.core import deps
from app.routes.assignments import assignment
from app.main import actor_id

router = APIRouter(prefix="/api/organizations/{org_id}")
Actor = Annotated[UUID, Depends(actor_id)]


class NoteInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    body: str = Field(min_length=1, max_length=4000)
    visibility: Literal["private", "shared"] = "private"


NOTE_FIELDS = """n.id, n.body, n.visibility, n.created_at, n.updated_at, n.author_id = :actor as mine,
    case when n.author_id = people.mentor_id then people.mentor_email end as author_email,
    case when n.author_id = people.mentor_id then people.mentor_name end as author_name"""


PEOPLE = """left join (select p.internship_id, p.mentor_email, p.mentor_name, i.mentor_id from app.internship_people(:org) p
    join app.internships i on i.id = p.internship_id) people on people.internship_id = n.internship_id"""


@router.get("/internships/{internship_id}/notes")
def notes(org_id: UUID, internship_id: UUID, actor: Actor, q: Annotated[str, Query(max_length=200)] = ""):
    with deps.program_connection(actor, org_id) as c:
        assignment(c, org_id, internship_id)
        # Search runs under the same row-level security, so it never matches someone else's private note.
        rows = c.execute(text(f"""
            select {NOTE_FIELDS} from app.internship_notes n {PEOPLE}
            where n.internship_id=:id and (:q = '' or n.body ilike '%' || :q || '%')
            order by n.created_at desc, n.id desc limit 100
        """), {"id": internship_id, "q": q.strip(), "org": org_id, "actor": actor}).mappings()
        return [dict(row) for row in rows]


@router.post("/internships/{internship_id}/notes", status_code=201)
def add_note(org_id: UUID, internship_id: UUID, actor: Actor, data: NoteInput):
    with deps.program_connection(actor, org_id) as c:
        parent = assignment(c, org_id, internship_id)
        if parent["mentor_id"] != actor:
            raise HTTPException(403, "Only the assigned mentor can add notes.")
        return dict(c.execute(text("""
            insert into app.internship_notes (internship_id, author_id, body, visibility)
            values (:id, :actor, :body, :visibility) returning id, body, visibility, created_at, updated_at, true as mine
        """), {"id": internship_id, "actor": actor, **data.model_dump()}).mappings().one())


@router.put("/internships/{internship_id}/notes/{note_id}")
def edit_note(org_id: UUID, internship_id: UUID, note_id: UUID, actor: Actor, data: NoteInput):
    with deps.program_connection(actor, org_id) as c:
        assignment(c, org_id, internship_id)
        row = c.execute(text("""
            update app.internship_notes set body=:body, visibility=:visibility, updated_at=now()
            where id=:note and internship_id=:id and author_id=:actor
            returning id, body, visibility, created_at, updated_at, true as mine
        """), {"note": note_id, "id": internship_id, "actor": actor, **data.model_dump()}).mappings().first()
        if row is None:
            raise HTTPException(404, "Note not found.")
        return dict(row)


@router.delete("/internships/{internship_id}/notes/{note_id}")
def delete_note(org_id: UUID, internship_id: UUID, note_id: UUID, actor: Actor):
    with deps.program_connection(actor, org_id) as c:
        assignment(c, org_id, internship_id)
        deleted = c.execute(text("""
            delete from app.internship_notes where id=:note and internship_id=:id and author_id=:actor returning id
        """), {"note": note_id, "id": internship_id, "actor": actor}).scalar()
        if deleted is None:
            raise HTTPException(404, "Note not found.")
        return {"id": deleted}
