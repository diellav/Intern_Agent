from alembic import op

revision = "0013_members"
down_revision = "0012_own_profile"
branch_labels = None
depends_on = None

GUARD = """
    if not exists (select 1 from app.memberships
        where org_id=target and active and role='admin'
        and user_id=nullif(current_setting('internagent.actor_id',true),'')::uuid)
    then raise insufficient_privilege; end if;
"""


def upgrade():
    op.execute("alter table app.memberships add column invited_by uuid references auth.users(id) on delete set null")
    functions = [
        ("members(uuid)", f"""
            create function app.members(target uuid)
            returns table(id uuid,email text,full_name text,role text,status text,invited_by uuid)
            language plpgsql security definer set search_path='' as $$
            begin
                {GUARD}
                return query select u.id,u.email::text,p.full_name,m.role,
                    case when not m.active then 'inactive'
                         when u.email_confirmed_at is null then 'pending' else 'active' end,
                    m.invited_by
                from app.memberships m join auth.users u on u.id=m.user_id
                left join app.profiles p on p.user_id=u.id
                where m.org_id=target order by coalesce(p.full_name,u.email),u.id;
            end $$"""),
        ("member_auth_id(uuid,text)", f"""
            create function app.member_auth_id(target uuid,address text) returns uuid
            language plpgsql security definer set search_path='' as $$
            begin
                {GUARD}
                return (select id from auth.users where lower(email)=lower(address) limit 1);
            end $$"""),
        ("add_member(uuid,uuid,text,text)", f"""
            create function app.add_member(target uuid,person uuid,member_role text,person_name text) returns boolean
            language plpgsql security definer set search_path='' as $$
            begin
                perform 1 from app.organizations where id=target for update;
                {GUARD}
                insert into app.memberships(org_id,user_id,role,active,invited_by)
                values(target,person,member_role,true,nullif(current_setting('internagent.actor_id',true),'')::uuid)
                on conflict(org_id,user_id) do update set role=excluded.role,active=true,invited_by=excluded.invited_by
                where not memberships.active;
                if not found then return false; end if;
                insert into app.profiles(user_id,full_name) values(person,person_name)
                on conflict(user_id) do nothing;
                return true;
            end $$"""),
        ("remove_member(uuid,uuid)", f"""
            create function app.remove_member(target uuid,person uuid) returns boolean
            language plpgsql security definer set search_path='' as $$
            begin
                perform 1 from app.organizations where id=target for update;
                {GUARD}
                if person=nullif(current_setting('internagent.actor_id',true),'')::uuid then return false; end if;
                update app.memberships set active=false where org_id=target and user_id=person and active;
                return found;
            end $$"""),
    ]
    for signature, sql in functions:
        op.execute(sql)
        op.execute(f"revoke all on function app.{signature} from public")
        op.execute(f"grant execute on function app.{signature} to internagent_runtime")


def downgrade():
    for signature in ("members(uuid)", "member_auth_id(uuid,text)", "add_member(uuid,uuid,text,text)", "remove_member(uuid,uuid)"):
        op.execute(f"drop function app.{signature}")
    op.execute("alter table app.memberships drop column invited_by")
