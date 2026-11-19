from alembic import op

revision = "0008_plan_hours_notices"
down_revision = "0007_internship_people"
branch_labels = None
depends_on = None


def upgrade():
    # Optional effort estimate per task. Existing tasks keep NULL ("unknown").
    op.execute("alter table app.tasks add column estimated_hours numeric(6,1) check (estimated_hours > 0 and estimated_hours <= 1000)")

    # A published plan notifies the intern even when it only carries existing tasks.
    op.execute("alter table app.notifications add column plan_id uuid references app.plans(id)")
    op.execute("alter table app.notifications alter column task_id drop not null")
    op.execute("alter table app.notifications drop constraint notifications_event_check")
    op.execute("""alter table app.notifications add constraint notifications_event_check
        check (event in ('assigned','submitted','completed','changes_requested','plan_published'))""")
    op.execute("""alter table app.notifications add constraint notifications_target_check
        check ((event = 'plan_published' and plan_id is not null) or (event <> 'plan_published' and task_id is not null))""")
    op.execute("""
        create function app.notify_plan() returns trigger
        language plpgsql security definer set search_path = '' as $$
        declare parent app.internships%rowtype;
        begin
            if old.published_at is null and new.published_at is not null then
                select * into strict parent from app.internships where id = new.internship_id;
                insert into app.notifications (org_id, recipient_id, internship_id, plan_id, event, source_id)
                values (parent.org_id, parent.intern_id, parent.id, new.id, 'plan_published', new.id)
                on conflict (recipient_id, event, source_id) do nothing;
            end if;
            return new;
        end
        $$
    """)
    op.execute("revoke all on function app.notify_plan() from public")
    op.execute("create trigger notify_plan after update of published_at on app.plans for each row execute function app.notify_plan()")


def downgrade():
    op.execute("drop trigger notify_plan on app.plans")
    op.execute("drop function app.notify_plan()")
    op.execute("delete from app.notifications where event = 'plan_published'")
    op.execute("alter table app.notifications drop constraint notifications_target_check")
    op.execute("alter table app.notifications drop constraint notifications_event_check")
    op.execute("""alter table app.notifications add constraint notifications_event_check
        check (event in ('assigned','submitted','completed','changes_requested'))""")
    op.execute("alter table app.notifications alter column task_id set not null")
    op.execute("alter table app.notifications drop column plan_id")
    op.execute("alter table app.tasks drop column estimated_hours")
