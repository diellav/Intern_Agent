"""Company projects: the real work interns are integrated into.

A program is the intern cohort; a project describes what the team is building, what is happening now,
and where interns can contribute. The AI uses it to fit CV analysis and plan drafts to real work.
"""
from typing import Literal
from urllib.parse import urlparse
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core import deps
from app.core.deps import Actor
from app.routes.assignments import assignment

router = APIRouter(prefix="/api/organizations/{org_id}")

FIELDS = "id, name, description, status, tech_stack, current_focus, intern_areas, repo_url, jira_key, revision, updated_at"


class ProjectInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=6000)  # what the project is and who it is for
    status: Literal["active", "paused", "done"] = "active"
    tech_stack: str = Field(default="", max_length=500)
    current_focus: str = Field(default="", max_length=3000)  # what the team is working on now
    intern_areas: str = Field(default="", max_length=3000)  # where interns can help without blocking the team
    repo_url: str | None = Field(default=None, max_length=2000)
    jira_key: str | None = Field(default=None, pattern=r"^[A-Z][A-Z0-9_]{1,9}$")

    @field_validator("repo_url", "jira_key", mode="before")
    @classmethod
    def blank_is_none(cls, value):
        return value or None

    @field_validator("repo_url")
    @classmethod
    def http_only(cls, value):
        if value and (urlparse(value).scheme not in ("http", "https") or not urlparse(value).netloc):
            raise ValueError("The repository link must start with http:// or https://")
        return value


class ProjectEdit(ProjectInput):
    revision: int = Field(ge=1)


class ProjectLink(BaseModel):
    project_id: UUID | None


def staff(c, org_id, actor, read: bool = False):
    """Admins and mentors manage projects. With read=True, HR may look too."""
    role = c.execute(text("select role from app.memberships where org_id=:org and user_id=:actor and active"),
                     {"org": org_id, "actor": actor}).scalar()
    if role not in (("admin", "mentor", "hr") if read else ("admin", "mentor")):
        raise HTTPException(403, "Only admins and mentors can manage projects.")
    return role


def duplicate(exc: IntegrityError):
    if getattr(exc.orig, "sqlstate", None) == "23505":
        return HTTPException(409, "A project with this name already exists.")
    return exc


def project_context(c, project_id) -> dict | None:
    """The project fields the AI receives. Repository and Jira links stay out."""
    if project_id is None:
        return None
    row = c.execute(text("""
        select name, left(description, 1500) as description, tech_stack, left(current_focus, 1000) as current_focus,
            left(intern_areas, 1000) as intern_areas, status from app.projects where id=:id
    """), {"id": project_id}).mappings().first()
    return dict(row) if row else None


@router.get("/projects")
def projects(org_id: UUID, actor: Actor):
    # Row-level security: staff see every project; interns only their own internship's project.
    with deps.program_connection(actor, org_id) as c:
        rows = c.execute(text(f"""
            select {', '.join('p.' + f.strip() for f in FIELDS.split(','))},
                (select count(*) from app.internships i where i.project_id=p.id and i.closed_at is null) as active_interns
            from app.projects p where p.org_id=:org
            order by (p.status <> 'active'), p.name, p.id
        """), {"org": org_id}).mappings()
        return [dict(row) for row in rows]


@router.post("/projects", status_code=201)
def create_project(org_id: UUID, actor: Actor, data: ProjectInput):
    with deps.program_connection(actor, org_id) as c:
        staff(c, org_id, actor)
        try:
            with c.begin_nested():
                row = c.execute(text(f"""
                    insert into app.projects (org_id, name, description, status, tech_stack, current_focus, intern_areas,
                        repo_url, jira_key, created_by)
                    values (:org, :name, :description, :status, :tech_stack, :current_focus, :intern_areas,
                        :repo_url, :jira_key, :actor) returning {FIELDS}
                """), {"org": org_id, "actor": actor, **data.model_dump()}).mappings().one()
        except IntegrityError as exc:
            raise duplicate(exc) from exc
        return dict(row)


@router.put("/projects/{project_id}")
def edit_project(org_id: UUID, project_id: UUID, actor: Actor, data: ProjectEdit):
    with deps.program_connection(actor, org_id) as c:
        staff(c, org_id, actor)
        try:
            with c.begin_nested():
                row = c.execute(text(f"""
                    update app.projects set name=:name, description=:description, status=:status, tech_stack=:tech_stack,
                        current_focus=:current_focus, intern_areas=:intern_areas, repo_url=:repo_url, jira_key=:jira_key,
                        revision=revision+1, updated_at=now()
                    where org_id=:org and id=:id and revision=:revision returning {FIELDS}
                """), {"org": org_id, "id": project_id, **data.model_dump()}).mappings().first()
        except IntegrityError as exc:
            raise duplicate(exc) from exc
        if row is None:
            raise HTTPException(409, "This project changed or no longer exists. Reload it before editing.")
        return dict(row)


@router.delete("/projects/{project_id}")
def delete_project(org_id: UUID, project_id: UUID, actor: Actor):
    with deps.program_connection(actor, org_id) as c:
        if staff(c, org_id, actor) != "admin":
            raise HTTPException(403, "Only admins can delete projects.")
        if c.execute(text("select 1 from app.internships where project_id=:id limit 1"), {"id": project_id}).first():
            raise HTTPException(409, "Interns are linked to this project. Move them first, or mark the project as done.")
        deleted = c.execute(text("delete from app.projects where org_id=:org and id=:id returning id"),
                            {"org": org_id, "id": project_id}).scalar()
        if deleted is None:
            raise HTTPException(404, "Project not found.")
        return {"id": deleted}


@router.put("/internships/{internship_id}/project")
def link_project(org_id: UUID, internship_id: UUID, actor: Actor, data: ProjectLink):
    with deps.program_connection(actor, org_id) as c:
        parent = assignment(c, org_id, internship_id)
        if staff(c, org_id, actor) != "admin" and parent["mentor_id"] != actor:
            raise HTTPException(403, "Only an admin or the assigned mentor can change the project.")
        if data.project_id and not c.execute(text("select 1 from app.projects where org_id=:org and id=:id"),
                                             {"org": org_id, "id": data.project_id}).first():
            raise HTTPException(404, "Project not found.")
        c.execute(text("select app.set_internship_project(:id, :project)"), {"id": internship_id, "project": data.project_id})
        return {"id": internship_id, "project_id": data.project_id}
