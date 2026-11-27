"""HR role: sees every internship of the workspace, its work, projects and Jira, and progress reports. Read-only.

HR cannot review, publish plans, assign in Jira, share reports or manage members. The Jira tables are written only
by the server's sync, which HR may trigger when a board is stale, so HR is added to those policies too.
"""
from alembic import op
from sqlalchemy import text

revision = "0030_hr_role"
down_revision = "0029_member_emails"
branch_labels = None
depends_on = None

ADMIN = "(m.role = 'admin'::text)"
ADMIN_HR = "(m.role = ANY (ARRAY['admin'::text, 'hr'::text]))"
STAFF = "ARRAY['admin'::text, 'mentor'::text]"
STAFF_HR = "ARRAY['admin'::text, 'mentor'::text, 'hr'::text]"
# (table, policy, text before, text after); each "before" must occur in the policy.
POLICIES = [
    ("internships", "read_internships", ADMIN, ADMIN_HR),
    ("jira_issues", "jira_issues_staff", STAFF, STAFF_HR),
    ("jira_events", "jira_events_staff", STAFF, STAFF_HR),
    ("projects", "project_read", STAFF, STAFF_HR),
    ("progress_reports", "report_read", ADMIN, ADMIN_HR),
]
FUNCTIONS = [
    ("app.internship_people(uuid)", "(a.role = 'admin'", "(a.role in ('admin','hr')"),
    ("app.set_member_role(uuid,uuid,text)", "('admin','mentor','intern')", "('admin','mentor','intern','hr')"),
]
BRIEF_READ = """create policy project_briefs_hr_read on app.project_briefs for select to internagent_runtime using (
    exists (select 1 from app.memberships m where m.org_id = project_briefs.org_id and m.active and m.role = 'hr'
        and m.user_id = nullif(current_setting('internagent.actor_id', true), '')::uuid))"""


def swap_policy(table, name, old, new):
    row = op.get_bind().execute(text("""
        select cmd, qual, with_check from pg_policies where schemaname='app' and tablename=:t and policyname=:p
    """), {"t": table, "p": name}).one()
    assert old in (row.qual or "") + (row.with_check or ""), (table, name)
    using = f" using ({row.qual.replace(old, new)})" if row.qual else ""
    check = f" with check ({row.with_check.replace(old, new)})" if row.with_check else ""
    op.execute(f"drop policy {name} on app.{table}")
    op.execute(f"create policy {name} on app.{table} for {row.cmd} to internagent_runtime{using}{check}")


def swap_function(signature, old, new):
    definition = op.get_bind().execute(text("select pg_get_functiondef(cast(:f as regprocedure))"), {"f": signature}).scalar()
    assert old in definition, signature
    op.execute(text(definition.replace(old, new)).execution_options(no_parameters=True))


def upgrade():
    op.execute("alter table app.memberships drop constraint memberships_role_check")
    op.execute("alter table app.memberships add constraint memberships_role_check check (role in ('admin','mentor','intern','hr'))")
    for table, name, old, new in POLICIES:
        swap_policy(table, name, old, new)
    for signature, old, new in FUNCTIONS:
        swap_function(signature, old, new)
    op.execute(BRIEF_READ)


def downgrade():
    if op.get_bind().execute(text("select 1 from app.memberships where role='hr' limit 1")).first():
        raise RuntimeError("Change the HR members to another role before downgrading.")
    op.execute("drop policy project_briefs_hr_read on app.project_briefs")
    for signature, old, new in FUNCTIONS:
        swap_function(signature, new, old)
    for table, name, old, new in POLICIES:
        swap_policy(table, name, new, old)
    op.execute("alter table app.memberships drop constraint memberships_role_check")
    op.execute("alter table app.memberships add constraint memberships_role_check check (role in ('admin','mentor','intern'))")
