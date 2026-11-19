from alembic import op

revision = "0002_programs"
down_revision = "0001_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE app.programs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id uuid NOT NULL REFERENCES app.organizations(id),
            name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
            description text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (org_id, name)
        )
    """)
    op.execute("ALTER TABLE app.programs ENABLE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY member_programs ON app.programs FOR SELECT TO internagent_runtime
        USING (EXISTS (
            SELECT 1 FROM app.memberships m WHERE m.org_id = programs.org_id
            AND m.active AND m.user_id = nullif(current_setting('internagent.actor_id', true), '')::uuid
        ))
    """)
    op.execute("""
        CREATE POLICY admin_program_insert ON app.programs FOR INSERT TO internagent_runtime
        WITH CHECK (EXISTS (
            SELECT 1 FROM app.memberships m WHERE m.org_id = programs.org_id
            AND m.active AND m.role = 'admin'
            AND m.user_id = nullif(current_setting('internagent.actor_id', true), '')::uuid
        ))
    """)
    op.execute("GRANT SELECT, INSERT ON app.programs TO internagent_runtime")


def downgrade() -> None:
    op.execute("DROP TABLE app.programs")
