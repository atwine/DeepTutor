"""Async SQLAlchemy engine + session factory for the Postgres-backed store.

Scope: currently only `course_units.py`, `assignments.py`, and `course_books.py`
(see `devin-handoff/DATABASE_MIGRATION_PLAN.md`) — everything else in this
codebase (accounts, chat history, memory, knowledge bases) stays on its
existing storage and does not touch this module.

Connection string resolution order:

1. ``DATABASE_URL`` env var — this is what Railway's Postgres plugin injects
   automatically, so a Railway deployment needs zero config here.
2. ``deeptutor-postgres`` fallback pointed at the local ``docker-compose.yml``
   ``postgres`` service, for local dev/test.

``DATABASE_URL`` conventionally arrives as ``postgres://...`` or
``postgresql://...`` (the scheme Railway/Heroku-style providers use);
SQLAlchemy's asyncpg dialect needs the explicit ``postgresql+asyncpg://``
scheme, so that substitution happens here once rather than in every caller.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

_LOCAL_DEV_DEFAULT = (
    "postgresql+asyncpg://deeptutor:deeptutor@postgres:5432/deeptutor"
)


def _resolve_database_url() -> str:
    raw = os.environ.get("DATABASE_URL", "").strip()
    if not raw:
        return _LOCAL_DEV_DEFAULT
    # Railway/Heroku-style URLs use `postgres://` or plain `postgresql://`;
    # the asyncpg dialect needs the driver named explicitly.
    if raw.startswith("postgres://"):
        raw = "postgresql+asyncpg://" + raw[len("postgres://") :]
    elif raw.startswith("postgresql://"):
        raw = "postgresql+asyncpg://" + raw[len("postgresql://") :]
    return raw


_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    """Lazily create the process-wide async engine.

    One engine per process, matching this codebase's existing single-process
    deployment assumption (same assumption the old ``threading.Lock``-per-file
    stores made — the difference is that Postgres's own transactions, not an
    in-process object, are what make this correct if that assumption is ever
    lifted, e.g. multiple Railway replicas).
    """
    global _engine
    if _engine is None:
        _engine = create_async_engine(_resolve_database_url(), pool_pre_ping=True)
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            get_engine(), expire_on_commit=False, autoflush=False
        )
    return _session_factory


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """One transaction per call: commits on clean exit, rolls back on
    exception. This is the short-transaction building block Track 3
    (`assignments.py`) needs for the advisory-lock submit flow — a
    transaction must NOT stay open across the LLM grading call, so callers
    doing that flow open two separate `session_scope()` blocks around the
    call rather than one long one."""
    factory = get_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def dispose_engine() -> None:
    """Close all pooled connections. Call on app shutdown; also useful in
    tests that spin up/tear down a database per test run."""
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None
