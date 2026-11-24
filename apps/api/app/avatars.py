"""Profile pictures for people in a workspace, looked up by email on the company's Jira site.

No account linking is needed: the Jira user with exactly that email is used. People without a Jira profile
photo (Jira's generated initials image) get None, and the app keeps its own initials.
"""
import time
from typing import Annotated
from uuid import UUID

import httpx
from fastapi import APIRouter, Query
from sqlalchemy import text

from app.core import deps
from app.core.deps import Actor
from app.jira import client

router = APIRouter(prefix="/api/organizations/{org_id}/avatars")
CACHE_SECONDS = 24 * 3600
MAX_EMAILS = 50
_cache: dict[str, tuple[float, str | None]] = {}


def jira_avatar(jira: httpx.Client, email: str) -> str | None:
    try:
        response = jira.get("/rest/api/3/user/search", params={"query": email, "maxResults": 5})
    except httpx.HTTPError:
        raise client.JiraError(502, "Could not reach Jira.") from None
    if response.status_code != 200:
        raise client.JiraError(502, "Jira did not answer the user search.")
    match = [p for p in response.json() if (p.get("emailAddress") or "").lower() == email]
    url = (match[0].get("avatarUrls") or {}).get("48x48") if len(match) == 1 else None
    # Jira's default picture is a generated initials image; ours already does that.
    return None if not url or "/initials/" in url or "default-avatar" in url else url


@router.get("")
def avatars(org_id: UUID, actor: Actor, email: Annotated[list[str], Query(max_length=MAX_EMAILS)] = []) -> dict[str, str | None]:
    wanted = sorted({item.strip().lower() for item in email if item.strip()})
    if not wanted:
        return {}
    with deps.program_connection(actor, org_id) as c:
        members = set(c.execute(text("select app.member_emails_in(:org, :emails)"),
                                {"org": org_id, "emails": wanted}).scalars())
    result: dict[str, str | None] = {item: None for item in wanted}
    now = time.monotonic()
    missing = []
    for item in sorted(members):
        cached = _cache.get(item)
        if cached and now - cached[0] < CACHE_SECONDS:
            result[item] = cached[1]
        else:
            missing.append(item)
    if missing and client.configured():
        try:
            with client._client() as jira:
                for item in missing:
                    url = jira_avatar(jira, item)
                    _cache[item] = (now, url)
                    result[item] = url
        except client.JiraError:
            pass  # Jira unavailable: initials stay, try again on the next request
    return result
