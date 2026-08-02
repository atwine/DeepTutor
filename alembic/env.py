"""Alembic environment for the Postgres-backed course-unit/assignment store
(see devin-handoff/DATABASE_MIGRATION_PLAN.md).

Uses the project's own ``deeptutor.services.db.engine.get_engine()`` async
engine rather than building a fresh one from ``alembic.ini``'s
``sqlalchemy.url`` — that keeps a single source of truth for connection
resolution (DATABASE_URL env var, the postgres:// -> postgresql+asyncpg://
rewrite, and the local-dev SSL-disable workaround for the docker-compose
postgres service) instead of duplicating that logic here. ``alembic.ini``'s
``sqlalchemy.url`` is left as a placeholder and is not actually used by
``run_migrations_online()`` below; it only matters for ``--sql`` (offline)
mode, which this project does not currently rely on.
"""

import asyncio
from logging.config import fileConfig

from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from alembic import context

from deeptutor.services.db.engine import get_engine
from deeptutor.services.db.models import Base

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Autogenerate support: the project's single Base.metadata (course units,
# assignments, submissions, course-book entries, notifications — everything
# in deeptutor/services/db/models.py).
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (emits SQL to stdout, no live DB
    connection). Not the normal path for this project (see module
    docstring) but kept for completeness/parity with Alembic's template."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Reuse the project's own async engine (DATABASE_URL resolution +
    local-dev SSL workaround already handled there) and run the sync
    migration functions against it via ``run_sync`` — the standard pattern
    for driving Alembic (which is sync-only internally) off an async
    SQLAlchemy engine/connection."""
    connectable: AsyncEngine = get_engine()

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)


def run_migrations_online() -> None:
    """Run migrations in 'online' mode against the live database."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
