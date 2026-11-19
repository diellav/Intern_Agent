from alembic import op

revision = "0020_report_findings"
down_revision = "0019_intern_cv"
branch_labels = None
depends_on = None


def upgrade():
    # The AI summary's statements and their sources, saved with the report so they survive refresh and sharing.
    op.execute("alter table app.progress_reports add column findings jsonb not null default '[]'::jsonb")
    op.execute("grant update (findings) on app.progress_reports to internagent_runtime")


def downgrade():
    op.execute("revoke update (findings) on app.progress_reports from internagent_runtime")
    op.execute("alter table app.progress_reports drop column findings")
