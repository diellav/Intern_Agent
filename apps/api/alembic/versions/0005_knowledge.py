from alembic import op

revision = "0005_knowledge"
down_revision = "0004_notifications"
branch_labels = None
depends_on = None

ACTOR = "nullif(current_setting('internagent.actor_id',true),'')::uuid"


def upgrade():
    op.execute("""
        create table app.questions (
            id uuid primary key default gen_random_uuid(),
            org_id uuid not null references app.organizations(id),
            author_id uuid not null,
            title text not null check (length(trim(title)) between 1 and 180),
            body text not null check (length(trim(body)) between 1 and 6000),
            created_at timestamptz not null default now(),
            unique(org_id,id),
            foreign key(org_id,author_id) references app.memberships(org_id,user_id)
        )
    """)
    op.execute("""
        create table app.answers (
            id uuid primary key default gen_random_uuid(),
            org_id uuid not null,
            question_id uuid not null,
            author_id uuid not null,
            body text not null check (length(trim(body)) between 1 and 6000),
            created_at timestamptz not null default now(),
            verified_at timestamptz,
            verified_by uuid,
            foreign key(org_id,question_id) references app.questions(org_id,id),
            foreign key(org_id,author_id) references app.memberships(org_id,user_id),
            foreign key(org_id,verified_by) references app.memberships(org_id,user_id),
            check ((verified_at is null) = (verified_by is null))
        )
    """)
    op.execute("create index questions_recent on app.questions(org_id,created_at desc,id desc)")
    op.execute("create index answers_thread on app.answers(question_id,created_at,id)")
    op.execute("create unique index answers_one_verified on app.answers(question_id) where verified_at is not null")
    op.execute("create index questions_search on app.questions using gin(to_tsvector('simple',title || ' ' || body))")
    for table in ("questions","answers"):
        member = f"exists (select 1 from app.memberships m where m.org_id={table}.org_id and m.user_id={ACTOR} and m.active)"
        op.execute(f"alter table app.{table} enable row level security")
        op.execute(f"create policy read_{table} on app.{table} for select to internagent_runtime using ({member})")
        safe_fields = " and verified_at is null and verified_by is null" if table == "answers" else ""
        op.execute(f"create policy add_{table} on app.{table} for insert to internagent_runtime with check ({member} and author_id={ACTOR}{safe_fields})")
        op.execute(f"grant select, insert on app.{table} to internagent_runtime")
    verifier = f"exists (select 1 from app.memberships m where m.org_id=answers.org_id and m.user_id={ACTOR} and m.active and m.role in ('admin','mentor'))"
    op.execute(f"create policy verify_answer on app.answers for update to internagent_runtime using ({verifier} and verified_at is null) with check ({verifier} and verified_by={ACTOR})")
    op.execute("grant update (verified_at,verified_by) on app.answers to internagent_runtime")


def downgrade():
    op.execute("drop table app.answers")
    op.execute("drop table app.questions")
