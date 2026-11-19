from alembic import op

revision = "0003_workflow"
down_revision = "0002_programs"
branch_labels = None
depends_on = None

ACTOR = "nullif(current_setting('internagent.actor_id', true), '')::uuid"
ADMIN = f"exists (select 1 from app.memberships m where m.org_id = internships.org_id and m.user_id = {ACTOR} and m.active and m.role = 'admin')"
MEMBER = f"exists (select 1 from app.memberships m where m.org_id = internships.org_id and m.user_id = {ACTOR} and m.active and ((m.role='mentor' and internships.mentor_id=m.user_id) or (m.role='intern' and internships.intern_id=m.user_id)))"
MENTOR = f"exists (select 1 from app.internships i join app.memberships m on m.org_id=i.org_id and m.user_id=i.mentor_id where i.id=tasks.internship_id and m.active and m.role='mentor' and m.user_id={ACTOR})"
INTERN = f"exists (select 1 from app.internships i join app.memberships m on m.org_id=i.org_id and m.user_id=i.intern_id where i.id=tasks.internship_id and m.active and m.role='intern' and m.user_id={ACTOR})"
TASK_SCOPE = "exists (select 1 from app.tasks t where t.id=submissions.task_id)"


def upgrade() -> None:
    op.execute("""
        create table app.internships (
            id uuid primary key default gen_random_uuid(),
            org_id uuid not null references app.organizations(id),
            program_id uuid not null references app.programs(id),
            mentor_id uuid not null,
            intern_id uuid not null,
            starts_on date not null,
            ends_on date not null,
            foreign key (org_id, mentor_id) references app.memberships(org_id, user_id),
            foreign key (org_id, intern_id) references app.memberships(org_id, user_id),
            check (starts_on <= ends_on and mentor_id <> intern_id),
            unique (program_id, intern_id, starts_on)
        )
    """)
    op.execute("""
        create table app.tasks (
            id uuid primary key default gen_random_uuid(),
            internship_id uuid not null references app.internships(id),
            title text not null check (length(trim(title)) between 1 and 120),
            criteria text not null check (length(trim(criteria)) between 1 and 3000),
            due_on date not null,
            status text not null default 'planned' check (status in ('planned','submitted','changes_requested','completed'))
        )
    """)
    op.execute("""
        create table app.submissions (
            id uuid primary key default gen_random_uuid(),
            task_id uuid not null references app.tasks(id),
            version integer not null check (version > 0),
            evidence text not null check (length(trim(evidence)) between 1 and 6000),
            submitted_at timestamptz not null default now(),
            decision text check (decision in ('changes_requested','completed')),
            feedback text check (length(trim(feedback)) between 1 and 3000),
            reviewed_at timestamptz,
            check ((decision is null and feedback is null and reviewed_at is null)
                or (decision is not null and feedback is not null and reviewed_at is not null)),
            unique (task_id, version)
        )
    """)
    op.execute("create index internships_org_idx on app.internships(org_id)")
    op.execute("create index tasks_internship_idx on app.tasks(internship_id)")
    for table in ("internships", "tasks", "submissions"):
        op.execute(f"alter table app.{table} enable row level security")
        op.execute(f"grant select, insert on app.{table} to internagent_runtime")
    op.execute("grant update (status) on app.tasks to internagent_runtime")
    op.execute("grant update (decision, feedback, reviewed_at) on app.submissions to internagent_runtime")
    op.execute(f"create policy read_internships on app.internships for select to internagent_runtime using ({ADMIN} or {MEMBER})")
    op.execute(f"""create policy add_internships on app.internships for insert to internagent_runtime
        with check ({ADMIN} and exists (select 1 from app.programs p where p.id=internships.program_id and p.org_id=internships.org_id))""")
    op.execute("create policy read_tasks on app.tasks for select to internagent_runtime using (exists (select 1 from app.internships i where i.id=tasks.internship_id))")
    op.execute(f"create policy add_tasks on app.tasks for insert to internagent_runtime with check ({MENTOR} and status='planned')")
    op.execute(f"create policy advance_tasks on app.tasks for update to internagent_runtime using ({MENTOR} or {INTERN})")
    op.execute(f"create policy read_submissions on app.submissions for select to internagent_runtime using ({TASK_SCOPE})")
    op.execute(f"""create policy add_submissions on app.submissions for insert to internagent_runtime with check (
        decision is null and exists (select 1 from app.tasks t join app.internships i on i.id=t.internship_id
        where t.id=submissions.task_id and i.intern_id={ACTOR}))""")
    op.execute(f"""create policy review_submissions on app.submissions for update to internagent_runtime using (
        decision is null and exists (select 1 from app.tasks t join app.internships i on i.id=t.internship_id
        where t.id=submissions.task_id and i.mentor_id={ACTOR})) with check (
        decision is not null and exists (select 1 from app.tasks t join app.internships i on i.id=t.internship_id
        where t.id=submissions.task_id and i.mentor_id={ACTOR}))""")
    op.execute("""
        create function app.assignment_members(target_org uuid)
        returns table (id uuid, email text, role text)
        language sql stable security definer set search_path = '' as $$
            select u.id, u.email::text, m.role
            from app.memberships m join auth.users u on u.id=m.user_id
            where m.org_id=target_org and m.active and m.role in ('mentor','intern')
            and exists (select 1 from app.memberships a where a.org_id=target_org and a.active and a.role='admin'
                and a.user_id=nullif(current_setting('internagent.actor_id', true), '')::uuid)
            order by u.email
        $$
    """)
    op.execute("revoke all on function app.assignment_members(uuid) from public")
    op.execute("grant execute on function app.assignment_members(uuid) to internagent_runtime")


def downgrade() -> None:
    op.execute("drop function app.assignment_members(uuid)")
    op.execute("drop table app.submissions")
    op.execute("drop table app.tasks")
    op.execute("drop table app.internships")
