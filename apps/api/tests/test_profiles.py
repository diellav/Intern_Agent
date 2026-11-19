import os
from datetime import date, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError

from app.main import settings


@pytest.mark.skipif(os.environ.get("INTERNAGENT_DB_TEST") != "1", reason="opt-in PostgreSQL rollback test")
def test_display_names_follow_internship_scope():
    engine = create_engine(settings().migration_database_url)
    mentor, intern, other_mentor, outsider = [uuid4() for _ in range(4)]
    org, other_org, program, internship = [uuid4() for _ in range(4)]
    with engine.connect() as c:
        tx = c.begin()
        try:
            for user in (mentor, intern, other_mentor, outsider):
                c.execute(text("insert into auth.users (id, email) values (:id,:email)"), {"id": user, "email": f"{user}@example.test"})
            for org_id in (org, other_org):
                c.execute(text("insert into app.organizations(id,slug,name) values (:id,:slug,'Profiles')"), {"id": org_id, "slug": str(org_id)})
            for user, role, org_id in [(mentor, "mentor", org), (intern, "intern", org), (other_mentor, "mentor", org), (outsider, "mentor", other_org)]:
                c.execute(text("insert into app.memberships(org_id,user_id,role) values (:org,:id,:role)"), {"org": org_id, "id": user, "role": role})
            c.execute(text("insert into app.programs(id,org_id,name) values (:id,:org,'P')"), {"id": program, "org": org})
            c.execute(text("""insert into app.internships(id,org_id,program_id,mentor_id,intern_id,starts_on,ends_on)
                values (:id,:org,:p,:m,:i,:s,:e)"""), {"id": internship, "org": org, "p": program, "m": mentor, "i": intern,
                                                      "s": date.today(), "e": date.today() + timedelta(days=30)})
            c.execute(text("grant internagent_runtime to postgres with set true"))
            c.execute(text("set local role internagent_runtime"))
            act = lambda user: c.execute(text("select set_config('internagent.actor_id', :a, true)"), {"a": str(user)})

            act(intern)
            c.execute(text("insert into app.profiles (user_id, full_name) values (:id, 'Intern Example')"), {"id": intern})
            with pytest.raises(DBAPIError):  # cannot name someone else
                with c.begin_nested():
                    c.execute(text("insert into app.profiles (user_id, full_name) values (:id, 'Not you')"), {"id": mentor})
            act(mentor)
            c.execute(text("insert into app.profiles (user_id, full_name) values (:id, 'Mentor Example')"), {"id": mentor})
            assert c.execute(text("update app.profiles set full_name='Hijacked' where user_id=:id"), {"id": intern}).rowcount == 0

            people = lambda: c.execute(text("select mentor_name, intern_name from app.internship_people(:org)"), {"org": org}).all()
            assert people() == [("Mentor Example", "Intern Example")]
            act(other_mentor)
            assert people() == []
            act(outsider)
            assert people() == []
            assert c.execute(text("select count(*) from app.profiles")).scalar() == 0  # only one's own row is readable
        finally:
            tx.rollback()
    engine.dispose()
