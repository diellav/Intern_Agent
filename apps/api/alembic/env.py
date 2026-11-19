from alembic import context
from sqlalchemy import create_engine, pool

from app.main import settings


def run_migrations() -> None:
    url = settings().migration_database_url
    if not url:
        raise RuntimeError("Set MIGRATION_DATABASE_URL before running Alembic.")

    if context.is_offline_mode():
        context.configure(url=url, literal_binds=True)
        with context.begin_transaction():
            context.run_migrations()
        return

    with create_engine(url, poolclass=pool.NullPool).connect() as connection:
        context.configure(connection=connection)
        with context.begin_transaction():
            context.run_migrations()


run_migrations()
