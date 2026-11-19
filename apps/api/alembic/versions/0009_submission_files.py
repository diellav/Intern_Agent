from alembic import op

revision = "0009_submission_files"
down_revision = "0008_plan_hours_notices"
branch_labels = None
depends_on = None

ACTOR = "nullif(current_setting('internagent.actor_id', true), '')::uuid"
BUCKET = "submission-files"
MAX_BYTES = 10 * 1024 * 1024
ALLOWED = ("application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain", "text/markdown",
           "text/csv", "application/zip", "application/json",
           "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
           "application/vnd.openxmlformats-officedocument.presentationml.presentation")
# The intern assigned to the task's internship, while their membership is active.
TASK_INTERN = f"""exists (select 1 from app.tasks t join app.internships i on i.id = t.internship_id
    join app.memberships m on m.org_id = i.org_id and m.user_id = i.intern_id and m.active
    where t.id = {{table}}.task_id and i.intern_id = {ACTOR})"""


def upgrade():
    # A submission may now carry only files or links, so the description can be empty.
    op.execute("alter table app.submissions drop constraint submissions_evidence_check")
    op.execute("alter table app.submissions add constraint submissions_evidence_check check (length(evidence) <= 6000)")

    op.execute("""
        create table app.submission_files (
            id uuid primary key default gen_random_uuid(),
            task_id uuid not null references app.tasks(id),
            submission_id uuid references app.submissions(id),
            uploaded_by uuid not null,
            storage_path text not null unique,
            file_name text not null check (length(file_name) between 1 and 200),
            size_bytes bigint not null check (size_bytes > 0),
            content_type text not null,
            created_at timestamptz not null default now()
        )
    """)
    op.execute("create index submission_files_submission on app.submission_files(submission_id)")
    op.execute("create index submission_files_staged on app.submission_files(task_id, created_at) where submission_id is null")
    op.execute("""
        create table app.submission_links (
            id uuid primary key default gen_random_uuid(),
            submission_id uuid not null references app.submissions(id),
            position smallint not null,
            url text not null check (url ~* '^https?://' and length(url) <= 2000),
            title text not null default '' check (length(title) <= 120),
            unique (submission_id, position)
        )
    """)
    for table in ("submission_files", "submission_links"):
        op.execute(f"alter table app.{table} enable row level security")
    # Visibility follows the task: whoever can read the task (via internships RLS) can read its files and links.
    # Staged files (not yet part of a submission) are visible only to the intern who uploaded them.
    op.execute(f"""create policy read_files on app.submission_files for select to internagent_runtime using (
        exists (select 1 from app.tasks t where t.id = submission_files.task_id)
        and (submission_id is not null or uploaded_by = {ACTOR}))""")
    op.execute(f"""create policy stage_files on app.submission_files for insert to internagent_runtime with check (
        submission_id is null and uploaded_by = {ACTOR} and {TASK_INTERN.format(table='submission_files')})""")
    op.execute(f"""create policy attach_files on app.submission_files for update to internagent_runtime
        using (submission_id is null and uploaded_by = {ACTOR})
        with check (uploaded_by = {ACTOR} and exists (select 1 from app.submissions s
            where s.id = submission_files.submission_id and s.task_id = submission_files.task_id))""")
    op.execute(f"""create policy discard_files on app.submission_files for delete to internagent_runtime
        using (submission_id is null and uploaded_by = {ACTOR})""")
    op.execute("grant select, insert, delete on app.submission_files to internagent_runtime")
    op.execute("grant update (submission_id) on app.submission_files to internagent_runtime")
    op.execute("""create policy read_links on app.submission_links for select to internagent_runtime using (
        exists (select 1 from app.submissions s where s.id = submission_links.submission_id))""")
    op.execute(f"""create policy add_links on app.submission_links for insert to internagent_runtime with check (
        exists (select 1 from app.submissions s join app.tasks t on t.id = s.task_id
            join app.internships i on i.id = t.internship_id
            where s.id = submission_links.submission_id and i.intern_id = {ACTOR}))""")
    op.execute("grant select, insert on app.submission_links to internagent_runtime")

    # Private bucket. No storage policies are added, so only the backend's secret key can read or write it.
    allowed = "array[" + ",".join(f"'{value}'" for value in ALLOWED) + "]"
    op.execute(f"""insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        values ('{BUCKET}', '{BUCKET}', false, {MAX_BYTES}, {allowed})
        on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
            allowed_mime_types = excluded.allowed_mime_types""")


def downgrade():
    op.execute("drop table app.submission_links")
    op.execute("drop table app.submission_files")
    op.execute("alter table app.submissions drop constraint submissions_evidence_check")
    op.execute("alter table app.submissions add constraint submissions_evidence_check check (length(trim(evidence)) between 1 and 6000)")
    # The bucket is left in place on purpose: it may still hold objects.
