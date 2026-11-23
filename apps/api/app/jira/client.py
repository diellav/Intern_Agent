"""Reads issues from Jira Cloud (REST API v3). Read-only; credentials come from server settings and are never logged."""
import logging
from datetime import datetime

import httpx

from app.main import settings

log = logging.getLogger("internagent.jira")
FIELDS = "summary,issuetype,status,parent,labels,assignee,description,updated"
MAX_ISSUES = 1000


class JiraError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def configured() -> bool:
    config = settings()
    return bool(config.jira_base_url and config.jira_email and config.jira_api_token)


def browse_url() -> str | None:
    return settings().jira_base_url.rstrip("/") + "/browse/" if configured() else None


def plain_text(node, limit: int = 1500) -> str:
    """Text of an Atlassian Document Format value, flattened."""
    parts: list[str] = []

    def walk(value):
        if isinstance(value, dict):
            if value.get("type") == "text":
                parts.append(value.get("text", ""))
            for child in value.get("content", []) or []:
                walk(child)
            if value.get("type") in ("paragraph", "heading", "listItem"):
                parts.append("\n")
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(node)
    text = " ".join("".join(parts).split())
    return text[:limit]


def fetch_issues(project_key: str, client: httpx.Client | None = None) -> list[dict]:
    """All issues of one Jira project, normalised. Raises JiraError with a message safe to show."""
    if not configured():
        raise JiraError(503, "Jira is not configured on the server.")
    config = settings()
    own = client is None
    client = client or httpx.Client(base_url=config.jira_base_url.rstrip("/"), timeout=30,
                                    auth=(config.jira_email, config.jira_api_token))
    raw: list[dict] = []
    token = None
    try:
        while len(raw) < MAX_ISSUES:
            params = {"jql": f'project = "{project_key}" ORDER BY key', "fields": FIELDS, "maxResults": 100}
            if token:
                params["nextPageToken"] = token
            try:
                response = client.get("/rest/api/3/search/jql", params=params)
            except httpx.HTTPError as exc:
                log.warning("Jira request failed: %s", type(exc).__name__)
                raise JiraError(502, "Could not reach Jira. Try again later.") from None
            if response.status_code in (401, 403):
                raise JiraError(502, "Jira rejected the server's credentials. Ask an admin to check the Jira token.")
            if response.status_code == 400:
                raise JiraError(404, f"Jira project {project_key} was not found, or the server's account cannot see it.")
            if response.status_code != 200:
                log.warning("Jira returned HTTP %s", response.status_code)
                raise JiraError(502, "Jira failed to respond. Try again later.")
            body = response.json()
            raw.extend(body.get("issues", []))
            token = body.get("nextPageToken")
            if not token or body.get("isLast"):
                break
    finally:
        if own:
            client.close()
    return normalise(raw)


def _client() -> httpx.Client:
    config = settings()
    return httpx.Client(base_url=config.jira_base_url.rstrip("/"), timeout=30, auth=(config.jira_email, config.jira_api_token))


def find_account(email: str) -> str:
    """The Jira account ID for an email on this site. Only the ID is kept."""
    if not configured():
        raise JiraError(503, "Jira is not configured on the server.")
    with _client() as jira:
        try:
            response = jira.get("/rest/api/3/user/search", params={"query": email, "maxResults": 5})
        except httpx.HTTPError:
            raise JiraError(502, "Could not reach Jira. Try again later.") from None
    if response.status_code != 200:
        raise JiraError(502, "Jira did not answer the user search. Check the server's Jira token.")
    people = [p for p in response.json() if p.get("accountType") == "atlassian" and p.get("active", True)]
    exact = [p for p in people if (p.get("emailAddress") or "").lower() == email.lower()]
    match = exact or (people if len(people) == 1 else [])
    if len(match) != 1:
        raise JiraError(404, "No single Jira user matches this email. Invite the intern to the Jira site first.")
    return match[0]["accountId"]


def assign(issue_key: str, account_id: str) -> None:
    if not configured():
        raise JiraError(503, "Jira is not configured on the server.")
    with _client() as jira:
        try:
            response = jira.put(f"/rest/api/3/issue/{issue_key}/assignee", json={"accountId": account_id})
        except httpx.HTTPError:
            raise JiraError(502, "Could not reach Jira. Try again later.") from None
    if response.status_code == 400:
        raise JiraError(409, "Jira refused the assignment. The intern may not have access to this project.")
    if response.status_code == 404:
        raise JiraError(404, f"{issue_key} no longer exists in Jira.")
    if response.status_code != 204:
        log.warning("Jira assign returned HTTP %s", response.status_code)
        raise JiraError(502, "Jira did not accept the assignment. Check the server's Jira permissions.")


def normalise(raw: list[dict]) -> list[dict]:
    issues = {}
    for item in raw:
        fields = item.get("fields", {})
        parent = fields.get("parent") or {}
        updated = fields.get("updated")
        issues[item["key"]] = {
            "key": item["key"],
            "summary": (fields.get("summary") or "")[:500],
            "issue_type": (fields.get("issuetype") or {}).get("name", "Task"),
            "status": (fields.get("status") or {}).get("name", "Unknown"),
            "status_category": ((fields.get("status") or {}).get("statusCategory") or {}).get("key", "new"),
            "parent_key": parent.get("key"),
            "parent_type": ((parent.get("fields") or {}).get("issuetype") or {}).get("name"),
            "labels": [label[:60] for label in (fields.get("labels") or [])][:20],
            "assigned": bool(fields.get("assignee")),
            "assignee_account_id": (fields.get("assignee") or {}).get("accountId"),
            "description": plain_text(fields.get("description")),
            "jira_updated_at": datetime.fromisoformat(updated.replace("Z", "+00:00")) if updated else None,
        }
    for issue in issues.values():
        if issue["status_category"] not in ("new", "indeterminate", "done"):
            issue["status_category"] = "new"
        # The epic: the parent when it is an epic, or the epic of the parent (sub-tasks).
        parent = issues.get(issue["parent_key"]) if issue["parent_key"] else None
        if issue["parent_type"] == "Epic" or (parent and parent["issue_type"] == "Epic"):
            issue["epic_key"] = issue["parent_key"]
        elif parent:
            issue["epic_key"] = parent["parent_key"] if parent.get("parent_type") == "Epic" else None
        else:
            issue["epic_key"] = None
    return list(issues.values())
