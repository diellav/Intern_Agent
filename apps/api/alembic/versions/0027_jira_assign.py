"""Jira assistant: interns are linked to their Jira account, and issues are assigned to them in Jira."""
from alembic import op

revision = "0027_jira_assign"
down_revision = "0026_jira_sync"
branch_labels = None
depends_on = None

ACTOR = "nullif(current_setting('internagent.actor_id', true), '')::uuid"


def upgrade():
    # Jira account IDs only: names and emails stay in Jira and are never sent to the AI.
    op.execute("alter table app.jira_issues add column assignee_account_id text")
    op.execute("alter table app.internships add column jira_account_id text check (jira_account_id is null or length(jira_account_id) <= 128)")
    op.execute(f"""
        create function app.set_internship_jira_account(target uuid, account text) returns text
        language plpgsql security definer set search_path = '' as $$
        begin
            update app.internships i set jira_account_id = account
            where i.id = target and exists (
                select 1 from app.memberships m where m.org_id = i.org_id and m.user_id = {ACTOR} and m.active
                and (m.role = 'admin' or (m.role = 'mentor' and i.mentor_id = m.user_id)));
            if not found then
                raise exception 'not allowed' using errcode = '42501';
            end if;
            return account;
        end
        $$
    """)
    op.execute("revoke all on function app.set_internship_jira_account(uuid, text) from public")
    op.execute("grant execute on function app.set_internship_jira_account(uuid, text) to internagent_runtime")


def downgrade():
    op.execute("drop function app.set_internship_jira_account(uuid, text)")
    op.execute("alter table app.internships drop column jira_account_id")
    op.execute("alter table app.jira_issues drop column assignee_account_id")
