"""Company projects: the real work interns join. A program stays the cohort; a project is what they work on."""
from alembic import op

revision = "0025_projects"
down_revision = "0024_flow_fixes"
branch_labels = None
depends_on = None

ACTOR = "nullif(current_setting('internagent.actor_id', true), '')::uuid"
STAFF = f"""exists (select 1 from app.memberships m where m.org_id = projects.org_id and m.user_id = {ACTOR}
    and m.active and m.role in ('admin', 'mentor'))"""
ADMIN = f"""exists (select 1 from app.memberships m where m.org_id = projects.org_id and m.user_id = {ACTOR}
    and m.active and m.role = 'admin')"""
# Interns see only the project of their own internship (the internships policy already limits them to theirs).
INTERN = "exists (select 1 from app.internships i where i.project_id = projects.id)"


def upgrade():
    op.execute("""
        create table app.projects (
            id uuid primary key default gen_random_uuid(),
            org_id uuid not null references app.organizations(id) on delete cascade,
            name text not null check (length(name) between 1 and 120),
            description text not null default '' check (length(description) <= 6000),
            status text not null default 'active' check (status in ('active', 'paused', 'done')),
            tech_stack text not null default '' check (length(tech_stack) <= 500),
            current_focus text not null default '' check (length(current_focus) <= 3000),
            intern_areas text not null default '' check (length(intern_areas) <= 3000),
            repo_url text check (repo_url is null or length(repo_url) <= 2000),
            jira_key text check (jira_key is null or jira_key ~ '^[A-Z][A-Z0-9_]{1,9}$'),
            revision integer not null default 1,
            created_by uuid references auth.users(id) on delete set null,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            unique (org_id, name),
            unique (id, org_id)
        )
    """)
    op.execute("create index projects_org on app.projects(org_id, status, name)")
    op.execute("alter table app.projects enable row level security")
    op.execute("grant select, insert, delete on app.projects to internagent_runtime")
    op.execute("""grant update (name, description, status, tech_stack, current_focus, intern_areas, repo_url, jira_key,
        revision, updated_at) on app.projects to internagent_runtime""")
    # An internship belongs to one project at most, in the same organization (composite key).
    op.execute("alter table app.internships add column project_id uuid")
    op.execute("""alter table app.internships add constraint internships_project_fk
        foreign key (project_id, org_id) references app.projects(id, org_id) on delete restrict""")
    op.execute("create index internships_project on app.internships(project_id)")

    op.execute(f"create policy project_read on app.projects for select to internagent_runtime using ({STAFF} or {INTERN})")
    op.execute(f"create policy project_insert on app.projects for insert to internagent_runtime with check ({STAFF} and created_by = {ACTOR})")
    op.execute(f"create policy project_update on app.projects for update to internagent_runtime using ({STAFF}) with check ({STAFF})")
    op.execute(f"create policy project_delete on app.projects for delete to internagent_runtime using ({ADMIN})")

    # Admins and the assigned mentor move an internship to a project (or detach it).
    op.execute(f"""
        create function app.set_internship_project(target uuid, project uuid) returns uuid
        language plpgsql security definer set search_path = '' as $$
        begin
            update app.internships i set project_id = project
            where i.id = target and exists (
                select 1 from app.memberships m where m.org_id = i.org_id and m.user_id = {ACTOR} and m.active
                and (m.role = 'admin' or (m.role = 'mentor' and i.mentor_id = m.user_id)))
            and (project is null or exists (select 1 from app.projects p where p.id = project and p.org_id = i.org_id));
            if not found then
                raise exception 'not allowed' using errcode = '42501';
            end if;
            return project;
        end
        $$
    """)
    op.execute("revoke all on function app.set_internship_project(uuid, uuid) from public")
    op.execute("grant execute on function app.set_internship_project(uuid, uuid) to internagent_runtime")


def downgrade():
    op.execute("drop function app.set_internship_project(uuid, uuid)")
    op.execute("alter table app.internships drop constraint internships_project_fk")
    op.execute("drop table app.projects")  # drops its policies, which read internships.project_id
    op.execute("alter table app.internships drop column project_id")
