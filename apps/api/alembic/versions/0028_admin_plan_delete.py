"""Admins can delete unpublished plan drafts too, not only the assigned mentor."""
from alembic import op

revision = "0028_admin_plan_delete"
down_revision = "0027_jira_assign"
branch_labels = None
depends_on = None

ACTOR = "nullif(current_setting('internagent.actor_id',true),'')::uuid"
MENTOR = f"""exists (select 1 from app.internships i join app.memberships m
    on m.org_id=i.org_id and m.user_id=i.mentor_id
    where i.id=plans.internship_id and m.active and m.role='mentor' and m.user_id={ACTOR})"""
ADMIN = f"""exists (select 1 from app.internships i join app.memberships m on m.org_id=i.org_id
    where i.id=plans.internship_id and m.active and m.role='admin' and m.user_id={ACTOR})"""


def upgrade():
    op.execute("drop policy plan_delete on app.plans")
    op.execute(f"create policy plan_delete on app.plans for delete to internagent_runtime using (({MENTOR} or {ADMIN}) and published_at is null)")


def downgrade():
    op.execute("drop policy plan_delete on app.plans")
    op.execute(f"create policy plan_delete on app.plans for delete to internagent_runtime using ({MENTOR} and published_at is null)")
