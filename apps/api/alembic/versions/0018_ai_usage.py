from alembic import op

revision = "0018_ai_usage"
down_revision = "0017_task_questions"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        create table app.ai_usage (
            id uuid primary key default gen_random_uuid(),
            org_id uuid not null,
            actor_id uuid not null,
            action text not null,
            model text not null,
            started_at timestamptz not null default now(),
            elapsed_ms integer,
            outcome text not null default 'started',
            input_tokens integer,
            output_tokens integer,
            vote smallint check (vote in (-1,1)),
            foreign key (org_id,actor_id) references app.memberships(org_id,user_id)
        );
        create index ai_usage_actor_time on app.ai_usage(actor_id,started_at);
        create index ai_usage_org_time on app.ai_usage(org_id,started_at desc);
        alter table app.ai_usage enable row level security;
        grant select, insert, update (elapsed_ms,outcome,input_tokens,output_tokens,vote)
            on app.ai_usage to internagent_runtime;
    """)
    actor = "nullif(current_setting('internagent.actor_id',true),'')::uuid"
    member = f"""exists (select 1 from app.memberships m where m.org_id=ai_usage.org_id
        and m.user_id={actor} and m.active"""
    own = f"actor_id={actor} and {member})"
    op.execute(f"create policy ai_read on app.ai_usage for select to internagent_runtime using (({own}) or {member} and m.role='admin'))")
    op.execute(f"create policy ai_insert on app.ai_usage for insert to internagent_runtime with check ({own})")
    op.execute(f"create policy ai_update on app.ai_usage for update to internagent_runtime using ({own}) with check ({own})")


def downgrade():
    op.execute("drop table app.ai_usage")
