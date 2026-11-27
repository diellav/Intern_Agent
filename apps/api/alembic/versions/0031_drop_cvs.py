"""CV analysis is removed from the product: drop the stored CVs, their policy and the read function.

The CV content cannot be restored by a downgrade; it only recreates the empty table.
"""
from alembic import op

revision = "0031_drop_cvs"
down_revision = "0030_hr_role"
branch_labels = None
depends_on = None

ACTOR = "nullif(current_setting('internagent.actor_id',true),'')::uuid"
MENTOR = f"""exists (
    select 1 from app.internships i join app.memberships m
    on m.org_id=i.org_id and m.user_id={ACTOR} and m.active and m.role='mentor'
    where i.id=intern_cvs.internship_id and i.mentor_id={ACTOR})"""


def upgrade():
    op.execute("drop function app.read_intern_cv(uuid)")
    op.execute("drop table app.intern_cvs")


def downgrade():
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
    op.execute(f"create policy cv_mentor on app.intern_cvs for all to internagent_runtime using ({MENTOR}) with check ({MENTOR} and owner_id={ACTOR})")
    op.execute(f"""
        create function app.read_intern_cv(target uuid)
        returns table(content bytea, mime text, consented_at timestamptz)
        language sql security definer set search_path='' as $$
            select cv.content, cv.mime, cv.consented_at from app.intern_cvs cv
            where cv.internship_id=target and exists (
                select 1 from app.internships i join app.memberships m
                on m.org_id=i.org_id and m.user_id={ACTOR} and m.active and m.role='mentor'
                where i.id=cv.internship_id and i.mentor_id={ACTOR})
        $$
    """)
    op.execute("revoke all on function app.read_intern_cv(uuid) from public")
    op.execute("grant execute on function app.read_intern_cv(uuid) to internagent_runtime")
