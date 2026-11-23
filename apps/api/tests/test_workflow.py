import os
from contextlib import contextmanager
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.main import actor_id, app, settings
from app.core import deps


@pytest.mark.skipif(os.environ.get("INTERNAGENT_DB_TEST") != "1", reason="opt-in PostgreSQL rollback test")
def test_assignment_submission_and_review(monkeypatch):
    engine = create_engine(settings().migration_database_url)
    admin, mentor, intern, outsider = [uuid4() for _ in range(4)]
    org, other_org, program = [uuid4() for _ in range(3)]
    actor = admin

    with engine.connect() as connection:
        tx = connection.begin()
        try:
            for user in (admin, mentor, intern, outsider):
                connection.execute(text("insert into auth.users (id, email) values (:id,:email)"), {"id": user, "email": f"{user}@example.test"})
            for org_id in (org, other_org):
                connection.execute(text("insert into app.organizations(id,slug,name) values (:id,:slug,'Workflow verification')"), {"id": org_id, "slug": str(org_id)})
            for user, role, org_id in [(admin,"admin",org), (mentor,"mentor",org), (intern,"intern",org), (outsider,"mentor",other_org)]:
                connection.execute(text("insert into app.memberships(org_id,user_id,role) values (:org,:id,:role)"), {"org":org_id,"id":user,"role":role})
            connection.execute(text("insert into app.programs(id,org_id,name) values (:id,:org,'Verification')"), {"id":program,"org":org})
            connection.execute(text("grant internagent_runtime to postgres with set true"))
            connection.execute(text("set local role internagent_runtime"))

            @contextmanager
            def scoped(user_id, org_id, admin=False):
                with connection.begin_nested():
                    connection.execute(text("select set_config('internagent.actor_id',:actor,true)"), {"actor":str(user_id)})
                    role = connection.execute(text("select role from app.memberships where org_id=:org and user_id=:user"), {"org":org_id,"user":user_id}).scalar()
                    from fastapi import HTTPException
                    if role is None:
                        raise HTTPException(404)
                    if admin and role != "admin":
                        raise HTTPException(403)
                    yield connection

            monkeypatch.setattr(deps, "program_connection", scoped)
            monkeypatch.setitem(app.dependency_overrides, actor_id, lambda: actor)
            with TestClient(app) as client:
                base = f"/api/organizations/{org}"
                from app import members
                monkeypatch.setattr(members, "program_connection", scoped)
                member_path = base + "/members"
                assert {item["id"] for item in client.get(member_path).json()} == {str(admin), str(mentor), str(intern)}
                actor = mentor
                assert client.get(member_path).status_code == 403
                actor = outsider
                assert client.get(member_path).status_code == 404
                actor = admin
                assert client.post(f"{member_path}/{outsider}/remove").status_code == 404
                assert client.post(f"{member_path}/{admin}/remove").status_code == 409

                roster = client.get(base + "/assignment-members")
                assert roster.status_code == 200
                assert {item["id"] for item in roster.json()} == {str(mentor), str(intern)}

                response = client.post(base + "/internships", json={
                    "program_id": str(program), "mentor_id": str(mentor), "intern_id": str(intern),
                    "starts_on": "2026-11-01", "ends_on": "2026-12-01",
                })
                assert response.status_code == 201, response.text
                internship = response.json()["id"]
                listed = client.get(base + "/internships").json()
                assert listed[0]["mentor_email"] == f"{mentor}@example.test"
                assert listed[0]["intern_email"] == f"{intern}@example.test"
                assert client.get(base + "/internships", params={"program_id": program}).json()[0]["id"] == internship
                assert client.get(base + "/internships", params={"program_id": str(uuid4())}).json() == []
                actor = outsider
                assert client.get(base + "/internships").status_code == 404

                actor = mentor
                path = f"{base}/internships/{internship}/tasks"
                response = client.post(path, json={"title":"React form","criteria":"Validate required fields","due_on":"2026-11-10"})
                assert response.status_code == 201, response.text
                existing_task = response.json()["id"]
                task_path = f"{base}/tasks/{existing_task}"
                from app import question_assist
                monkeypatch.setattr(question_assist, "program_connection", scoped)
                question_path = task_path + "/questions"
                actor = intern
                question = client.post(question_path, json={"title": "Validate required fields", "body": "Which fields must I validate?"})
                assert question.status_code == 201, question.text
                question_id = question.json()["id"]
                answers_path = base + f"/questions/{question_id}/answers"
                actor = mentor
                answer = client.post(answers_path, json={"body": "Validate the name field."})
                assert answer.status_code == 201, answer.text
                answer_id = answer.json()["id"]
                assert client.post(answers_path + f"/{answer_id}/verify").status_code == 200
                source_path = question_path + f"/sources/answer/{answer_id}"
                assert client.get(source_path).json()["body"] == "Validate the name field."
                actor = outsider
                assert client.get(question_path).status_code == 404
                assert client.get(answers_path).status_code == 404
                assert client.get(source_path).status_code == 404
                actor = mentor
                plan_path = f"{base}/internships/{internship}/plans"
                draft = {
                    "title": "API practice", "goal": "Handle failed responses",
                    "starts_on": "2026-11-01", "ends_on": "2026-11-15",
                    "carry": [existing_task], "new_tasks": [],
                }
                invalid = {**draft, "new_tasks": [{"title": "New task", "criteria": "Show an error", "due_on": "2026-11-20"}]}
                assert client.post(plan_path, json=invalid).status_code == 422
                created = client.post(plan_path, json=draft)
                assert created.status_code == 201, created.text
                plan = created.json()
                actor = intern
                assert client.get(plan_path).json() == []
                actor = outsider
                assert client.get(plan_path).status_code == 404
                actor = mentor
                publish = f'{plan_path}/{plan["id"]}/publish'
                assert client.post(publish, json={"revision": 2}).status_code == 409
                accepted = client.post(publish, json={"revision": 1})
                assert accepted.status_code == 200, accepted.text
                assert accepted.json()["task_ids"] == [existing_task]
                assert client.post(publish, json={"revision": 1}).json() == accepted.json()
                assert len(client.get(path).json()) == 1
                actor = intern
                assert client.get(plan_path).json()[0]["id"] == plan["id"]

                actor = intern
                response = client.post(task_path + "/submissions", json={"evidence":"First version"})
                assert response.status_code == 201, response.text
                first = response.json()["id"]
                assert client.post(task_path + "/submissions", json={"evidence":"Duplicate"}).status_code == 409
                actor = mentor
                queue = client.get(base + "/overview").json()
                assert queue["role"] == "mentor" and queue["counts"]["submitted"] == 1
                assert queue["items"][0]["task_id"] == existing_task and queue["items"][0]["waiting_on"] == "mentor"
                assert queue["items"][0]["intern_email"] == f"{intern}@example.test"
                assert queue["items"][0]["project"] is None
                actor = outsider
                assert client.get(base + "/overview").status_code == 404
                actor = mentor
                response = client.post(task_path + "/review", json={"submission_id": first, "decision":"changes_requested","feedback":"Add an error state."})
                assert response.status_code == 200, response.text
                actor = intern
                response = client.post(task_path + "/submissions", json={"evidence":"Second version"})
                assert response.status_code == 201, response.text
                second = response.json()["id"]
                actor = mentor
                assert client.post(task_path + "/review", json={"submission_id": first, "decision":"completed","feedback":"Approved."}).status_code == 409
                response = client.post(task_path + "/review", json={"submission_id": second, "decision":"completed","feedback":"Approved."})
                assert response.status_code == 200, response.text
                assert client.get(path).json()[0]["status"] == "completed"
                assert [item["version"] for item in client.get(task_path + "/submissions").json()] == [2, 1]
                inbox = base + "/notifications"
                mentor_notices = client.get(inbox).json()
                assert [item["event"] for item in mentor_notices] == ["submitted", "submitted"]
                mentor_notice = mentor_notices[0]["id"]
                actor = intern
                intern_notices = client.get(inbox).json()
                # Publishing drops the 'assigned' notices raised in the same transaction; here that includes the setup task.
                assert {item["event"] for item in intern_notices} == {"changes_requested", "completed", "plan_published"}
                assert client.post(f"{inbox}/{mentor_notice}/read").status_code == 404
                read_path = f'{inbox}/{intern_notices[0]["id"]}/read'
                first_read = client.post(read_path)
                assert first_read.status_code == 200
                assert client.post(read_path).json() == first_read.json()
                unread = client.get(inbox, params={"unread": "true"}).json()
                assert intern_notices[0]["id"] not in {item["id"] for item in unread}
                assert client.get(inbox + "/unread-count").json() == {"unread": len(unread)}
                questions = base + "/questions"
                created = client.post(questions, json={"title":"Why CORS blocks React","body":"An API call fails."})
                assert created.status_code == 201, created.text
                question = created.json()["id"]
                assert len(client.get(questions, params={"q":"CORS"}).json()) == 1
                assert client.get(questions, params={"q":"unrelated"}).json() == []
                thread = f"{questions}/{question}/answers"
                posted = client.post(thread, json={"body":"Allow the frontend origin in your API."})
                assert posted.status_code == 201, posted.text
                verify = f'{thread}/{posted.json()["id"]}/verify'
                assert client.post(verify).status_code == 403
                actor = mentor
                assert client.post(verify).status_code == 200
                assert client.get(questions).json()[0]["verified"] is True
                actor = outsider
                assert client.get(thread).status_code == 404
        finally:
            tx.rollback()
    engine.dispose()




@pytest.mark.skipif(os.environ.get("INTERNAGENT_DB_TEST") != "1", reason="opt-in PostgreSQL rollback test")
def test_ai_draft_edit_publish_flow(monkeypatch):
    import json as jsonlib
    from datetime import date, timedelta
    from app.core.ai_provider import planner_provider

    engine = create_engine(settings().migration_database_url)
    mentor, other_mentor, intern, other_intern, outsider = [uuid4() for _ in range(5)]
    org, other_org, program = uuid4(), uuid4(), uuid4()
    internship, other_internship, open_task, foreign_task = [uuid4() for _ in range(4)]
    start = date.today() - timedelta(days=3)
    end = date.today() + timedelta(days=40)
    actor = mentor

    class Fake:
        model = "fake-model"
        def __init__(self): self.messages = None
        def complete(self, messages, schema):
            self.messages = messages
            return jsonlib.dumps({
                "title": "Next week", "goal": "Finish validation and cover it with tests.",
                "carry": [{"task_ref": "T1", "reason": "Changes were requested."},
                          {"task_ref": str(foreign_task), "reason": "Not in this internship."}],
                "new_tasks": [{"title": "Add validation tests", "criteria": "Cover required fields.",
                               "due_on": (date.today() + timedelta(days=5)).isoformat(),
                               "reason": "Follows the review.", "evidence_refs": ["T1"]}],
            })

    with engine.connect() as connection:
        tx = connection.begin()
        try:
            for user in (mentor, other_mentor, intern, other_intern, outsider):
                connection.execute(text("insert into auth.users (id, email) values (:id,:email)"), {"id": user, "email": f"{user}@example.test"})
            for org_id in (org, other_org):
                connection.execute(text("insert into app.organizations(id,slug,name) values (:id,:slug,'Planner verification')"), {"id": org_id, "slug": str(org_id)})
            for user, role, org_id in [(mentor,"mentor",org), (other_mentor,"mentor",org), (intern,"intern",org), (other_intern,"intern",org), (outsider,"mentor",other_org)]:
                connection.execute(text("insert into app.memberships(org_id,user_id,role) values (:org,:id,:role)"), {"org":org_id,"id":user,"role":role})
            connection.execute(text("insert into app.programs(id,org_id,name) values (:id,:org,'Planner')"), {"id":program,"org":org})
            for row_id, m, i in [(internship, mentor, intern), (other_internship, other_mentor, other_intern)]:
                connection.execute(text("""insert into app.internships(id,org_id,program_id,mentor_id,intern_id,starts_on,ends_on)
                    values (:id,:org,:program,:m,:i,:s,:e)"""), {"id":row_id,"org":org,"program":program,"m":m,"i":i,"s":start,"e":end})
            for task_id, parent, title in [(open_task, internship, "Validate the form"), (foreign_task, other_internship, "Secret other task")]:
                connection.execute(text("""insert into app.tasks(id,internship_id,title,criteria,due_on,status)
                    values (:id,:p,:t,'Required fields show errors.',:d,'changes_requested')"""), {"id":task_id,"p":parent,"t":title,"d":date.today()})
            connection.execute(text("grant internagent_runtime to postgres with set true"))
            connection.execute(text("set local role internagent_runtime"))

            @contextmanager
            def scoped(user_id, org_id, admin=False):
                with connection.begin_nested():
                    connection.execute(text("select set_config('internagent.actor_id',:actor,true)"), {"actor":str(user_id)})
                    role = connection.execute(text("select role from app.memberships where org_id=:org and user_id=:user"), {"org":org_id,"user":user_id}).scalar()
                    from fastapi import HTTPException
                    if role is None:
                        raise HTTPException(404)
                    yield connection

            from app import ai_control, cv, progress, question_assist
            from io import BytesIO
            from zipfile import ZipFile

            for module in (ai_control, cv, progress, question_assist):
                monkeypatch.setattr(module, "program_connection", scoped)
            monkeypatch.setattr(settings(), "ai_requests_per_hour", 1)
            fake = Fake()
            provider = {"value": None}
            monkeypatch.setattr(deps, "program_connection", scoped)
            monkeypatch.setitem(app.dependency_overrides, actor_id, lambda: actor)
            monkeypatch.setitem(app.dependency_overrides, planner_provider, lambda: provider["value"])
            with TestClient(app) as client:
                base = f"/api/organizations/{org}"
                plans = f"{base}/internships/{internship}/plans"
                request = {"starts_on": date.today().isoformat(), "ends_on": (date.today() + timedelta(days=6)).isoformat(),
                           "goal": "Finish form validation", "availability": "10 hours"}

                assert client.post(plans + "/generate", json=request).status_code == 503  # no key configured
                provider["value"] = fake
                actor = other_mentor  # not assigned: the internship is invisible under row-level security
                assert client.post(plans + "/generate", json=request).status_code == 404
                actor = intern
                assert client.post(plans + "/generate", json=request).status_code == 403
                actor = outsider
                assert client.post(f"/api/organizations/{other_org}/internships/{internship}/plans/generate", json=request).status_code == 404
                actor = mentor
                too_long = {**request, "ends_on": (end + timedelta(days=1)).isoformat()}
                assert client.post(plans + "/generate", json=too_long).status_code == 422

                generated = client.post(plans + "/generate", json=request)
                assert generated.status_code == 200, generated.text
                usage_id = generated.headers["X-AI-Usage-ID"]
                vote_path = f"{base}/ai/usage/{usage_id}/vote"
                assert client.put(vote_path, json={"value": 1}).json() == {"vote": 1}
                assert client.put(vote_path, json={"value": -1}).json() == {"vote": -1}
                limited = client.post(plans + "/generate", json=request)
                assert limited.status_code == 429, limited.text
                assert int(limited.headers["Retry-After"]) > 0
                actor = other_mentor
                assert client.put(vote_path, json={"value": 1}).status_code == 404
                actor = mentor
                body = generated.json()
                context = fake.messages[1]["content"]
                assert "Validate the form" in context and "Secret other task" not in context and str(foreign_task) not in context
                assert body["draft"]["carry"] == [str(open_task)]
                assert body["warnings"] and body["notes"]["carry"][str(open_task)]["reason"] == "Changes were requested."
                assert body["workload"]["unknown_count"] == 2

                draft = body["draft"]
                draft["new_tasks"][0]["title"] = "Add validation tests for the contact form"
                saved = client.post(plans, json=draft)
                assert saved.status_code == 201, saved.text
                plan = saved.json()
                publish = f'{plans}/{plan["id"]}/publish'
                published = client.post(publish, json={"revision": plan["revision"]})
                assert published.status_code == 200, published.text
                assert client.post(publish, json={"revision": plan["revision"]}).json() == published.json()
                question_path = f"{base}/tasks/{open_task}/questions"
                question = client.post(question_path, json={"title": "Practice question", "body": "What can I use?"})
                assert question.status_code == 201, question.text
                actor = other_mentor
                assert client.get(question_path).status_code == 404
                assert client.get(base + "/questions/" + question.json()["id"] + "/answers").status_code == 404

                actor = mentor
                question_id = question.json()["id"]
                notes = f"{base}/internships/{internship}/notes"
                shared = client.post(notes, json={"body": "Practice question: use accessible form labels.", "visibility": "shared"})
                private = client.post(notes, json={"body": "Practice question: excluded private detail.", "visibility": "private"})
                assert shared.status_code == private.status_code == 201
                monkeypatch.setattr(settings(), "ai_requests_per_hour", 5)

                class QaFake:
                    model = "fake-qa"
                    def complete(self, messages, schema):
                        assert "use accessible form labels" in messages[1]["content"]
                        assert "excluded private detail" not in messages[1]["content"]
                        return jsonlib.dumps({"parts": [{"body": "Use accessible form labels.", "sources": [0]}]})

                provider["value"] = QaFake()
                suggested = client.post(question_path + f"/{question_id}/suggest")
                assert suggested.status_code == 200, suggested.text
                assert suggested.json()["parts"][0]["sources"][0]["id"] == shared.json()["id"]
                assert client.get(question_path + "/sources/note/" + shared.json()["id"]).status_code == 200
                assert client.get(question_path + "/sources/note/" + private.json()["id"]).status_code == 404

                report_path = f"{base}/internships/{internship}/progress"
                dates = {"start": start.isoformat(), "end": end.isoformat()}
                assert client.put(report_path + "/report", params=dates, json={"summary": "A draft"}).status_code == 200
                # A summary source must exist in the evidence saved with the report.
                stale = {"summary": "A draft", "findings": [{"statement": "Done", "sources": [{"task_id": str(uuid4()), "version": 1, "kind": "completed"}]}]}
                assert client.put(report_path + "/report", params=dates, json=stale).status_code == 409
                actor = intern
                assert client.get(report_path + "/reports").json() == []
                actor = other_mentor
                assert client.get(report_path, params=dates).status_code == 404
                actor = mentor
                assert client.put(report_path + "/report", params=dates, json={"summary": "Shared progress", "share": True}).status_code == 200
                actor = intern
                shared_report = client.get(report_path + "/reports").json()[0]
                assert shared_report["summary"] == "Shared progress" and shared_report["findings"] == []
                assert shared_report["snapshot"]["start"] == dates["start"]  # numbers saved with the shared report
                actor = other_mentor
                cv_path = f"{base}/internships/{internship}/cv"
                assert client.get(cv_path).status_code == 404
                actor = mentor  # the assigned mentor uploads and analyses the CV
                assert client.post(cv_path + "/analyze").status_code == 422
                document = BytesIO()
                with ZipFile(document, "w") as archive:
                    archive.writestr("word/document.xml", """<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
                        <w:p><w:r><w:t>Sample Intern</w:t></w:r></w:p>
                        <w:p><w:r><w:t>fictional@example.test</w:t></w:r></w:p>
                        <w:p><w:r><w:t>Built accessible React forms and wrote automated validation tests.</w:t></w:r></w:p>
                        </w:document>""")
                mime = {"Content-Type": cv.DOCX}
                assert client.put(cv_path, content=document.getvalue(), headers=mime).status_code == 422
                invalid = client.put(cv_path + "?consent=true", content=b"invalid", headers=mime)
                assert invalid.status_code == 422
                uploaded = client.put(cv_path + "?consent=true", content=document.getvalue(), headers=mime)
                assert uploaded.status_code == 200, uploaded.text

                class CvFake:
                    model = "fake-cv"
                    def complete(self, messages, schema):
                        assert "fictional@example.test" not in messages[1]["content"]
                        assert "React forms" in messages[1]["content"]
                        return jsonlib.dumps({"skills": ["React forms"], "program_ids": [str(program)],
                            "mentor_questions": ["What should the first exercise cover?"],
                            "title": "React practice", "goal": "Build and test an accessible form.",
                            "starter_tasks": [{"title": "Build a form", "criteria": "Validate required fields", "day": 1}]})

                provider["value"] = CvFake()
                analysis = client.post(cv_path + "/analyze")
                assert analysis.status_code == 200, analysis.text
                assert analysis.json()["program_names"] == ["Planner"]
                actor = intern  # interns can't read, upload or delete the CV
                assert client.get(cv_path).status_code == 403
                assert client.delete(cv_path).status_code == 403
                actor = mentor
                assert client.get(cv_path).json()["analysis"]["title"] == "React practice"
                assert client.delete(cv_path).status_code == 200
                assert client.get(cv_path).json()["analysis"] is None
                actor = mentor
                titles = sorted(task["title"] for task in client.get(f"{base}/internships/{internship}/tasks").json())
                assert titles == ["Add validation tests for the contact form", "Validate the form"]

                actor = intern
                visible = client.get(plans).json()
                assert [item["id"] for item in visible] == [plan["id"]] and visible[0]["published_at"]
                notices = client.get(f"{base}/notifications").json()
                # One notice for the published plan instead of one per task. The setup task shares this test's single
                # transaction, so its 'assigned' notice is dropped too; in production it was sent earlier and stays.
                assert {(n["event"], n["title"]) for n in notices} == {("plan_published", "Next week")}

                # A plan that only carries existing work still notifies the intern, once.
                actor = mentor
                carry_only = client.post(plans, json={"title": "Carry only", "goal": "Finish what is open.",
                    "starts_on": request["starts_on"], "ends_on": request["ends_on"], "carry": [str(open_task)], "new_tasks": []})
                assert carry_only.status_code == 201, carry_only.text
                second = f'{plans}/{carry_only.json()["id"]}/publish'
                assert client.post(second, json={"revision": 1}).status_code == 200
                assert client.post(second, json={"revision": 1}).status_code == 200
                actor = intern
                published = [n for n in client.get(f"{base}/notifications").json() if n["event"] == "plan_published"]
                assert sorted(n["title"] for n in published) == ["Carry only", "Next week"]
                assert all(n["plan_id"] and n["task_id"] is None for n in published)
                assert client.get(f"{base}/notifications/unread-count").json()["unread"] == 2  # the two plan notices
        finally:
            tx.rollback()
    engine.dispose()



@pytest.mark.skipif(os.environ.get("INTERNAGENT_DB_TEST") != "1", reason="opt-in PostgreSQL rollback test")
def test_member_role_changes_and_invite(monkeypatch):
    from fastapi import HTTPException
    from app import members

    engine = create_engine(settings().migration_database_url)
    admin, mentor, other_admin, existing = [uuid4() for _ in range(4)]
    org, other_org = uuid4(), uuid4()
    current = {"actor": admin}

    with engine.connect() as connection:
        tx = connection.begin()
        try:
            for user in (admin, mentor, other_admin, existing):
                connection.execute(text("insert into auth.users (id, email) values (:id,:email)"), {"id": user, "email": f"{user}@example.test"})
            for org_id in (org, other_org):
                connection.execute(text("insert into app.organizations(id,slug,name) values (:id,:slug,'Role verification')"), {"id": org_id, "slug": str(org_id)})
            for user, role, org_id in [(admin, "admin", org), (mentor, "mentor", org), (other_admin, "admin", other_org)]:
                connection.execute(text("insert into app.memberships(org_id,user_id,role) values (:org,:id,:role)"), {"org": org_id, "id": user, "role": role})
            connection.execute(text("grant internagent_runtime to postgres with set true"))
            connection.execute(text("set local role internagent_runtime"))

            @contextmanager
            def scoped(user_id, org_id, admin=False):
                with connection.begin_nested():
                    connection.execute(text("select set_config('internagent.actor_id',:actor,true)"), {"actor": str(user_id)})
                    role = connection.execute(text("select role from app.memberships where org_id=:org and user_id=:user and active"), {"org": org_id, "user": user_id}).scalar()
                    if role is None:
                        raise HTTPException(404)
                    if admin and role != "admin":
                        raise HTTPException(403)
                    yield connection

            def no_email(email):
                raise AssertionError("Supabase invite must not be called for an existing account")

            monkeypatch.setattr(members, "program_connection", scoped)
            monkeypatch.setattr(members, "send_invite", no_email)
            monkeypatch.setitem(app.dependency_overrides, actor_id, lambda: current["actor"])
            with TestClient(app) as client:
                path = f"/api/organizations/{org}/members"
                role_of = lambda user: {m["id"]: m["role"] for m in client.get(path).json()}[str(user)]

                response = client.put(f"{path}/{mentor}/role", json={"role": "intern"})
                assert response.status_code == 200, response.text
                assert role_of(mentor) == "intern"

                assert client.put(f"{path}/{admin}/role", json={"role": "mentor"}).status_code == 409
                # The SQL guard refuses self-change and last-admin demotion even when called directly.
                for person in (admin,):
                    with pytest.raises(Exception) as caught:
                        with scoped(admin, org, admin=True) as c:
                            c.execute(text("select app.set_member_role(:org,:person,'mentor')"), {"org": org, "person": person})
                    assert getattr(caught.value.orig, "sqlstate", None) == "42501"

                # Promote the intern, demote them back: allowed while another admin remains.
                assert client.put(f"{path}/{mentor}/role", json={"role": "admin"}).status_code == 200
                assert client.put(f"{path}/{mentor}/role", json={"role": "intern"}).status_code == 200
                # Make mentor the only other admin, then remove the original admin's admin role via mentor,
                # and check the last remaining admin cannot be demoted.
                assert client.put(f"{path}/{mentor}/role", json={"role": "admin"}).status_code == 200
                current["actor"] = mentor
                assert client.put(f"{path}/{admin}/role", json={"role": "mentor"}).status_code == 200
                current["actor"] = admin
                assert client.put(f"{path}/{mentor}/role", json={"role": "intern"}).status_code == 403
                current["actor"] = mentor
                assert client.put(f"{path}/{mentor}/role", json={"role": "intern"}).status_code == 409
                with pytest.raises(Exception) as caught:
                    with scoped(mentor, org, admin=True) as c:
                        c.execute(text("select set_config('internagent.actor_id',:a,true)"), {"a": str(admin)})
                        c.execute(text("select app.set_member_role(:org,:person,'intern')"), {"org": org, "person": mentor})
                assert getattr(caught.value.orig, "sqlstate", None) == "42501"
                assert role_of(mentor) == "admin"

                # Admin of org B cannot touch org A.
                current["actor"] = other_admin
                assert client.put(f"{path}/{admin}/role", json={"role": "admin"}).status_code in (403, 404)
                assert client.get(path).status_code in (403, 404)

                # Existing account is added without an email and reported as not invited.
                current["actor"] = mentor
                response = client.post(path, json={"email": f"{existing}@example.test", "full_name": "Existing Person", "role": "intern"})
                assert response.status_code == 200, response.text
                assert response.json()["invited"] is False
                named = {m["id"]: m["full_name"] for m in client.get(path).json()}
                assert named[str(existing)] == "Existing Person"
        finally:
            tx.rollback()


@pytest.mark.skipif(os.environ.get("INTERNAGENT_DB_TEST") != "1", reason="opt-in PostgreSQL rollback test")
def test_attention_signals_and_question_sources(monkeypatch):
    import json as jsonlib
    from datetime import date, timedelta
    from app import ai_control, attention, question_assist
    from app.core.ai_provider import planner_provider

    engine = create_engine(settings().migration_database_url)
    mentor, intern, quiet_intern, other_mentor, other_intern = [uuid4() for _ in range(5)]
    org, program = uuid4(), uuid4()
    busy, quiet, other = uuid4(), uuid4(), uuid4()
    overdue_planned, overdue_returned, overdue_submitted, returned_twice, other_task = [uuid4() for _ in range(5)]
    today = date.today()

    with engine.connect() as connection:
        tx = connection.begin()
        try:
            for user in (mentor, intern, quiet_intern, other_mentor, other_intern):
                connection.execute(text("insert into auth.users (id, email) values (:id,:email)"), {"id": user, "email": f"{user}@example.test"})
            connection.execute(text("insert into app.organizations(id,slug,name) values (:id,:slug,'Attention verification')"), {"id": org, "slug": str(org)})
            for user, role in [(mentor, "mentor"), (other_mentor, "mentor"), (intern, "intern"), (quiet_intern, "intern"), (other_intern, "intern")]:
                connection.execute(text("insert into app.memberships(org_id,user_id,role) values (:org,:id,:role)"), {"org": org, "id": user, "role": role})
            connection.execute(text("insert into app.profiles(user_id,full_name) values (:id,'Ada Intern')"), {"id": intern})
            connection.execute(text("insert into app.programs(id,org_id,name) values (:id,:org,'Attention')"), {"id": program, "org": org})
            for row_id, m, i, started in [(busy, mentor, intern, 10), (quiet, mentor, quiet_intern, 6), (other, other_mentor, other_intern, 10)]:
                connection.execute(text("""insert into app.internships(id,org_id,program_id,mentor_id,intern_id,starts_on,ends_on)
                    values (:id,:org,:program,:m,:i,:s,:e)"""), {"id": row_id, "org": org, "program": program, "m": m, "i": i,
                    "s": today - timedelta(days=started), "e": today + timedelta(days=30)})
            for task_id, parent, status, due in [(overdue_planned, busy, "planned", -2), (overdue_returned, busy, "changes_requested", -1),
                                                 (overdue_submitted, busy, "submitted", -3), (returned_twice, busy, "changes_requested", 5),
                                                 (other_task, other, "planned", 5)]:
                connection.execute(text("""insert into app.tasks(id,internship_id,title,criteria,due_on,status)
                    values (:id,:p,:t,'Criteria.',:d,:s)"""), {"id": task_id, "p": parent, "t": f"Task {status} {due}",
                    "d": today + timedelta(days=due), "s": status})
            for version in (1, 2):
                connection.execute(text("""insert into app.submissions(task_id,version,evidence,submitted_at,decision,feedback,reviewed_at)
                    values (:task,:v,'Evidence',now() - interval '7 days','changes_requested','Please revise.',now() - interval '7 days')"""),
                    {"task": returned_twice, "v": version})
            # Verified answers: one org-wide (in scope), one on another internship's task (out of scope).
            answers = {}
            for key, task_id, title in [("org", None, "Resubmitting after feedback"), ("other", other_task, "Resubmit flow")]:
                question = connection.execute(text("""insert into app.questions(org_id,author_id,title,body,task_id)
                    values (:org,:author,:title,'How should interns resubmit?',:task) returning id"""),
                    {"org": org, "author": mentor, "title": title, "task": task_id}).scalar_one()
                answers[key] = str(connection.execute(text("""insert into app.answers(org_id,question_id,author_id,body,verified_at,verified_by)
                    values (:org,:q,:m,:body,now(),:m) returning id"""),
                    {"org": org, "q": question, "m": mentor, "body": f"Upload a new version of your work ({key})."}).scalar_one())
            connection.execute(text("grant internagent_runtime to postgres with set true"))
            connection.execute(text("set local role internagent_runtime"))

            @contextmanager
            def scoped(user_id, org_id, admin=False):
                with connection.begin_nested():
                    connection.execute(text("select set_config('internagent.actor_id',:actor,true)"), {"actor": str(user_id)})
                    yield connection

            for module in (ai_control, attention, question_assist, deps):
                monkeypatch.setattr(module, "program_connection", scoped)
            monkeypatch.setattr(settings(), "ai_requests_per_hour", 10)

            class Fake:
                model = "fake"
                def __init__(self, reply): self.reply, self.messages = reply, None
                def complete(self, messages, schema):
                    self.messages = messages
                    return jsonlib.dumps(self.reply)

            provider = {"value": None}
            monkeypatch.setitem(app.dependency_overrides, actor_id, lambda: mentor)
            monkeypatch.setitem(app.dependency_overrides, planner_provider, lambda: provider["value"])
            with TestClient(app) as client:
                base = f"/api/organizations/{org}"
                found = {(s["internship_id"], s["kind"]): s for s in client.get(base + "/attention").json()}
                assert {i for i, _ in found} == {str(busy), str(quiet)}
                overdue = found[(str(busy), "overdue")]
                # A submitted task waits on the mentor, so only the planned and returned ones count.
                assert overdue["count"] == 2 and str(overdue_submitted) not in {e["task_id"] for e in overdue["evidence"]}
                assert overdue["intern_name"] == "Ada Intern"
                assert found[(str(busy), "returns")]["count"] == 1
                busy_idle = found[(str(busy), "inactivity")]
                assert busy_idle["count"] == 7 and busy_idle["has_submission"] is True
                silent = found[(str(quiet), "inactivity")]
                assert silent["count"] == 6 and silent["has_submission"] is False
                assert silent["intern_name"] is None and silent["intern_email"] == f"{quiet_intern}@example.test"

                provider["value"] = Fake({"next_step": "Check in about the overdue tasks."})
                assert client.post(f"{base}/attention/{busy}/overdue/explain").status_code == 200
                sent = provider["value"].messages[1]["content"]
                assert "Ada Intern" not in sent and str(intern) not in sent

                question_path = f"{base}/tasks/{overdue_planned}/questions"
                asked = client.post(question_path, json={"title": "How do I resubmit my work?", "body": "I got feedback."})
                assert asked.status_code == 201, asked.text
                provider["value"] = Fake({"parts": [{"body": "Upload a new version.", "sources": [0]}]})
                suggested = client.post(f"{question_path}/{asked.json()['id']}/suggest")
                assert suggested.status_code == 200, suggested.text
                assert [s["id"] for s in suggested.json()["parts"][0]["sources"]] == [answers["org"]]
                assert "(other)" not in provider["value"].messages[1]["content"]
        finally:
            tx.rollback()


@pytest.mark.skipif(os.environ.get("INTERNAGENT_DB_TEST") != "1", reason="opt-in PostgreSQL rollback test")
def test_plan_publish_single_tasks_and_closing(monkeypatch):
    engine = create_engine(settings().migration_database_url)
    admin, mentor, intern = [uuid4() for _ in range(3)]
    org, program = uuid4(), uuid4()
    actor = admin
    with engine.connect() as connection:
        tx = connection.begin()
        try:
            for user in (admin, mentor, intern):
                connection.execute(text("insert into auth.users (id, email) values (:id,:email)"), {"id": user, "email": f"{user}@example.test"})
            connection.execute(text("insert into app.organizations(id,slug,name) values (:id,:slug,'Flow verification')"), {"id": org, "slug": str(org)})
            for user, role in [(admin, "admin"), (mentor, "mentor"), (intern, "intern")]:
                connection.execute(text("insert into app.memberships(org_id,user_id,role) values (:org,:id,:role)"), {"org": org, "id": user, "role": role})
            connection.execute(text("insert into app.programs(id,org_id,name) values (:id,:org,'Verification')"), {"id": program, "org": org})
            connection.execute(text("grant internagent_runtime to postgres with set true"))
            connection.execute(text("set local role internagent_runtime"))

            @contextmanager
            def scoped(user_id, org_id, admin=False):
                with connection.begin_nested():
                    connection.execute(text("select set_config('internagent.actor_id',:actor,true)"), {"actor": str(user_id)})
                    yield connection

            monkeypatch.setattr(deps, "program_connection", scoped)
            monkeypatch.setitem(app.dependency_overrides, actor_id, lambda: actor)
            with TestClient(app) as client:
                base = f"/api/organizations/{org}"
                internship = client.post(base + "/internships", json={
                    "program_id": str(program), "mentor_id": str(mentor), "intern_id": str(intern),
                    "starts_on": "2026-11-01", "ends_on": "2026-12-01"}).json()["id"]
                tasks_path = f"{base}/internships/{internship}/tasks"
                task = lambda title, due: {"title": title, "criteria": "Done when reviewed.", "due_on": due}  # noqa: E731

                actor = mentor
                early = client.post(tasks_path, json=task("Early work", "2026-11-03")).json()
                assert early["plan"] is None  # no published plan yet
                plans_path = f"{base}/internships/{internship}/plans"
                plan = client.post(plans_path, json={"title": "Week two", "goal": "Forms.", "starts_on": "2026-11-10",
                                                     "ends_on": "2026-11-20", "carry": [early["id"]],
                                                     "new_tasks": [task("Form", "2026-11-15"), task("Tests", "2026-11-18")]}).json()
                published = client.post(f"{plans_path}/{plan['id']}/publish", json={"revision": 1}).json()
                new_ids = set(published["task_ids"]) - {early["id"]}

                actor = intern
                notices = client.get(base + "/notifications").json()
                assert [n["event"] for n in notices].count("plan_published") == 1
                assert not [n for n in notices if n["event"] == "assigned" and n["task_id"] in new_ids]
                due = {t["id"]: t["due_on"] for t in client.get(tasks_path).json()}
                assert due[early["id"]] == "2026-11-20"  # overdue carried work moved to the plan's end

                actor = mentor
                single = client.post(tasks_path, json=task("Extra", "2026-11-12")).json()
                assert single["plan"]["id"] == plan["id"]
                assert single["id"] in client.get(plans_path).json()[0]["task_ids"]

                actor = intern
                question = client.post(f"{base}/tasks/{single['id']}/questions", json={"title": "Scope?", "body": "Which form?"})
                assert question.status_code == 201
                assert client.get(base + "/questions").json()[0]["task_id"] == single["id"]
                closed_path = f"{base}/internships/{internship}/closed"
                assert client.put(closed_path, json={"closed": True}).status_code == 403

                actor = mentor
                assert client.put(closed_path, json={"closed": True}).json()["closed_at"]
                assert client.get(base + "/overview").json()["counts"]["open"] == 0
                assert client.post(tasks_path, json=task("Late", "2026-11-25")).status_code == 409
                actor = intern
                submit = client.post(f"{base}/tasks/{single['id']}/submissions", json={"evidence": "Done."})
                assert submit.status_code == 409
                actor = admin
                assert client.put(closed_path, json={"closed": False}).json()["closed_at"] is None
                actor = intern
                assert client.post(f"{base}/tasks/{single['id']}/submissions", json={"evidence": "Done."}).status_code == 201
        finally:
            tx.rollback()
