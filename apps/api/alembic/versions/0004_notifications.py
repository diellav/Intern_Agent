from alembic import op

revision = "0004_notifications"
down_revision = "0003_workflow"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        create table app.notifications (
            id uuid primary key default gen_random_uuid(),
            org_id uuid not null references app.organizations(id),
            recipient_id uuid not null,
            internship_id uuid not null references app.internships(id),
            task_id uuid not null references app.tasks(id),
            event text not null check (event in ('assigned','submitted','completed','changes_requested')),
            source_id uuid not null,
            created_at timestamptz not null default now(),
            read_at timestamptz,
            foreign key (org_id, recipient_id) references app.memberships(org_id,user_id),
            unique (recipient_id,event,source_id)
        )
    """)
    op.execute("create index notifications_inbox on app.notifications(recipient_id,org_id,created_at desc,id desc)")
    op.execute("alter table app.notifications enable row level security")
    op.execute("""
        create policy own_notifications on app.notifications for all to internagent_runtime
        using (recipient_id=nullif(current_setting('internagent.actor_id',true),'')::uuid
            and exists (select 1 from app.memberships m where m.org_id=notifications.org_id
                and m.user_id=notifications.recipient_id and m.active))
    """)
    op.execute("grant select, update (read_at) on app.notifications to internagent_runtime")
    op.execute("""
        create function app.notify_workflow() returns trigger
        language plpgsql security definer set search_path = '' as $$
        declare
            task_key uuid;
            parent app.internships%rowtype;
            kind text;
            recipient uuid;
        begin
            if tg_table_name = 'tasks' then
                task_key := new.id;
                kind := 'assigned';
                select * into strict parent from app.internships where id=new.internship_id;
            else
                task_key := new.task_id;
                select i.* into strict parent from app.internships i
                join app.tasks t on t.internship_id=i.id where t.id=task_key;
                if tg_op = 'INSERT' then
                    kind := 'submitted';
                else
                    if new.decision is null or new.decision is not distinct from old.decision then
                        return new;
                    end if;
                    kind := new.decision;
                end if;
            end if;
            recipient := case when kind='submitted' then parent.mentor_id else parent.intern_id end;
            insert into app.notifications (org_id,recipient_id,internship_id,task_id,event,source_id)
            values (parent.org_id,recipient,parent.id,task_key,kind,new.id)
            on conflict (recipient_id,event,source_id) do nothing;
            return new;
        end
        $$
    """)
    op.execute("revoke all on function app.notify_workflow() from public")
    op.execute("create trigger notify_task after insert on app.tasks for each row execute function app.notify_workflow()")
    op.execute("create trigger notify_submission after insert or update of decision on app.submissions for each row execute function app.notify_workflow()")


def downgrade():
    op.execute("drop trigger notify_submission on app.submissions")
    op.execute("drop trigger notify_task on app.tasks")
    op.execute("drop function app.notify_workflow()")
    op.execute("drop table app.notifications")
