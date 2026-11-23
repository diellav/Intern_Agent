"""Jira read sync: a copy of each project's issues, what changed between syncs, and the AI's running project brief."""
from alembic import op

revision = "0026_jira_sync"
down_revision = "0025_projects"
branch_labels = None
depends_on = None

ACTOR = "nullif(current_setting('internagent.actor_id', true), '')::uuid"


def staff(table: str) -> str:
    # Admins and mentors of the organization. Interns never read Jira data directly.
    return f"""exists (select 1 from app.memberships m where m.org_id = {table}.org_id and m.user_id = {ACTOR}
        and m.active and m.role in ('admin', 'mentor'))"""


def upgrade():
    op.execute("alter table app.projects add column jira_synced_at timestamptz")
    op.execute("grant update (jira_synced_at) on app.projects to internagent_runtime")
    op.execute("alter table app.tasks add column jira_key text check (jira_key is null or jira_key ~ '^[A-Z][A-Z0-9_]{1,9}-[0-9]+$')")

    op.execute("""
        create table app.jira_issues (
            project_id uuid not null,
            org_id uuid not null,
            key text not null,
            summary text not null,
            issue_type text not null,
            status text not null,
            status_category text not null check (status_category in ('new', 'indeterminate', 'done')),
            parent_key text,
            epic_key text,
            labels text[] not null default '{}',
            assigned boolean not null default false,   -- who is assigned stays in Jira; only whether someone is
            description text not null default '',
            jira_updated_at timestamptz,
            synced_at timestamptz not null default now(),
            primary key (project_id, key),
            foreign key (project_id, org_id) references app.projects(id, org_id) on delete cascade
        )
    """)
    op.execute("""
        create table app.jira_events (
            id bigint generated always as identity primary key,
            project_id uuid not null,
            org_id uuid not null,
            key text not null,
            kind text not null check (kind in ('created', 'status', 'removed')),
            summary text not null,
            from_status text,
            to_status text,
            occurred_at timestamptz not null default now(),
            foreign key (project_id, org_id) references app.projects(id, org_id) on delete cascade
        )
    """)
    op.execute("create index jira_events_project on app.jira_events(project_id, id desc)")
    op.execute("""
        create table app.project_briefs (
            id uuid primary key default gen_random_uuid(),
            project_id uuid not null,
            org_id uuid not null,
            brief jsonb not null,
            last_event_id bigint,       -- changes up to this event are reflected in the brief
            issue_count integer not null,
            model text not null,
            created_by uuid references auth.users(id) on delete set null,
            created_at timestamptz not null default now(),
            foreign key (project_id, org_id) references app.projects(id, org_id) on delete cascade
        )
    """)
    op.execute("create index project_briefs_project on app.project_briefs(project_id, created_at desc)")
    for table in ("jira_issues", "jira_events", "project_briefs"):
        op.execute(f"alter table app.{table} enable row level security")
        op.execute(f"create policy {table}_staff on app.{table} for all to internagent_runtime using ({staff(table)}) with check ({staff(table)})")
    op.execute("grant select, insert, update, delete on app.jira_issues to internagent_runtime")
    op.execute("grant select, insert on app.jira_events, app.project_briefs to internagent_runtime")


def downgrade():
    op.execute("drop table app.project_briefs")
    op.execute("drop table app.jira_events")
    op.execute("drop table app.jira_issues")
    op.execute("alter table app.tasks drop column jira_key")
    op.execute("revoke update (jira_synced_at) on app.projects from internagent_runtime")
    op.execute("alter table app.projects drop column jira_synced_at")
