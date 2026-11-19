from alembic import op

revision = "0014_members_guard"
down_revision = "0013_members"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        create or replace function app.members(target uuid)
        returns table(id uuid,email text,full_name text,role text,status text,invited_by uuid)
        language plpgsql security definer set search_path='' as $$
        begin
            if not exists (
                select 1 from app.memberships a
                where a.org_id=target and a.active and a.role='admin'
                  and a.user_id=nullif(current_setting('internagent.actor_id',true),'')::uuid
            ) then raise insufficient_privilege; end if;
            return query select u.id,u.email::text,p.full_name,m.role,
                case when not m.active then 'inactive'
                     when u.email_confirmed_at is null then 'pending' else 'active' end,
                m.invited_by
            from app.memberships m join auth.users u on u.id=m.user_id
            left join app.profiles p on p.user_id=u.id
            where m.org_id=target order by coalesce(p.full_name,u.email),u.id;
        end $$
    """)


def downgrade():
    # The repaired function remains compatible with the preceding schema.
    pass
