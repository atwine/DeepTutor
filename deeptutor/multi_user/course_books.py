"""Course-scoped visibility index for Book records (curated course notes).

Backed by Postgres via SQLAlchemy async (see DATABASE_MIGRATION_PLAN.md).
Book manifests physically live in the owning instructor's own workspace
(``deeptutor/book/storage.py`` resolves paths from the *current request's*
identity) — there is no shared, system-level Book store. This table is the
index: ``book_id -> {owner_id, course_unit_id, status}``, so a student's
request can resolve "does this book exist, who owns it, and is it published
to a course unit I'm enrolled in" before ever touching the owner's files.
The actual cross-workspace read happens in ``book_access_router.py``.

All public functions are ``async def`` — callers must ``await`` them.
Names, parameters, and return shapes (plain dicts) are unchanged.
"""

from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Any

from sqlalchemy import delete, select

from deeptutor.services.db import session_scope
from deeptutor.services.db.models import CourseBookEntry

logger = logging.getLogger(__name__)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _entry_to_dict(entry: CourseBookEntry) -> dict[str, Any]:
    """Serialize a CourseBookEntry ORM instance to the same dict shape the
    old JSON store returned."""
    return {
        "book_id": entry.book_id,
        "owner_id": entry.owner_id,
        "course_unit_id": entry.course_unit_id,
        "status": entry.status,
        "created_at": entry.created_at.isoformat() if entry.created_at else "",
        "updated_at": entry.updated_at.isoformat() if entry.updated_at else "",
    }


async def assign_book_to_course_unit(
    book_id: str, owner_id: str, course_unit_id: str
) -> dict[str, Any]:
    """Attach a book (identified by id, owned by ``owner_id``) to a course
    unit. Re-assigning to a different course unit updates it in place;
    publish status and created_at are preserved across a re-assignment rather
    than reset, so moving a book between units doesn't silently unpublish it."""
    now = datetime.now(timezone.utc)
    async with session_scope() as session:
        existing = await session.get(CourseBookEntry, book_id)
        if existing is not None:
            # Re-assignment: update only course_unit_id and updated_at.
            # Preserves status and created_at (see DATABASE_MIGRATION_PLAN.md
            # accepted corrections — re-assignment must not unpublish).
            existing.course_unit_id = course_unit_id
            existing.updated_at = now
            return _entry_to_dict(existing)
        entry = CourseBookEntry(
            book_id=book_id,
            owner_id=owner_id,
            course_unit_id=course_unit_id,
            status="draft",
            created_at=now,
            updated_at=now,
        )
        session.add(entry)
    return _entry_to_dict(entry)


async def get_book_entry(book_id: str) -> dict[str, Any] | None:
    async with session_scope() as session:
        entry = await session.get(CourseBookEntry, book_id)
        if entry is None:
            return None
    return _entry_to_dict(entry)


async def unassign_book(book_id: str) -> bool:
    async with session_scope() as session:
        result = await session.execute(
            delete(CourseBookEntry).where(CourseBookEntry.book_id == book_id)
        )
        return result.rowcount > 0


async def set_book_status(book_id: str, status: str) -> dict[str, Any] | None:
    now = datetime.now(timezone.utc)
    async with session_scope() as session:
        entry = await session.get(CourseBookEntry, book_id)
        if entry is None:
            return None
        entry.status = status
        entry.updated_at = now
    return _entry_to_dict(entry)


async def list_entries_for_course_unit(course_unit_id: str) -> list[dict[str, Any]]:
    async with session_scope() as session:
        result = await session.execute(
            select(CourseBookEntry).where(
                CourseBookEntry.course_unit_id == course_unit_id
            )
        )
        entries = result.scalars().all()
    return [_entry_to_dict(e) for e in entries]
