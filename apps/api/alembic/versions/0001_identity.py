from alembic import op

revision = "0001_identity"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA app")
    op.execute("""
        CREATE TABLE app.organizations (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            slug text NOT NULL UNIQUE,
            name text NOT NULL CHECK (length(trim(name)) > 0)
        )
    """)
    op.execute("""
        CREATE TABLE app.memberships (
            org_id uuid NOT NULL REFERENCES app.organizations(id),
            user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
            role text NOT NULL CHECK (role IN ('admin', 'mentor', 'intern')),
            active boolean NOT NULL DEFAULT true,
            PRIMARY KEY (org_id, user_id)
        )
    """)
    op.execute("CREATE INDEX memberships_active_actor_idx ON app.memberships(user_id, org_id) WHERE active")
    op.execute("ALTER TABLE app.memberships ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE app.organizations ENABLE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY own_active_memberships ON app.memberships
        FOR SELECT TO internagent_runtime
        USING (active AND user_id = nullif(current_setting('internagent.actor_id', true), '')::uuid)
    """)
    op.execute("""
        CREATE POLICY own_organizations ON app.organizations
        FOR SELECT TO internagent_runtime
        USING (EXISTS (
            SELECT 1 FROM app.memberships
            WHERE memberships.org_id = organizations.id
            AND memberships.active
            AND memberships.user_id = nullif(current_setting('internagent.actor_id', true), '')::uuid
        ))
    """)
    op.execute("GRANT USAGE ON SCHEMA app TO internagent_runtime")
    op.execute("GRANT SELECT ON app.organizations, app.memberships TO internagent_runtime")


def downgrade() -> None:
    op.execute("DROP TABLE app.memberships CASCADE")
    op.execute("DROP TABLE app.organizations")
    op.execute("DROP SCHEMA app")
