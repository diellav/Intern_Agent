from time import perf_counter
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import text

from app.main import program_connection, settings
from app.core.ai_provider import Provider, planner_provider
from app.core.deps import Actor

router = APIRouter(prefix="/api/organizations/{org_id}/ai")


class MeteredProvider:
    def __init__(self, provider, org_id, actor, action, response):
        self.provider = provider
        self.model = provider.model
        self.org = org_id
        self.actor = actor
        self.action = action
        self.response = response
        self.last_id = None

    def complete(self, messages, schema):
        params = {"org": self.org, "actor": self.actor, "model": self.model, "action": self.action}
        with program_connection(self.actor, self.org) as connection:
            connection.execute(text("select pg_advisory_xact_lock(hashtextextended(:key,0))"),
                               {"key": f"ai:{self.org}:{self.actor}"})
            window = connection.execute(text("""
                select count(*), ceil(extract(epoch from min(started_at)+interval '1 hour'-now()))
                from app.ai_usage where actor_id=:actor and org_id=:org
                and started_at > now()-interval '1 hour'
            """), params).one()
            if window[0] >= settings().ai_requests_per_hour:
                seconds = max(1, int(window[1]))
                minutes = max(1, (seconds + 59) // 60)
                raise HTTPException(429, f"AI limit reached. Try again in about {minutes} minute(s).",
                                    headers={"Retry-After": str(seconds)})
            identifier = connection.execute(text("""
                insert into app.ai_usage(org_id,actor_id,model,action)
                values (:org,:actor,:model,:action) returning id
            """), params).scalar_one()
        self.last_id = identifier

        start = perf_counter()
        outcome = "provider_error"
        try:
            raw = self.provider.complete(messages, schema)
            outcome = "provider_success"
            self.response.headers["X-AI-Usage-ID"] = str(identifier)
            return raw
        finally:
            usage = getattr(self.provider, "usage", {})
            with program_connection(self.actor, self.org) as connection:
                connection.execute(text("""
                    update app.ai_usage set outcome=:outcome,elapsed_ms=:elapsed,
                        input_tokens=:input,output_tokens=:output where id=:id and org_id=:org
                """), {"outcome": outcome, "elapsed": round((perf_counter()-start)*1000),
                         "input": usage.get("prompt_tokens"), "output": usage.get("completion_tokens"),
                         "id": identifier, "org": self.org})


def mark_invalid(provider) -> None:
    """The provider answered, but the answer failed validation: record it as such, not as a success."""
    if isinstance(provider, MeteredProvider) and provider.last_id:
        with program_connection(provider.actor, provider.org) as connection:
            connection.execute(text("update app.ai_usage set outcome='validation_error' where id=:id and org_id=:org"),
                               {"id": provider.last_id, "org": provider.org})
        if "X-AI-Usage-ID" in provider.response.headers:  # Starlette headers have no pop()
            del provider.response.headers["X-AI-Usage-ID"]


def metered_provider(org_id: UUID, actor: Actor, request: Request, response: Response,
                     provider: Annotated[Provider | None, Depends(planner_provider)]) -> Provider | None:
    if provider is None:
        return None
    return MeteredProvider(provider, org_id, actor, request.scope["route"].endpoint.__name__, response)


class Vote(BaseModel):
    value: Literal[-1, 1]


@router.put("/usage/{identifier}/vote")
def vote(org_id: UUID, identifier: UUID, actor: Actor, data: Vote):
    with program_connection(actor, org_id) as connection:
        changed = connection.execute(text("""
            update app.ai_usage set vote=:vote where org_id=:org and actor_id=:actor
                and id=:id and outcome='provider_success' returning id
        """), {"org": org_id, "id": identifier, "actor": actor, "vote": data.value}).scalar()
        if changed is None:
            raise HTTPException(404, "Suggestion not found")
    return {"vote": data.value}


@router.get("/usage")
def usage(org_id: UUID, actor: Actor):
    with program_connection(actor, org_id, admin=True) as connection:
        # Show people by name (email as fallback) using the admin-only members listing.
        entries = [dict(row) for row in connection.execute(text("""
            select u.id,u.actor_id,u.action,u.model,u.started_at,u.elapsed_ms,u.outcome,u.input_tokens,u.output_tokens,u.vote,
                m.full_name as actor_name, m.email as actor_email
            from app.ai_usage u left join app.members(:org) m on m.id=u.actor_id
            where u.org_id=:org order by u.started_at desc limit 100
        """), {"org": org_id}).mappings()]

    config = settings()
    for entry in entries:
        entry["estimated_cost_usd"] = None
        if (entry["model"] == config.groq_model and config.groq_input_usd_per_million is not None
                and config.groq_output_usd_per_million is not None
                and entry["input_tokens"] is not None and entry["output_tokens"] is not None):
            entry["estimated_cost_usd"] = (
                entry["input_tokens"] * config.groq_input_usd_per_million
                + entry["output_tokens"] * config.groq_output_usd_per_million
            ) / 1_000_000
    return entries