from typing import Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.main import program_connection, settings
from app.workflow import Actor

router = APIRouter(prefix="/api/organizations/{org_id}/members")


class Invitation(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    email: str = Field(max_length=254, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
    full_name: str = Field(min_length=1, max_length=120)
    role: Literal["admin", "mentor", "intern"]


class RoleChange(BaseModel):
    role: Literal["admin", "mentor", "intern"]


def denied(exc: DBAPIError, message: str):
    if getattr(exc.orig, "sqlstate", None) == "42501":
        raise HTTPException(403, message) from None
    raise exc


def send_invite(email: str):
    config = settings()
    if not config.supabase_url or not config.supabase_secret_key:
        raise HTTPException(503, "Email invitations are not configured.")
    headers = {"apikey": config.supabase_secret_key}
    if config.supabase_secret_key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {config.supabase_secret_key}"
    try:
        response = httpx.post(
            config.supabase_url.rstrip("/") + "/auth/v1/invite",
            headers=headers, json={"email": email},
            params={"redirect_to": config.frontend_origin}, timeout=10,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(502, "Could not contact Supabase Auth. Try again.") from exc
    if response.status_code == 429:
        raise HTTPException(429, "Too many email requests. Wait before resending.")
    if not response.is_success:
        raise HTTPException(502, "Supabase could not send the invitation. Check Auth logs and SMTP settings.")


@router.get("")
def members(org_id: UUID, actor: Actor):
    with program_connection(actor, org_id, admin=True) as c:
        return [dict(row) for row in c.execute(text("select * from app.members(:org)"), {"org": org_id}).mappings()]


def auth_id(org_id, actor, email):
    with program_connection(actor, org_id, admin=True) as c:
        return c.execute(text("select app.member_auth_id(:org,:email)"), {"org":org_id,"email":email}).scalar_one()


@router.post("")
def invite(org_id: UUID, actor: Actor, data: Invitation):
    email = data.email.lower()
    person = auth_id(org_id, actor, email)
    invited = person is None
    if invited:
        send_invite(email)
        person = auth_id(org_id, actor, email)
        if person is None:
            raise HTTPException(502, "Invited account could not be found.")
    try:
        with program_connection(actor, org_id, admin=True) as c:
            # add_member also stores the entered name when the account has no profile yet.
            added = c.execute(text("select app.add_member(:org,:person,:role,:name)"),
                              {"org":org_id,"person":person,"role":data.role,"name":data.full_name}).scalar_one()
            if not added:
                raise HTTPException(409, "This person is already a member.")
    except DBAPIError as exc:
        denied(exc, "You are no longer an admin of this organization.")
    return {"id":person, "invited":invited}


@router.post("/{person}/resend")
def resend(org_id: UUID, person: UUID, actor: Actor):
    with program_connection(actor, org_id, admin=True) as c:
        row = c.execute(text("select email from app.members(:org) where id=:id and status='pending'"),
                        {"org":org_id,"id":person}).first()
        if row is None:
            raise HTTPException(404, "Pending invitation not found.")
    send_invite(row.email)
    return {"sent":True}


@router.post("/{person}/remove")
def remove(org_id: UUID, person: UUID, actor: Actor):
    if person == actor:
        raise HTTPException(409, "You cannot remove your own membership.")
    try:
        with program_connection(actor, org_id, admin=True) as c:
            removed = c.execute(text("select app.remove_member(:org,:person)"),
                                {"org":org_id,"person":person}).scalar_one()
            if not removed:
                raise HTTPException(404, "Active membership not found.")
    except DBAPIError as exc:
        denied(exc, "You are no longer an admin of this organization.")
    return {"removed":True}


@router.put("/{person}/role")
def change_role(org_id: UUID, person: UUID, actor: Actor, data: RoleChange):
    if person == actor:
        raise HTTPException(409, "You cannot change your own role.")
    try:
        with program_connection(actor, org_id, admin=True) as c:
            changed = c.execute(text("select app.set_member_role(:org,:person,:role)"),
                                {"org":org_id,"person":person,"role":data.role}).scalar_one()
            if not changed:
                raise HTTPException(404, "Active membership not found.")
    except DBAPIError as exc:
        denied(exc, "Role not changed: only an active admin can change roles, and the organization must keep at least one admin.")
    return {"id":person, "role":data.role}
