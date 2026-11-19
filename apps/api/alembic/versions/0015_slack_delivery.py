from alembic import op

revision = "0015_slack_delivery"
down_revision = "0014_members_guard"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        alter table app.notifications
            add column slack_attempts integer not null default 0,
            add column slack_next_at timestamptz,
            add column slack_result text;
        alter table app.notifications alter column slack_next_at set default now();
        create index slack_delivery_queue on app.notifications(org_id, slack_next_at)
            where slack_result is null;
        create function app.claim_slack_notification(target uuid)
        returns table(id uuid, email text, internship_id uuid, task_id uuid,
                      event text, title text, version integer, attempts integer)
        language sql security definer set search_path='' as $$
            with candidate as (
                select n.id from app.notifications n
                join app.memberships m on m.org_id=n.org_id and m.user_id=n.recipient_id
                where n.org_id=target and m.active and n.slack_result is null
                    and n.slack_next_at <= now() and n.slack_attempts < 6
                order by n.slack_next_at, n.id limit 1 for update of n skip locked
            ), claimed as (
                update app.notifications n set slack_attempts=n.slack_attempts+1,
                    slack_next_at=now()+interval '5 minutes'
                from candidate c where n.id=c.id returning n.*
            )
            select c.id, u.email::text, c.internship_id, c.task_id, c.event,
                coalesce(t.title,p.title), s.version, c.slack_attempts
            from claimed c join auth.users u on u.id=c.recipient_id
            left join app.tasks t on t.id=c.task_id
            left join app.plans p on p.id=c.plan_id
            left join app.submissions s on s.id=c.source_id and c.event in
                ('submitted','completed','changes_requested');
        $$;
        create function app.finish_slack_notification(
            target uuid, notice uuid, attempt integer, outcome text, delay_seconds integer
        ) returns void language sql security definer set search_path='' as $$
            update app.notifications set slack_result=outcome,
                slack_next_at=now()+make_interval(secs=> greatest(1,delay_seconds))
            where id=notice and org_id=target and slack_attempts=attempt and slack_result is null;
        $$;
        revoke all on function app.claim_slack_notification(uuid) from public;
        revoke all on function app.finish_slack_notification(uuid,uuid,integer,text,integer) from public;
    """)


def downgrade():
    op.execute("""
        drop function app.finish_slack_notification(uuid,uuid,integer,text,integer);
        drop function app.claim_slack_notification(uuid);
        drop index app.slack_delivery_queue;
        alter table app.notifications drop column slack_attempts,
            drop column slack_next_at, drop column slack_result;
    """)
