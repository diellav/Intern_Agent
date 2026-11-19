from alembic import op

revision = "0016_progress_reports"
down_revision = "0015_slack_delivery"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        create table app.progress_reports (
            id uuid primary key default gen_random_uuid(),
            internship_id uuid not null references app.internships(id),
            starts_on date not null,
            ends_on date not null,
            snapshot jsonb not null,
            summary text not null check (length(summary) <= 6000),
            shared_at timestamptz,
            unique (internship_id, starts_on, ends_on)
        );
        alter table app.progress_reports enable row level security;
        grant select, insert, update (snapshot, summary, shared_at)
            on app.progress_reports to internagent_runtime;
    """)
    actor = "nullif(current_setting('internagent.actor_id',true),'')::uuid"
    scope = f"""select 1 from app.internships i join app.memberships m
        on m.org_id=i.org_id and m.user_id={actor} and m.active
        where i.id=progress_reports.internship_id and"""
    staff = f"""exists ({scope} (m.role='admin' or (m.role='mentor' and i.mentor_id={actor})))"""
    intern = f"""exists ({scope} m.role='intern' and i.intern_id={actor})"""
    op.execute(f"create policy report_read on app.progress_reports for select to internagent_runtime using ({staff} or (shared_at is not null and {intern}))")
    op.execute(f"create policy report_insert on app.progress_reports for insert to internagent_runtime with check ({staff})")
    op.execute(f"create policy report_update on app.progress_reports for update to internagent_runtime using ({staff} and shared_at is null) with check ({staff})")


def downgrade():
    op.execute("drop table app.progress_reports")
