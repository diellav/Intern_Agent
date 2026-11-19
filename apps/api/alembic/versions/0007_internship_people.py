from alembic import op

revision = "0007_internship_people"
down_revision = "0006_plans"
branch_labels = None
depends_on = None

ACTOR = "nullif(current_setting('internagent.actor_id', true), '')::uuid"


def upgrade():
    # Emails live in auth.users, which the runtime role cannot read. This function exposes
    # only the mentor and intern of internships the actor may already see under read_internships.
    op.execute(f"""
        create function app.internship_people(target_org uuid)
        returns table (internship_id uuid, mentor_email text, intern_email text)
        language sql stable security definer set search_path = '' as $$
            select i.id, mu.email::text, iu.email::text
            from app.internships i
            join auth.users mu on mu.id = i.mentor_id
            join auth.users iu on iu.id = i.intern_id
            where i.org_id = target_org
            and exists (
                select 1 from app.memberships a
                where a.org_id = target_org and a.active and a.user_id = {ACTOR}
                and (a.role = 'admin'
                    or (a.role = 'mentor' and i.mentor_id = a.user_id)
                    or (a.role = 'intern' and i.intern_id = a.user_id))
            )
        $$
    """)
    op.execute("revoke all on function app.internship_people(uuid) from public")
    op.execute("grant execute on function app.internship_people(uuid) to internagent_runtime")


def downgrade():
    op.execute("drop function app.internship_people(uuid)")
