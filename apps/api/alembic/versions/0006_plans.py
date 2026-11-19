from alembic import op

revision = "0006_plans"
down_revision = "0005_knowledge"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        create table app.plans (
            id uuid primary key default gen_random_uuid(),
            internship_id uuid not null references app.internships(id),
            title text not null,
            goal text not null,
            project text not null,
            starts_on date not null,
            ends_on date not null,
            revision integer not null default 1,
            published_at timestamptz,
            draft jsonb not null,
            task_ids uuid[] not null default '{}',
            check (starts_on <= ends_on)
        )
    """)
    op.execute("create index plans_parent on app.plans(internship_id, starts_on)")
    op.execute("alter table app.plans enable row level security")
    mentor = """exists (select 1 from app.internships i join app.memberships m
        on m.org_id=i.org_id and m.user_id=i.mentor_id
        where i.id=plans.internship_id and m.active and m.role='mentor'
        and m.user_id=nullif(current_setting('internagent.actor_id',true),'')::uuid)"""
    op.execute(f"""create policy plan_read on app.plans for select to internagent_runtime
        using ({mentor} or (published_at is not null and exists (
            select 1 from app.internships i where i.id=plans.internship_id)))""")
    op.execute(f"create policy plan_insert on app.plans for insert to internagent_runtime with check ({mentor} and published_at is null)")
    op.execute(f"create policy plan_update on app.plans for update to internagent_runtime using ({mentor} and published_at is null) with check ({mentor})")
    op.execute("grant select, insert, update on app.plans to internagent_runtime")


def downgrade():
    op.execute("drop table app.plans")
