"""Create the Postgres tables for the course-unit/assignment store.

Usage:
    python scripts/init_db.py

Reads DATABASE_URL the same way deeptutor.services.db.engine does (Railway
injects it automatically; falls back to the local docker-compose postgres
service otherwise).

Judgment call, noted in devin-handoff/DATABASE_MIGRATION_PLAN.md: for this
initial rollout - a brand-new schema, zero existing production rows to
migrate around - a plain create_all() bootstrap is the right amount of
tooling. Add Alembic the first time this schema needs a real migration
against live data, not before.
"""

from __future__ import annotations

import asyncio

from deeptutor.services.db.engine import dispose_engine, get_engine
from deeptutor.services.db.models import Base


async def main() -> None:
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await dispose_engine()
    print("Tables created (or already existed):")
    for table in Base.metadata.sorted_tables:
        print(f"  - {table.name}")


if __name__ == "__main__":
    asyncio.run(main())
