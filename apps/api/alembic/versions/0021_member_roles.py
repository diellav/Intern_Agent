from alembic import op

revision = "0021_member_roles"
down_revision = "0020_report_findings"
branch_labels = None
depends_on = None

ACTOR = "nullif(current_setting('internagent.actor_id',true),'')::uuid"


def upgrade():
    # Admin-only role change. Same org row lock as add/remove so the last-admin check is serialized.
    op.execute(f"""
        create function app.set_member_role(target uuid,person uuid,new_role text) returns boolean
        language plpgsql security definer set search_path='' as $$
        declare current_role_value text;
        begin
            perform 1 from app.organizations where id=target for update;
            if not exists (
                select 1 from app.memberships a
                where a.org_id=target and a.active and a.role='admin' and a.user_id={ACTOR}
            ) then raise insufficient_privilege; end if;
            if new_role not in ('admin','mentor','intern') then
                raise exception 'invalid role' using errcode='22023';
            end if;
            if person={ACTOR} then
                raise exception 'cannot change own role' using errcode='42501';
            end if;
            select m.role into current_role_value from app.memberships m
            where m.org_id=target and m.user_id=person and m.active;
            if not found then return false; end if;
            if current_role_value='admin' and new_role<>'admin' and (
                select count(*) from app.memberships m
                where m.org_id=target and m.active and m.role='admin'
            ) <= 1 then
                raise exception 'cannot demote the last admin' using errcode='42501';
            end if;
            update app.memberships set role=new_role where org_id=target and user_id=person and active;
            return true;
        end $$
    """)
    op.execute("revoke all on function app.set_member_role(uuid,uuid,text) from public")
    op.execute("grant execute on function app.set_member_role(uuid,uuid,text) to internagent_runtime")


def downgrade():
    op.execute("drop function app.set_member_role(uuid,uuid,text)")
