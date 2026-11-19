from alembic import op

revision = "0022_mentor_cv"
down_revision = "0021_member_roles"
branch_labels = None
depends_on = None

ACTOR = "nullif(current_setting('internagent.actor_id',true),'')::uuid"
# The internship's current mentor. Reassigning the internship moves access with it.
MENTOR = f"""exists (
    select 1 from app.internships i join app.memberships m
    on m.org_id=i.org_id and m.user_id={ACTOR} and m.active and m.role='mentor'
    where i.id=intern_cvs.internship_id and i.mentor_id={ACTOR})"""


def upgrade():
    # The assigned mentor uploads, analyses and deletes the intern's CV. The intern no longer manages it.
    op.execute("drop policy cv_owner on app.intern_cvs")
    op.execute("drop policy cv_mentor on app.intern_cvs")
    op.execute("drop function app.read_own_cv(uuid)")
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


def downgrade():
    op.execute("drop function app.read_intern_cv(uuid)")
    op.execute("drop policy cv_mentor on app.intern_cvs")
    owner = f"""owner_id={ACTOR} and exists (
        select 1 from app.internships i join app.memberships m
        on m.org_id=i.org_id and m.user_id={ACTOR} and m.active and m.role='intern'
        where i.id=internship_id and i.intern_id={ACTOR})"""
    op.execute(f"""
        create function app.read_own_cv(target uuid)
        returns table(content bytea,mime text,consented_at timestamptz)
        language sql security definer set search_path='' as $$
            select cv.content,cv.mime,cv.consented_at from app.intern_cvs cv
            where cv.internship_id=target and {owner}
        $$
    """)
    op.execute("revoke all on function app.read_own_cv(uuid) from public")
    op.execute("grant execute on function app.read_own_cv(uuid) to internagent_runtime")
    op.execute(f"create policy cv_owner on app.intern_cvs for all to internagent_runtime using ({owner})")
    op.execute(f"create policy cv_mentor on app.intern_cvs for select to internagent_runtime using ({MENTOR.replace('intern_cvs.', '')})")
