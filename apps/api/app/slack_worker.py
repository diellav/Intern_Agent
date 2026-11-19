import time
from typing import Literal
from uuid import UUID

import httpx
from pydantic import AnyHttpUrl, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import create_engine, text


class SlackSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    slack_database_url: SecretStr
    slack_bot_token: SecretStr
    slack_org_id: UUID
    slack_workspace_id: str
    slack_app_url: AnyHttpUrl


class SlackError(Exception):
    def __init__(self, code: str, retry_after: int = 0):
        self.code = code
        self.retry_after = retry_after


def slack_call(client, method, *, params=None, payload=None):
    response = client.request("GET" if payload is None else "POST", method,
                              params=params, json=payload)
    if response.status_code == 429:
        retry_after = response.headers.get("Retry-After", "60")
        raise SlackError("rate_limited", int(retry_after) if retry_after.isdecimal() else 60)
    response.raise_for_status()
    result = response.json()
    if not result.get("ok"):
        raise SlackError(result.get("error", "unknown"))
    return result


def send_notice(client, config, notice):
    person = slack_call(client, "users.lookupByEmail", params={"email": notice["email"]})["user"]
    if person.get("deleted") or person.get("is_bot"):
        raise SlackError("users_not_found")
    path = f'#/internships/{notice["internship_id"]}'
    if notice["task_id"]:
        path += f'/tasks/{notice["task_id"]}'
        if notice["version"]:
            path += f'?v={notice["version"]}'
    else:
        path += "/plan"
    labels = {
        "assigned": "New task",
        "submitted": "Submission awaiting review",
        "completed": "Submission approved",
        "changes_requested": "Changes requested",
        "plan_published": "Plan published",
    }
    heading = f'{labels.get(notice["event"], "Update")}: {notice["title"]}'
    if notice["version"]:
        heading += f' (version {notice["version"]})'
    slack_call(client, "chat.postMessage", payload={
        "channel": person["id"],
        "text": heading,
        "mrkdwn": False,
        "unfurl_links": False,
        "unfurl_media": False,
        "blocks": [
            {"type": "section", "text": {"type": "plain_text", "text": heading}},
            {"type": "actions", "elements": [
                {"type": "button", "text": {"type": "plain_text", "text": "Open in InternAgent"},
                 "url": f'{str(config.slack_app_url).rstrip("/")}/{path}'}
            ]},
        ],
    })


# Errors that retrying cannot fix: stop the worker instead of failing every queued notice.
FATAL = {"invalid_auth", "not_authed", "account_inactive", "token_revoked", "token_expired", "missing_scope", "no_permission"}


def deliver_one(database, client, config):
    args = {"org": config.slack_org_id}
    with database.begin() as connection:
        notice = connection.execute(text(
            "select * from app.claim_slack_notification(:org)"
        ), args).mappings().first()
    if notice is None:
        return False

    outcome: Literal["sent", "unmapped", "failed"] | None = "sent"
    delay = 30 * 2 ** (notice["attempts"] - 1)
    try:
        send_notice(client, config, notice)
    except SlackError as error:
        outcome = "unmapped" if error.code == "users_not_found" else None
        delay = max(delay, error.retry_after)
        if error.code in FATAL:
            with database.begin() as connection:  # put the notice back untouched for when the token is fixed
                connection.execute(text("select app.finish_slack_notification(:org, :id, :attempt, null, 60)"),
                                   {**args, "id": notice["id"], "attempt": max(0, notice["attempts"] - 1)})
            raise SystemExit(f"Slack rejected the bot token ({error.code}). Fix SLACK_BOT_TOKEN or the app's scopes, then restart.")
    except Exception:  # network, bad data or anything unexpected: retry later, never crash with a claimed row
        outcome = None
    if outcome is None and notice["attempts"] >= 6:
        outcome = "failed"
    with database.begin() as connection:
        connection.execute(text(
            "select app.finish_slack_notification(:org, :id, :attempt, :outcome, :delay)"
        ), {**args, "id": notice["id"], "attempt": notice["attempts"],
            "outcome": outcome, "delay": delay})
    return True


def main():
    config = SlackSettings()
    database = create_engine(config.slack_database_url.get_secret_value(),
                             pool_pre_ping=True, hide_parameters=True)
    with httpx.Client(base_url="https://slack.com/api/", timeout=10, headers={
        "Authorization": f"Bearer {config.slack_bot_token.get_secret_value()}"
    }) as client:
        if slack_call(client, "auth.test", payload={}).get("team_id") != config.slack_workspace_id:
            raise SystemExit("Slack token belongs to a different workspace.")
        while True:
            if not deliver_one(database, client, config):
                time.sleep(5)


if __name__ == "__main__":
    main()
