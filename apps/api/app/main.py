import logging
from contextlib import contextmanager
from functools import lru_cache
from typing import Annotated
from uuid import UUID

import jwt
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import create_engine, text


class Settings(BaseSettings):
    ai_requests_per_hour: int = Field(default=30, ge=1)
    groq_input_usd_per_million: float | None = Field(default=None, ge=0)
    groq_output_usd_per_million: float | None = Field(default=None, ge=0)
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    frontend_origin: str = "http://localhost:5173"
    supabase_url: str = ""
    database_url: str = ""
    migration_database_url: str = ""
    supabase_secret_key: str = Field(default="", repr=False)
    groq_api_key: str = Field(default="", repr=False)
    groq_model: str = ""
    groq_timeout_seconds: float = 45


@lru_cache
def settings() -> Settings:
    return Settings()


@lru_cache
def jwks(issuer: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"{issuer}/.well-known/jwks.json", timeout=5)


@lru_cache
def engine(database_url: str):
    return create_engine(database_url, pool_pre_ping=True, pool_size=4, max_overflow=0)


bearer = HTTPBearer(auto_error=False)
auth_log = logging.getLogger("internagent.auth")
TOKEN_CLOCK_LEEWAY_SECONDS = 60


def actor_id(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> UUID:
    if credentials is None:
        raise HTTPException(401, "Sign in required", headers={"WWW-Authenticate": "Bearer"})

    if not settings().supabase_url:
        raise HTTPException(503, "Authentication is not configured")

    issuer = f"{settings().supabase_url.rstrip('/')}/auth/v1"
    try:
        key = jwks(issuer).get_signing_key_from_jwt(credentials.credentials)
        claims = jwt.decode(
            credentials.credentials,
            key.key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
            issuer=issuer,
            options={"require": ["exp", "iss", "aud", "sub"]},
            # Tokens are checked seconds after Supabase issues them. A small clock difference between
            # Supabase Auth and this server made fresh tokens fail with "iat in the future" until a refresh.
            leeway=TOKEN_CLOCK_LEEWAY_SECONDS,
        )
        return UUID(claims["sub"])
    except jwt.PyJWKClientConnectionError as exc:
        raise HTTPException(503, "Authentication provider is unavailable") from exc
    except (jwt.PyJWTError, ValueError, TypeError) as exc:
        auth_log.info("Rejected session token: %s", type(exc).__name__)  # never log the token itself
        raise HTTPException(401, "Invalid session", headers={"WWW-Authenticate": "Bearer"}) from exc


class Membership(BaseModel):
    organization_id: UUID
    organization_name: str
    role: str


class CurrentUser(BaseModel):
    user_id: UUID
    full_name: str | None = None
    memberships: list[Membership]


app = FastAPI(title="InternAgent")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings().frontend_origin],
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["X-AI-Usage-ID"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/me")
def me(user_id: Annotated[UUID, Depends(actor_id)]) -> CurrentUser:
    if not settings().database_url:
        raise HTTPException(503, "Database is not configured")

    with engine(settings().database_url).begin() as connection:
        connection.execute(
            text("select set_config('internagent.actor_id', :actor, true)"),
            {"actor": str(user_id)},
        )
        rows = connection.execute(text("""
            select o.id as organization_id, o.name as organization_name, m.role
            from app.memberships m
            join app.organizations o on o.id = m.org_id
            where m.user_id = :actor and m.active
            order by o.name, o.id
        """), {"actor": user_id}).mappings()
        memberships = [Membership.model_validate(dict(row)) for row in rows]
        full_name = connection.execute(text("select full_name from app.profiles where user_id = :actor"),
                                       {"actor": user_id}).scalar()

    return CurrentUser(user_id=user_id, full_name=full_name, memberships=memberships)

class ProfileInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    full_name: str = Field(min_length=1, max_length=120)


@app.put("/api/me/profile")
def update_profile(data: ProfileInput, user_id: Annotated[UUID, Depends(actor_id)]) -> dict:
    """Sets the caller's own display name. It is shown to people who can already see them; it grants nothing."""
    if not settings().database_url:
        raise HTTPException(503, "Database is not configured")
    with engine(settings().database_url).begin() as connection:
        connection.execute(text("select set_config('internagent.actor_id', :actor, true)"), {"actor": str(user_id)})
        name = connection.execute(text("""
            insert into app.profiles (user_id, full_name) values (:actor, :name)
            on conflict (user_id) do update set full_name = excluded.full_name, updated_at = now()
            returning full_name
        """), {"actor": user_id, "name": data.full_name}).scalar_one()
    return {"full_name": name}


class ProgramInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)


class Program(ProgramInput):
    id: UUID
    internship_count: int = 0


@contextmanager
def program_connection(user_id: UUID, org_id: UUID, admin: bool = False):
    if not settings().database_url:
        raise HTTPException(503, "Database is not configured")
    with engine(settings().database_url).begin() as connection:
        connection.execute(text("select set_config('internagent.actor_id', :actor, true)"), {"actor": str(user_id)})
        role = connection.execute(text("""
            select role from app.memberships where org_id = :org and user_id = :actor and active
        """), {"org": org_id, "actor": user_id}).scalar()
        if role is None:
            raise HTTPException(404, "Workspace not found")
        if admin and role != "admin":
            raise HTTPException(403, "Only organization admins can do this.")
        yield connection


@app.get("/api/organizations/{org_id}/programs")
def programs(org_id: UUID, user_id: Annotated[UUID, Depends(actor_id)]) -> list[Program]:
    with program_connection(user_id, org_id) as connection:
        rows = connection.execute(text("""
            select p.id, p.name, p.description,
                (select count(*) from app.internships i where i.program_id = p.id) as internship_count
            from app.programs p where p.org_id = :org order by p.name, p.id
        """), {"org": org_id}).mappings()
        return [Program.model_validate(dict(row)) for row in rows]


@app.post("/api/organizations/{org_id}/programs", status_code=201)
def create_program(org_id: UUID, data: ProgramInput, user_id: Annotated[UUID, Depends(actor_id)]) -> Program:
    with program_connection(user_id, org_id, admin=True) as connection:
        row = connection.execute(text("""
            insert into app.programs (org_id, name, description) values (:org, :name, :description)
            on conflict (org_id, name) do nothing returning id, name, description
        """), {"org": org_id, **data.model_dump()}).mappings().first()
        if row is None:
            raise HTTPException(409, "A program with this name already exists")
        return Program.model_validate(dict(row))

from app.workflow import router as workflow_router
from app.planner import router as planner_router
from app.files import router as files_router
from app.notes import router as notes_router
from app.review_assist import router as review_router

app.include_router(workflow_router)
app.include_router(planner_router)
app.include_router(files_router)
app.include_router(notes_router)
app.include_router(review_router)



from app.members import router as members_router
app.include_router(members_router)

from app.progress import router as progress_router
app.include_router(progress_router)

from app.attention import router as attention_router
app.include_router(attention_router)

from app.task_questions import router as task_questions_router
app.include_router(task_questions_router)

from app.ai_control import router as ai_control_router
app.include_router(ai_control_router)

from app.cv import router as cv_router
app.include_router(cv_router)
