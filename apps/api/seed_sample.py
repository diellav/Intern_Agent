from datetime import date, timedelta
from uuid import UUID, uuid5

from dotenv import dotenv_values
from sqlalchemy import create_engine, text

NAMESPACE = UUID("ee0835ea-a002-42e8-a5eb-dd55e2fd2196")
ORG = uuid5(NAMESPACE, "org")


def seed(connection, admin):
    def run(sql, **values):
        return connection.execute(text(sql), {"org": ORG, **values})

    run("insert into app.organizations(id,slug,name) values (:org,'internagent-sample','InternAgent Sample Workspace') on conflict (id) do nothing")
    run("insert into app.memberships(org_id,user_id,role) values (:org,:admin,'admin') on conflict do nothing", admin=admin)
    today = date.today()
    for group, name in enumerate(("Frontend Engineering", "Product Design", "Quality Assurance")):
        program = uuid5(NAMESPACE, f"program/{group}")
        mentor = uuid5(NAMESPACE, f"mentor/{group}")
        run("insert into app.programs(id,org_id,name,description) values (:id,:org,:name,'Synthetic practice program') on conflict do nothing", id=program, name=name)
        for index, role in [(-1, "mentor"), (0, "intern"), (1, "intern"), (2, "intern")]:
            user = mentor if index == -1 else uuid5(NAMESPACE, f"intern/{group}/{index}")
            run("insert into auth.users(id,email) values (:id,:email) on conflict (id) do nothing", id=user, email=f"internagent-{group}-{role}-{index}@example.test")
            run("insert into app.memberships(org_id,user_id,role) values (:org,:id,:role) on conflict do nothing", id=user, role=role)
            if role == "mentor":
                continue
            internship = uuid5(NAMESPACE, f"internship/{group}/{index}")
            run("""insert into app.internships(id,org_id,program_id,mentor_id,intern_id,starts_on,ends_on)
                values (:id,:org,:program,:mentor,:intern,:start,:end) on conflict do nothing""",
                id=internship, program=program, mentor=mentor, intern=user, start=today-timedelta(days=14), end=today+timedelta(days=35))
            for offset, status in enumerate(("planned", "submitted", "changes_requested", "completed")):
                task = uuid5(NAMESPACE, f"task/{group}/{index}/{offset}")
                title = ("Prepare a first draft", "Document the workflow", "Address review feedback", "Complete the baseline exercise")[offset]
                run("""insert into app.tasks(id,internship_id,title,criteria,due_on,status)
                    values (:id,:internship,:title,'Include a short explanation and evidence of the result.',:due,:status) on conflict do nothing""",
                    id=task, internship=internship, title=title, due=today+timedelta(days=offset-1), status=status)
                if offset:
                    decision = status if offset > 1 else None
                    run("""insert into app.submissions(id,task_id,version,evidence,decision,feedback,reviewed_at,submitted_at)
                        values (:id,:task,1,'Sample deliverable and reproduction steps.',:decision,:feedback,
                        case when cast(:decision as text) is null then null else now() end,now()-interval '2 days') on conflict do nothing""",
                        id=uuid5(NAMESPACE,str(task)), task=task, decision=decision,
                        feedback=("Clarify the edge case." if offset == 2 else "Evidence reviewed and accepted.") if decision else None)
                if status == "submitted":
                    run("""insert into app.notifications(org_id,recipient_id,internship_id,task_id,event,source_id)
                        values (:org,:admin,:internship,:task,'submitted',:source) on conflict do nothing""",
                        admin=admin, internship=internship, task=task, source=uuid5(NAMESPACE,str(task)))
            question = uuid5(NAMESPACE,f"question/{group}/{index}")
            topic = ("Where do I find the acceptance criteria?", "How do I resubmit after feedback?", "What evidence goes in a submission?")[index]
            run("insert into app.questions(id,org_id,author_id,title,body) values (:id,:org,:user,:title,:body) on conflict do nothing",
                id=question,user=user,title=f"{name}: {topic}",body="I am working through my first assignment and would like an example.")
            if index < 2:
                body = ("Open the task and read the Acceptance criteria section.", "Open the same task and submit a new version after addressing the feedback.")[index]
                run("""insert into app.answers(id,org_id,question_id,author_id,body,verified_at,verified_by)
                    values (:id,:org,:question,:mentor,:body,now(),:mentor) on conflict do nothing""",
                    id=uuid5(NAMESPACE,str(question)),question=question,mentor=mentor,body=body)


# Fictional display names for the synthetic sample users only. Real accounts are never renamed here.
SAMPLE_NAMES = {
    "mentor/0": "Arta Krasniqi", "mentor/1": "Liridon Berisha", "mentor/2": "Teuta Hoxha",
    "intern/0/0": "Blerim Gashi", "intern/0/1": "Drita Morina", "intern/0/2": "Ermal Shala",
    "intern/1/0": "Fjolla Rexhepi", "intern/1/1": "Gent Kelmendi", "intern/1/2": "Hana Bytyqi",
    "intern/2/0": "Ilir Zeqiri", "intern/2/1": "Jeta Osmani", "intern/2/2": "Kushtrim Limani",
}


def seed_profiles(connection):
    """Repeatable: inserts or refreshes the fictional names. Skips users that do not exist."""
    for key, name in SAMPLE_NAMES.items():
        connection.execute(text("""
            insert into app.profiles (user_id, full_name)
            select id, :name from auth.users where id = :id
            on conflict (user_id) do update set full_name = excluded.full_name, updated_at = now()
        """), {"id": uuid5(NAMESPACE, key), "name": name})


def main():
    email = input("Email you use to sign in to InternAgent: ").strip()
    url = dotenv_values(".env").get("MIGRATION_DATABASE_URL")
    if not url or not email:
        raise SystemExit("Set MIGRATION_DATABASE_URL and enter your existing sign-in email.")
    try:
        with create_engine(url, connect_args={"connect_timeout": 8}).begin() as connection:
            admin = connection.execute(text("select id from auth.users where lower(email)=lower(:email)"), {"email":email}).scalar_one_or_none()
            if admin is None:
                raise SystemExit("That sign-in account was not found in this Supabase project.")
            seed(connection, admin)
            seed_profiles(connection)
    except Exception as error:
        original = getattr(error, "orig", error)
        raise SystemExit(f"Seed failed and rolled back: {type(original).__name__} {getattr(original, 'sqlstate', '') or ''}") from None
    print("Select InternAgent Sample Workspace after signing in. Seeded 3 programs, 9 internships, 36 tasks and 9 Q&A threads.")


def names_only():
    url = dotenv_values(".env").get("MIGRATION_DATABASE_URL")
    if not url:
        raise SystemExit("Set MIGRATION_DATABASE_URL.")
    with create_engine(url, connect_args={"connect_timeout": 8}).begin() as connection:
        seed_profiles(connection)
    print(f"Sample display names set for {len(SAMPLE_NAMES)} synthetic users.")


if __name__ == "__main__":
    import sys
    names_only() if "--names" in sys.argv else main()
