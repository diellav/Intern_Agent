import os
from contextlib import contextmanager
from datetime import date, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.main import actor_id, app, settings  # import first: app.main wires the routers
from app import planner, workflow


@pytest.mark.skipif(os.environ.get("INTERNAGENT_DB_TEST") != "1", reason="opt-in PostgreSQL rollback test")
def test_note_visibility_search_and_ai_context(monkeypatch):
    engine = create_engine(settings().migration_database_url)
    admin, mentor, intern, other_mentor, other_intern, outsider = [uuid4() for _ in range(6)]
    org, other_org, program, internship, other_internship = [uuid4() for _ in range(5)]
    actor = mentor

    with engine.connect() as connection:
        tx = connection.begin()
        try:
            for user in (admin, mentor, intern, other_mentor, other_intern, outsider):
                connection.execute(text("insert into auth.users (id, email) values (:id,:email)"), {"id": user, "email": f"{user}@example.test"})
            for org_id in (org, other_org):
                connection.execute(text("insert into app.organizations(id,slug,name) values (:id,:slug,'Notes verification')"), {"id": org_id, "slug": str(org_id)})
            for user, role, org_id in [(admin, "admin", org), (mentor, "mentor", org), (intern, "intern", org), (other_mentor, "mentor", org),
                                       (other_intern, "intern", org), (outsider, "mentor", other_org)]:
                connection.execute(text("insert into app.memberships(org_id,user_id,role) values (:org,:id,:role)"), {"org": org_id, "id": user, "role": role})
            connection.execute(text("insert into app.programs(id,org_id,name) values (:id,:org,'Notes')"), {"id": program, "org": org})
            for row, m, i in [(internship, mentor, intern), (other_internship, other_mentor, other_intern)]:
                connection.execute(text("""insert into app.internships(id,org_id,program_id,mentor_id,intern_id,starts_on,ends_on)
                    values (:id,:org,:p,:m,:i,:s,:e)"""), {"id": row, "org": org, "p": program, "m": m, "i": i,
                                                          "s": date.today() - timedelta(days=5), "e": date.today() + timedelta(days=30)})
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

            monkeypatch.setattr(workflow, "program_connection", scoped)
            monkeypatch.setitem(app.dependency_overrides, actor_id, lambda: actor)
            with TestClient(app) as client:
                notes = f"/api/organizations/{org}/internships/{internship}/notes"
                private = client.post(notes, json={"body": "Secret: considering an extension of the internship.", "visibility": "private"})
                assert private.status_code == 201, private.text
                shared = client.post(notes, json={"body": "Great progress on the forms this week.", "visibility": "shared"}).json()
                listed = client.get(notes).json()
                assert {n["visibility"] for n in listed} == {"private", "shared"} and all(n["mine"] for n in listed)
                assert listed[0]["author_email"] == f"{mentor}@example.test"
                assert len(client.get(notes, params={"q": "secret"}).json()) == 1

                actor = intern
                assert [n["body"] for n in client.get(notes).json()] == ["Great progress on the forms this week."]
                assert client.get(notes, params={"q": "secret"}).json() == []
                assert client.post(notes, json={"body": "Intern note"}).status_code == 403
                assert client.put(f"{notes}/{shared['id']}", json={"body": "Edited", "visibility": "shared"}).status_code == 404
                assert client.delete(f"{notes}/{shared['id']}").status_code == 404

                actor = admin
                assert [n["visibility"] for n in client.get(notes).json()] == ["shared"]

                for stranger, scope in [(other_mentor, org), (other_intern, org), (outsider, other_org), (outsider, org)]:
                    actor = stranger
                    assert client.get(f"/api/organizations/{scope}/internships/{internship}/notes").status_code == 404

                actor = other_mentor
                assert client.post(f"/api/organizations/{org}/internships/{internship}/notes", json={"body": "x"}).status_code == 404

                # The AI context only ever contains shared notes.
                with scoped(mentor, org) as c:
                    assert [n["note"] for n in planner.shared_notes(c, internship)] == ["Great progress on the forms this week."]

                actor = mentor
                assert client.put(f"{notes}/{shared['id']}", json={"body": "Great progress on the forms.", "visibility": "private"}).status_code == 200
                actor = intern
                assert client.get(notes).json() == []
                actor = mentor
                assert client.delete(f"{notes}/{shared['id']}").status_code == 200
                assert len(client.get(notes).json()) == 1
        finally:
            tx.rollback()
    engine.dispose()
