import os
from contextlib import contextmanager
from datetime import date, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.main import actor_id, app, settings  # import first: app.main wires the routers
from app import workflow
from app.storage import file_storage


class FakeStorage:
    """Simulated Supabase Storage: keeps objects in memory."""
    def __init__(self):
        self.objects = {}

    def put(self, path, data, content_type):
        assert path not in self.objects
        self.objects[path] = (data, content_type)

    def signed_url(self, path, file_name):
        assert path in self.objects
        return f"https://storage.test/signed/{path}?download={file_name}"

    def remove(self, paths):
        for path in paths:
            self.objects.pop(path, None)


@pytest.mark.skipif(os.environ.get("INTERNAGENT_DB_TEST") != "1", reason="opt-in PostgreSQL rollback test")
def test_files_links_versions_and_access(monkeypatch):
    engine = create_engine(settings().migration_database_url)
    mentor, intern, other_mentor, other_intern, outsider = [uuid4() for _ in range(5)]
    org, other_org, program, internship, other_internship, task, other_task = [uuid4() for _ in range(7)]
    actor = intern
    storage = FakeStorage()
    configured = {"value": storage}

    with engine.connect() as connection:
        tx = connection.begin()
        try:
            for user in (mentor, intern, other_mentor, other_intern, outsider):
                connection.execute(text("insert into auth.users (id, email) values (:id,:email)"), {"id": user, "email": f"{user}@example.test"})
            for org_id in (org, other_org):
                connection.execute(text("insert into app.organizations(id,slug,name) values (:id,:slug,'Files verification')"), {"id": org_id, "slug": str(org_id)})
            for user, role, org_id in [(mentor, "mentor", org), (intern, "intern", org), (other_mentor, "mentor", org),
                                       (other_intern, "intern", org), (outsider, "mentor", other_org)]:
                connection.execute(text("insert into app.memberships(org_id,user_id,role) values (:org,:id,:role)"), {"org": org_id, "id": user, "role": role})
            connection.execute(text("insert into app.programs(id,org_id,name) values (:id,:org,'Files')"), {"id": program, "org": org})
            for row, m, i, t in [(internship, mentor, intern, task), (other_internship, other_mentor, other_intern, other_task)]:
                connection.execute(text("""insert into app.internships(id,org_id,program_id,mentor_id,intern_id,starts_on,ends_on)
                    values (:id,:org,:p,:m,:i,:s,:e)"""), {"id": row, "org": org, "p": program, "m": m, "i": i,
                                                          "s": date.today() - timedelta(days=5), "e": date.today() + timedelta(days=30)})
                connection.execute(text("insert into app.tasks(id,internship_id,title,criteria,due_on) values (:id,:p,'Report','Upload a report',:d)"),
                                   {"id": t, "p": row, "d": date.today() + timedelta(days=3)})
            connection.execute(text("grant internagent_runtime to postgres with set true"))
            connection.execute(text("set local role internagent_runtime"))

            @contextmanager
            def scoped(user_id, org_id, admin=False):
                with connection.begin_nested():
                    connection.execute(text("select set_config('internagent.actor_id',:actor,true)"), {"actor": str(user_id)})
                    if connection.execute(text("select role from app.memberships where org_id=:org and user_id=:user"),
                                          {"org": org_id, "user": user_id}).scalar() is None:
                        raise HTTPException(404)
                    yield connection

            from app import ai_control
            monkeypatch.setattr(ai_control, "program_connection", scoped)
            monkeypatch.setattr(workflow, "program_connection", scoped)
            monkeypatch.setitem(app.dependency_overrides, actor_id, lambda: actor)
            monkeypatch.setitem(app.dependency_overrides, file_storage, lambda: configured["value"])
            with TestClient(app) as client:
                base = f"/api/organizations/{org}"
                t = f"{base}/tasks/{task}"
                upload = lambda name, data=b"%PDF-1.4 report": client.post(f"{t}/files", params={"name": name}, content=data,
                                                                            headers={"Content-Type": "application/octet-stream"})

                # Version 1 in the old format: a description only.
                assert client.post(f"{t}/submissions", json={"evidence": "First draft in the old format"}).status_code == 201
                v1 = client.get(f"{t}/submissions").json()[0]
                actor = mentor
                assert client.post(f"{t}/review", json={"submission_id": v1["id"], "decision": "changes_requested", "feedback": "Attach the report."}).status_code == 200

                actor = intern
                assert upload("tool.exe").status_code == 415
                assert upload("big.pdf", b"x" * (10 * 1024 * 1024 + 1)).status_code == 413
                assert upload("empty.pdf", b"").status_code == 422
                staged = upload("../../Report final.PDF")
                assert staged.status_code == 201, staged.text
                report = staged.json()
                assert report["file_name"] == "Report final.PDF" and report["content_type"] == "application/pdf"
                extra = upload("notes.txt", b"temporary").json()
                assert len(storage.objects) == 2
                assert client.delete(f"{t}/files/{extra['id']}").status_code == 200
                assert len(storage.objects) == 1

                # Staged files are private to the uploader, even for the assigned mentor.
                actor = mentor
                assert client.get(f"{base}/files/{report['id']}/url").status_code == 404
                assert upload("mentor.pdf").status_code == 403

                actor = intern
                bad = client.post(f"{t}/submissions", json={"evidence": "x", "links": [{"url": "javascript:alert(1)"}]})
                assert bad.status_code == 422
                assert client.post(f"{t}/submissions", json={"evidence": ""}).status_code == 422
                sent = client.post(f"{t}/submissions", json={
                    "evidence": "Report attached.", "file_ids": [report["id"]],
                    "links": [{"url": "https://github.com/example/pr/1", "title": "Pull request"}, {"url": "http://example.test/demo"}]})
                assert sent.status_code == 201, sent.text
                assert client.delete(f"{t}/files/{report['id']}").status_code == 404  # attached files cannot be discarded

                history = client.get(f"{t}/submissions").json()
                assert [s["version"] for s in history] == [2, 1]
                assert [f["file_name"] for f in history[0]["files"]] == ["Report final.PDF"]
                assert history[0]["links"] == [{"url": "https://github.com/example/pr/1", "title": "Pull request"},
                                               {"url": "http://example.test/demo", "title": ""}]
                assert history[1]["evidence"] == "First draft in the old format" and history[1]["files"] == [] and history[1]["links"] == []

                # Review assistant on version 2: names and hosts only, never file bytes or full URLs.
                import json as jsonlib
                from app.planner import planner_provider

                class FakeAI:
                    model = "simulated"
                    def __init__(self, raw): self.raw, self.messages = raw, None
                    def complete(self, messages, schema):
                        self.messages = messages
                        return self.raw
                good = FakeAI(jsonlib.dumps({"summary": "Report attached with a PR link.", "criteria": [
                    {"criterion": "Upload a report", "status": "unclear", "evidence": "A PDF named Report final is attached."}],
                    "suggested_feedback": "Please confirm the summary page.", "check": ["Open the PDF."], "suggested_decision": None}))
                assist_path = f"{t}/review-assist"
                monkeypatch.setitem(app.dependency_overrides, planner_provider, lambda: good)
                actor = intern
                assert client.post(assist_path, json={"submission_id": history[0]["id"]}).status_code == 403
                actor = mentor
                assisted = client.post(assist_path, json={"submission_id": history[0]["id"]})
                assert assisted.status_code == 200, assisted.text
                assert assisted.json()["criteria"][0]["status"] == "unclear" and assisted.json()["suggested_decision"] is None
                sent_to_model = good.messages[1]["content"]
                assert "Report final.PDF" in sent_to_model and "%PDF" not in sent_to_model
                assert "github.com" in sent_to_model and "/example/pr/1" not in sent_to_model
                assert client.post(assist_path, json={"submission_id": str(uuid4())}).status_code == 404
                monkeypatch.setitem(app.dependency_overrides, planner_provider, lambda: FakeAI("not json"))
                assert client.post(assist_path, json={"submission_id": history[0]["id"]}).status_code == 502
                monkeypatch.setitem(app.dependency_overrides, planner_provider, lambda: None)
                assert client.post(assist_path, json={"submission_id": history[0]["id"]}).status_code == 503

                actor = mentor
                link = client.get(f"{base}/files/{report['id']}/url")
                assert link.status_code == 200 and link.json()["url"].startswith("https://storage.test/signed/")
                assert client.post(f"{t}/review", json={"submission_id": history[0]["id"], "decision": "changes_requested",
                                                        "feedback": "Add the summary page."}).status_code == 200

                for stranger, scope in [(other_mentor, org), (other_intern, org), (outsider, other_org), (outsider, org)]:
                    actor = stranger
                    assert client.get(f"/api/organizations/{scope}/files/{report['id']}/url").status_code == 404

                # Resubmission creates version 3 and keeps version 2's file readable.
                actor = intern
                second = upload("report-v3.pdf").json()
                assert client.post(f"{t}/submissions", json={"evidence": "Summary added.", "file_ids": [second["id"]]}).status_code == 201
                history = client.get(f"{t}/submissions").json()
                assert [(s["version"], [f["file_name"] for f in s["files"]]) for s in history] == [
                    (3, ["report-v3.pdf"]), (2, ["Report final.PDF"]), (1, [])]
                actor = mentor
                assert client.get(f"{base}/files/{report['id']}/url").status_code == 200

                configured["value"] = None
                actor = intern
                assert client.get(f"{base}/uploads/status").json()["configured"] is False
                assert client.get(f"{base}/files/{second['id']}/url").status_code == 503
        finally:
            tx.rollback()
    engine.dispose()
