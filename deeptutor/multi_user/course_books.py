"""Course-scoped visibility index for Book records (curated course notes).

Book manifests physically live in the owning instructor's own workspace
(``deeptutor/book/storage.py`` resolves paths from the *current request's*
identity) — there is no shared, system-level Book store the way there is
for CourseUnit/Assignment. This index is the missing piece: a system-level
JSON record mapping ``book_id -> {owner_id, course_unit_id, status}``, so a
student's request (which has no workspace of its own containing the
instructor's book) can be resolved to "does this book exist, who owns it,
and is it published to a course unit I'm enrolled in" before ever touching
the owner's actual files. The actual cross-workspace read happens in
``book_access_router.py`` via ``multi_user.paths.user_context``.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import threading
from typing import Any

from .paths import SYSTEM_ROOT, ensure_system_dirs

logger = logging.getLogger(__name__)

_WRITE_LOCK = threading.Lock()

COURSE_BOOKS_DIR = SYSTEM_ROOT / "courses"
COURSE_BOOKS_FILE = COURSE_BOOKS_DIR / "course_books.json"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
        return loaded if isinstance(loaded, dict) else {}
    except Exception as exc:
        logger.warning("Failed to read %s: %s", path, exc)
        return {}


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def _load() -> dict[str, dict[str, Any]]:
    ensure_system_dirs()
    return _read_json(COURSE_BOOKS_FILE)


def assign_book_to_course_unit(
    book_id: str, owner_id: str, course_unit_id: str
) -> dict[str, Any]:
    """Attach a book (identified by id, owned by ``owner_id``) to a course
    unit. Re-assigning to a different course unit updates it in place;
    publish status is preserved across a re-assignment rather than reset,
    so moving a book between units doesn't silently unpublish it."""
    with _WRITE_LOCK:
        entries = _load()
        existing = entries.get(book_id)
        record = {
            "book_id": book_id,
            "owner_id": owner_id,
            "course_unit_id": course_unit_id,
            "status": existing["status"] if existing else "draft",
            "created_at": existing["created_at"] if existing else utc_now(),
            "updated_at": utc_now(),
        }
        entries[book_id] = record
        _write_json(COURSE_BOOKS_FILE, entries)
        return record


def get_book_entry(book_id: str) -> dict[str, Any] | None:
    return _load().get(book_id)


def unassign_book(book_id: str) -> bool:
    with _WRITE_LOCK:
        entries = _load()
        if book_id not in entries:
            return False
        entries.pop(book_id, None)
        _write_json(COURSE_BOOKS_FILE, entries)
        return True


def set_book_status(book_id: str, status: str) -> dict[str, Any] | None:
    with _WRITE_LOCK:
        entries = _load()
        record = entries.get(book_id)
        if record is None:
            return None
        record["status"] = status
        record["updated_at"] = utc_now()
        entries[book_id] = record
        _write_json(COURSE_BOOKS_FILE, entries)
        return record


def list_entries_for_course_unit(course_unit_id: str) -> list[dict[str, Any]]:
    return [e for e in _load().values() if e.get("course_unit_id") == course_unit_id]
