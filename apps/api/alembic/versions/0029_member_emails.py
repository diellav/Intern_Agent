"""Lets any active member check which of a few emails belong to their workspace (used only for avatars)."""
from alembic import op

revision = "0029_member_emails"
down_revision = "0028_admin_plan_delete"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        create function app.member_emails_in(target uuid, addresses text[]) returns setof text
        language plpgsql stable security definer set search_path='' as $$
        begin
            if not exists (
                select 1 from app.memberships a
                where a.org_id=target and a.active
                  and a.user_id=nullif(current_setting('internagent.actor_id',true),'')::uuid
            ) then raise insufficient_privilege; end if;
            return query select distinct lower(u.email::text)
                from app.memberships m join auth.users u on u.id=m.user_id
                where m.org_id=target and lower(u.email::text) = any(addresses);
        end $$""")
    op.execute("revoke all on function app.member_emails_in(uuid,text[]) from public")
    op.execute("grant execute on function app.member_emails_in(uuid,text[]) to internagent_runtime")


def downgrade():
    op.execute("drop function app.member_emails_in(uuid,text[])")
