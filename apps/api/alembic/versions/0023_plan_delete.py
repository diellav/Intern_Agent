from alembic import op

revision = "0023_plan_delete"
down_revision = "0022_mentor_cv"
branch_labels = None
depends_on = None


def upgrade():
    # Only unpublished drafts can be deleted, and only by the internship's assigned mentor.
    mentor = """exists (select 1 from app.internships i join app.memberships m
        on m.org_id=i.org_id and m.user_id=i.mentor_id
        where i.id=plans.internship_id and m.active and m.role='mentor'
        and m.user_id=nullif(current_setting('internagent.actor_id',true),'')::uuid)"""
    op.execute(f"create policy plan_delete on app.plans for delete to internagent_runtime using ({mentor} and published_at is null)")
    op.execute("grant delete on app.plans to internagent_runtime")


def downgrade():
    op.execute("revoke delete on app.plans from internagent_runtime")
    op.execute("drop policy plan_delete on app.plans")
