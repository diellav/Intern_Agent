from alembic import op

revision = "0012_own_profile"
down_revision = "0011_profiles"
branch_labels = None
depends_on = None

ACTOR = "nullif(current_setting('internagent.actor_id', true), '')::uuid"


def upgrade():
    # Each user may set only their own display name.
    op.execute(f"create policy add_own_profile on app.profiles for insert to internagent_runtime with check (user_id = {ACTOR})")
    op.execute(f"create policy edit_own_profile on app.profiles for update to internagent_runtime using (user_id = {ACTOR}) with check (user_id = {ACTOR})")
    op.execute("grant insert (user_id, full_name), update (full_name, updated_at) on app.profiles to internagent_runtime")


def downgrade():
    op.execute("revoke insert, update on app.profiles from internagent_runtime")
    op.execute("drop policy edit_own_profile on app.profiles")
    op.execute("drop policy add_own_profile on app.profiles")
