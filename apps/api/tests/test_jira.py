import json
import os
from contextlib import contextmanager
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core import deps
from app.core.ai_provider import planner_provider
from app.jira import client as jira_client
from app.jira.client import normalise
from app.main import actor_id, app, settings


def issue(key, kind, status, category, parent=None, parent_type=None, labels=(), assignee=None):
    fields = {"summary": f"{kind} {key}", "issuetype": {"name": kind}, "status": {"name": status, "statusCategory": {"key": category}},
              "labels": list(labels), "assignee": assignee, "updated": "2026-11-20T10:00:00.000+0000",
              "description": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": f"About {key}"}]}]}}
    if parent:
        fields["parent"] = {"key": parent, "fields": {"issuetype": {"name": parent_type}}}
    return {"key": key, "fields": fields}


BOARD = [
    issue("HR-1", "Epic", "In Progress", "indeterminate"),
    issue("HR-2", "Story", "In Progress", "indeterminate", "HR-1", "Epic", assignee={"accountId": "x"}),
    issue("HR-3", "Subtask", "To Do", "new", "HR-2", "Story"),
    issue("HR-4", "Bug", "To Do", "new", "HR-1", "Epic", labels=["good-first-issue"]),
    issue("HR-5", "Task", "Done", "done", "HR-1", "Epic"),
]


def test_normalise_finds_epics_and_hides_assignees():
    issues = {i["key"]: i for i in normalise(BOARD)}
    assert issues["HR-3"]["epic_key"] == "HR-1"  # sub-task -> story -> epic
    assert issues["HR-4"]["epic_key"] == "HR-1"
    assert issues["HR-2"]["assigned"] is True and "assignee" not in issues["HR-2"]
    assert issues["HR-4"]["description"] == "About HR-4"


@pytest.mark.skipif(os.environ.get("INTERNAGENT_DB_TEST") != "1", reason="opt-in PostgreSQL rollback test")
def test_sync_records_changes_and_brief_builds_on_them(monkeypatch):
    engine = create_engine(settings().migration_database_url)
    admin, mentor, intern, hr = [uuid4() for _ in range(4)]
    org, program = uuid4(), uuid4()
    actor = mentor
    board = list(BOARD)
    monkeypatch.setattr(settings(), "jira_base_url", "https://example.atlassian.net")
    monkeypatch.setattr(settings(), "jira_email", "bot@example.test")
    monkeypatch.setattr(settings(), "jira_api_token", "test-token")
    monkeypatch.setattr(jira_client, "fetch_issues", lambda key: normalise(board))

    class FakeAI:
        model = "fake"
        prompts = []

        def complete(self, messages, schema):
            self.prompts.append(json.loads(messages[1]["content"]))
            return json.dumps({"state": "Onboarding is half done.", "modules": [{"name": "Onboarding", "status": "in_progress", "note": "Bug open"}],
                               "recent_changes": [], "suggested_fields": {"description": "HR platform", "current_focus": "Onboarding", "intern_areas": "Bugs"},
                               "intern_opportunities": [{"issue_key": "HR-4", "why": "Small bug"}, {"issue_key": "HR-5", "why": "Done already"},
                                                                {"issue_key": "HR-6", "why": "New and small"}]})

    fake = FakeAI()
    with engine.connect() as connection:
        tx = connection.begin()
        try:
            for user in (admin, mentor, intern, hr):
                connection.execute(text("insert into auth.users (id, email) values (:id,:email)"), {"id": user, "email": f"{user}@example.test"})
            connection.execute(text("insert into app.organizations(id,slug,name) values (:id,:slug,'Jira verification')"), {"id": org, "slug": str(org)})
            for user, role in [(admin, "admin"), (mentor, "mentor"), (intern, "intern"), (hr, "hr")]:
                connection.execute(text("insert into app.memberships(org_id,user_id,role) values (:org,:id,:role)"), {"org": org, "id": user, "role": role})
            connection.execute(text("insert into app.programs(id,org_id,name) values (:id,:org,'Cohort')"), {"id": program, "org": org})
            connection.execute(text("grant internagent_runtime to postgres with set true"))
            connection.execute(text("set local role internagent_runtime"))

            @contextmanager
            def scoped(user_id, org_id, admin=False):
                with connection.begin_nested():
                    connection.execute(text("select set_config('internagent.actor_id',:actor,true)"), {"actor": str(user_id)})
                    yield connection

            from app import ai_control, attention, progress
            monkeypatch.setattr(deps, "program_connection", scoped)
            for module in (ai_control, attention, progress):
                monkeypatch.setattr(module, "program_connection", scoped)
            monkeypatch.setitem(app.dependency_overrides, actor_id, lambda: actor)
            monkeypatch.setitem(app.dependency_overrides, planner_provider, lambda: fake)
            with TestClient(app) as client:
                base = f"/api/organizations/{org}/projects"
                project = client.post(base, json={"name": "PeopleHub", "jira_key": "HR"}).json()["id"]
                first = client.post(f"{base}/{project}/jira/sync")
                assert first.status_code == 200, first.text
                status = first.json()
                assert status["counts"] == {"total": 4, "done": 1, "in_progress": 1, "to_do": 2, "unassigned": 2}
                assert status["modules"][0]["total"] == 4 and status["events"] == []  # the first sync is the baseline
                assert [o["issue_key"] for o in status["brief"]["intern_opportunities"]] == ["HR-4"]  # done issue dropped
                assert status["brief_outdated"] is False

                board[3] = issue("HR-4", "Bug", "Done", "done", "HR-1", "Epic")
                board.append(issue("HR-6", "Task", "To Do", "new", "HR-1", "Epic"))
                second = client.post(f"{base}/{project}/jira/sync").json()
                assert {(e["key"], e["kind"]) for e in second["events"]} == {("HR-4", "status"), ("HR-6", "created")}
                # The new brief sees the previous one and only the changes since it.
                latest = fake.prompts[-1]
                assert latest["previous_brief"]["state"] == "Onboarding is half done."
                assert {c["key"] for c in latest["changes_since_last_brief"]} == {"HR-4", "HR-6"}
                assert client.post(f"{base}/{project}/jira/sync", params={"analyse": False}).json()["brief_outdated"] is False

                # The assistant for one intern: link their Jira account, see suggestions, assign in Jira.
                assigned = []
                monkeypatch.setattr(jira_client, "find_account", lambda email: "acc-intern")
                monkeypatch.setattr(jira_client, "assign", lambda key, account: assigned.append((key, account)))
                actor = admin
                internship = client.post(f"/api/organizations/{org}/internships", json={
                    "program_id": str(program), "mentor_id": str(mentor), "intern_id": str(intern),
                    "starts_on": "2026-11-01", "ends_on": "2026-12-20", "project_id": project}).json()["id"]
                actor = mentor
                path = f"/api/organizations/{org}/internships/{internship}"
                work = client.get(path + "/jira-work").json()
                assert work["linked"] is False and [s["key"] for s in work["suggestions"]] == ["HR-6"]
                assert client.post(path + "/jira-work/assign", json={"issue_key": "HR-6"}).status_code == 422  # not linked yet
                work = client.put(path + "/jira-account", json={"email": "intern@example.test"}).json()
                assert work["linked"] is True
                assert client.post(path + "/jira-work/assign", json={"issue_key": "HR-2"}).status_code == 409  # someone else's
                work = client.post(path + "/jira-work/assign", json={"issue_key": "HR-6"}).json()
                assert assigned == [("HR-6", "acc-intern")]
                assert [i["key"] for i in work["issues"]] == ["HR-6"] and work["counts"]["to_do"] == 1
                assert work["suggestions"] == []  # assigned issues are no longer suggested
                row = client.get(f"/api/organizations/{org}/jira-overview").json()[0]
                assert (row["project"], row["to_do"], row["linked"]) == ("PeopleHub", 1, True)

                actor = intern  # interns don't see Jira data or manage it
                assert client.get(f"{base}/{project}/jira").status_code == 403
                assert client.get(path + "/jira-work").status_code == 403
                # AI is for staff only: interns can't run the project analysis, attention guidance or progress summaries.
                assert client.post(f"{base}/{project}/brief").status_code == 403
                assert client.post(f"/api/organizations/{org}/attention/{internship}/overdue/explain").status_code == 404
                dates = {"start": "2026-11-01", "end": "2026-11-30"}
                assert client.post(path + "/progress/summary", params=dates).status_code == 404

                actor = hr  # HR sees every internship and its Jira work, read-only
                assert [row["id"] for row in client.get(f"/api/organizations/{org}/internships").json()] == [internship]
                assert client.get(f"{base}/{project}/jira").status_code == 200
                assert client.get(path + "/jira-work").json()["issues"][0]["key"] == "HR-6"
                assert client.get(f"/api/organizations/{org}/jira-overview").json()[0]["to_do"] == 1
                calls = len(fake.prompts)
                assert client.post(f"{base}/{project}/jira/sync").status_code == 200
                assert len(fake.prompts) == calls  # HR's sync never runs the AI analysis
                assert client.post(f"{base}/{project}/brief").status_code == 403
                assert client.post(path + "/jira-work/assign", json={"issue_key": "HR-3"}).status_code == 403
                assert client.put(path + "/jira-account", json={"email": None}).status_code == 403
                assert client.post(base, json={"name": "Not allowed"}).status_code == 403
                assert client.get(path + "/progress", params=dates).status_code == 200
                assert client.put(path + "/progress/report", params=dates, json={"summary": "x"}).status_code == 403
                assert client.post(path + "/plans", json={"title": "x", "goal": "x", "starts_on": "2026-11-23",
                                                          "ends_on": "2026-11-27", "carry": [], "new_tasks": []}).status_code == 403
        finally:
            tx.rollback()
