"""Flow fixes: one notice per published plan, carried deadlines, single tasks join the active plan, closing internships."""
from alembic import op

revision = "0024_flow_fixes"
down_revision = "0023_plan_delete"
branch_labels = None
depends_on = None

ACTOR = "nullif(current_setting('internagent.actor_id', true), '')::uuid"


def upgrade():
    op.execute("alter table app.internships add column closed_at timestamptz")

    # Publishing a plan inserts its new tasks, and each insert raises an 'assigned' notice. The intern
    # gets the single 'plan_published' notice instead. Overdue carried work moves to the plan's end date.
    op.execute("""
        create function app.plan_publish_effects() returns trigger
        language plpgsql security definer set search_path = '' as $$
        begin
            if old.published_at is null and new.published_at is not null then
                delete from app.notifications
                where event = 'assigned' and task_id = any(new.task_ids) and created_at = now();
                update app.tasks set due_on = new.ends_on
                where id = any(new.task_ids) and status <> 'completed' and due_on < new.starts_on;
            end if;
            return new;
        end
        $$
    """)
    op.execute("revoke all on function app.plan_publish_effects() from public")
    op.execute("""create trigger plan_publish_effects after update of published_at on app.plans
        for each row execute function app.plan_publish_effects()""")

    # A single task added by the mentor joins the latest published plan whose period covers its deadline.
    # Published plans are otherwise read-only, so this runs as a narrow definer function.
    op.execute(f"""
        create function app.attach_task_to_plan(target uuid) returns table(plan_id uuid, plan_title text)
        language plpgsql security definer set search_path = '' as $$
        begin
            return query
            update app.plans p set task_ids = p.task_ids || target
            where p.id = (
                select pl.id from app.tasks t
                join app.internships i on i.id = t.internship_id
                join app.memberships m on m.org_id = i.org_id and m.user_id = i.mentor_id and m.active and m.role = 'mentor'
                join app.plans pl on pl.internship_id = t.internship_id
                where t.id = target and i.mentor_id = {ACTOR} and pl.published_at is not null
                    and t.due_on between pl.starts_on and pl.ends_on and not (target = any(pl.task_ids))
                order by pl.published_at desc limit 1)
            returning p.id, p.title;
        end
        $$
    """)
    op.execute("revoke all on function app.attach_task_to_plan(uuid) from public")
    op.execute("grant execute on function app.attach_task_to_plan(uuid) to internagent_runtime")

    # Admins and the assigned mentor can close an internship (and reopen it).
    op.execute(f"""
        create function app.set_internship_closed(target uuid, closed boolean) returns timestamptz
        language plpgsql security definer set search_path = '' as $$
        declare result timestamptz;
        begin
            update app.internships i
            set closed_at = case when closed then coalesce(i.closed_at, now()) end
            where i.id = target and exists (
                select 1 from app.memberships m where m.org_id = i.org_id and m.user_id = {ACTOR} and m.active
                and (m.role = 'admin' or (m.role = 'mentor' and i.mentor_id = m.user_id)))
            returning i.closed_at into result;
            if not found then
                raise exception 'not allowed' using errcode = '42501';
            end if;
            return result;
        end
        $$
    """)
    op.execute("revoke all on function app.set_internship_closed(uuid, boolean) from public")
    op.execute("grant execute on function app.set_internship_closed(uuid, boolean) to internagent_runtime")


def downgrade():
    op.execute("drop function app.set_internship_closed(uuid, boolean)")
    op.execute("drop function app.attach_task_to_plan(uuid)")
    op.execute("drop trigger plan_publish_effects on app.plans")
    op.execute("drop function app.plan_publish_effects()")
    op.execute("alter table app.internships drop column closed_at")
