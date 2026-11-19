from alembic import op

revision = "0010_internship_notes"
down_revision = "0009_submission_files"
branch_labels = None
depends_on = None

ACTOR = "nullif(current_setting('internagent.actor_id', true), '')::uuid"
# The internship is visible to the actor under read_internships (admin, its mentor or its intern).
VISIBLE = "exists (select 1 from app.internships i where i.id = internship_notes.internship_id)"
ASSIGNED_MENTOR = f"""exists (select 1 from app.internships i join app.memberships m
    on m.org_id = i.org_id and m.user_id = i.mentor_id and m.active and m.role = 'mentor'
    where i.id = internship_notes.internship_id and i.mentor_id = {ACTOR})"""


def upgrade():
    op.execute("""
        create table app.internship_notes (
            id uuid primary key default gen_random_uuid(),
            internship_id uuid not null references app.internships(id),
            author_id uuid not null,
            body text not null check (length(trim(body)) between 1 and 4000),
            visibility text not null default 'private' check (visibility in ('private', 'shared')),
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        )
    """)
    op.execute("create index internship_notes_recent on app.internship_notes(internship_id, created_at desc)")
    op.execute("alter table app.internship_notes enable row level security")
    # Private notes: only their author. Shared notes: everyone who can see the internship.
    op.execute(f"""create policy read_notes on app.internship_notes for select to internagent_runtime using (
        {VISIBLE} and (author_id = {ACTOR} or visibility = 'shared'))""")
    op.execute(f"""create policy add_notes on app.internship_notes for insert to internagent_runtime with check (
        author_id = {ACTOR} and {ASSIGNED_MENTOR})""")
    op.execute(f"""create policy edit_notes on app.internship_notes for update to internagent_runtime
        using (author_id = {ACTOR} and {VISIBLE}) with check (author_id = {ACTOR} and {ASSIGNED_MENTOR})""")
    op.execute(f"""create policy remove_notes on app.internship_notes for delete to internagent_runtime
        using (author_id = {ACTOR} and {VISIBLE})""")
    op.execute("grant select, insert, delete on app.internship_notes to internagent_runtime")
    op.execute("grant update (body, visibility, updated_at) on app.internship_notes to internagent_runtime")


def downgrade():
    op.execute("drop table app.internship_notes")
