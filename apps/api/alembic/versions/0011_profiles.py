from alembic import op

revision = "0011_profiles"
down_revision = "0010_internship_notes"
branch_labels = None
depends_on = None

ACTOR = "nullif(current_setting('internagent.actor_id', true), '')::uuid"
SCOPE = f"""exists (
    select 1 from app.memberships a
    where a.org_id = target_org and a.active and a.user_id = {ACTOR}
    and (a.role = 'admin'
        or (a.role = 'mentor' and i.mentor_id = a.user_id)
        or (a.role = 'intern' and i.intern_id = a.user_id)))"""


def upgrade():
    # Display names only. Identity and authorization keep using user ids and memberships.
    op.execute("""
        create table app.profiles (
            user_id uuid primary key references auth.users(id) on delete cascade,
            full_name text not null check (length(trim(full_name)) between 1 and 120),
            updated_at timestamptz not null default now()
        )
    """)
    op.execute("alter table app.profiles enable row level security")
    op.execute(f"create policy own_profile on app.profiles for select to internagent_runtime using (user_id = {ACTOR})")
    op.execute("grant select on app.profiles to internagent_runtime")

    # Same scope as before (read_internships), now with names next to the emails.
    op.execute("drop function app.internship_people(uuid)")
    op.execute(f"""
        create function app.internship_people(target_org uuid)
        returns table (internship_id uuid, mentor_email text, intern_email text, mentor_name text, intern_name text)
        language sql stable security definer set search_path = '' as $$
            select i.id, mu.email::text, iu.email::text, mp.full_name, ip.full_name
            from app.internships i
            join auth.users mu on mu.id = i.mentor_id
            join auth.users iu on iu.id = i.intern_id
            left join app.profiles mp on mp.user_id = i.mentor_id
            left join app.profiles ip on ip.user_id = i.intern_id
            where i.org_id = target_org and {SCOPE}
        $$
    """)
    op.execute("revoke all on function app.internship_people(uuid) from public")
    op.execute("grant execute on function app.internship_people(uuid) to internagent_runtime")

    op.execute("drop function app.assignment_members(uuid)")
    op.execute(f"""
        create function app.assignment_members(target_org uuid)
        returns table (id uuid, email text, role text, full_name text)
        language sql stable security definer set search_path = '' as $$
            select u.id, u.email::text, m.role, p.full_name
            from app.memberships m join auth.users u on u.id = m.user_id
            left join app.profiles p on p.user_id = m.user_id
            where m.org_id = target_org and m.active and m.role in ('mentor','intern')
            and exists (select 1 from app.memberships a where a.org_id = target_org and a.active and a.role = 'admin'
                and a.user_id = {ACTOR})
            order by coalesce(p.full_name, u.email)
        $$
    """)
    op.execute("revoke all on function app.assignment_members(uuid) from public")
    op.execute("grant execute on function app.assignment_members(uuid) to internagent_runtime")


def downgrade():
    op.execute("drop function app.assignment_members(uuid)")
    op.execute(f"""
        create function app.assignment_members(target_org uuid)
        returns table (id uuid, email text, role text)
        language sql stable security definer set search_path = '' as $$
            select u.id, u.email::text, m.role
            from app.memberships m join auth.users u on u.id=m.user_id
            where m.org_id=target_org and m.active and m.role in ('mentor','intern')
            and exists (select 1 from app.memberships a where a.org_id=target_org and a.active and a.role='admin'
                and a.user_id={ACTOR})
            order by u.email
        $$
    """)
    op.execute("revoke all on function app.assignment_members(uuid) from public")
    op.execute("grant execute on function app.assignment_members(uuid) to internagent_runtime")
    op.execute("drop function app.internship_people(uuid)")
    op.execute(f"""
        create function app.internship_people(target_org uuid)
        returns table (internship_id uuid, mentor_email text, intern_email text)
        language sql stable security definer set search_path = '' as $$
            select i.id, mu.email::text, iu.email::text
            from app.internships i
            join auth.users mu on mu.id = i.mentor_id
            join auth.users iu on iu.id = i.intern_id
            where i.org_id = target_org and {SCOPE}
        $$
    """)
    op.execute("revoke all on function app.internship_people(uuid) from public")
    op.execute("grant execute on function app.internship_people(uuid) to internagent_runtime")
    op.execute("drop table app.profiles")
