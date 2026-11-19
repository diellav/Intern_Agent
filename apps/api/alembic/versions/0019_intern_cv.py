from alembic import op

revision = "0019_intern_cv"
down_revision = "0018_ai_usage"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        create table app.intern_cvs (
            internship_id uuid primary key references app.internships(id),
            owner_id uuid not null,
            content bytea not null check (octet_length(content) <= 5242880),
            mime text not null,
            consented_at timestamptz not null default now(),
            analysis jsonb
        );
        alter table app.intern_cvs enable row level security;
        grant select (internship_id,owner_id,consented_at,analysis), insert, delete, update (analysis) on app.intern_cvs to internagent_runtime;
    """)
    actor = "nullif(current_setting('internagent.actor_id',true),'')::uuid"
    owner = f"""owner_id={actor} and exists (
        select 1 from app.internships i join app.memberships m
        on m.org_id=i.org_id and m.user_id={actor} and m.active and m.role='intern'
        where i.id=internship_id and i.intern_id={actor})"""
    op.execute(f"""
        create function app.read_own_cv(target uuid)
        returns table(content bytea,mime text,consented_at timestamptz)
        language sql security definer set search_path='' as $$
            select cv.content,cv.mime,cv.consented_at from app.intern_cvs cv
            where cv.internship_id=target and {owner}
        $$;
        revoke all on function app.read_own_cv(uuid) from public;
        grant execute on function app.read_own_cv(uuid) to internagent_runtime;
    """)
    mentor = f"""exists (
        select 1 from app.internships i join app.memberships m
        on m.org_id=i.org_id and m.user_id={actor} and m.active and m.role='mentor'
        where i.id=internship_id and i.mentor_id={actor})"""
    op.execute(f"create policy cv_owner on app.intern_cvs for all to internagent_runtime using ({owner})")
    op.execute(f"create policy cv_mentor on app.intern_cvs for select to internagent_runtime using ({mentor})")


def downgrade():
    op.execute("drop function app.read_own_cv(uuid)")
    op.execute("drop table app.intern_cvs")
