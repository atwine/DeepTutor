"""API for curated course notes: publishing a Book (the existing authoring
capability) to a Course Unit so its students can read it.

A Book's files live in its owning instructor's own workspace — there is no
shared Book store — so this router's read path for non-owners has to
temporarily resolve path service calls against the *owner's* workspace via
``multi_user.paths.user_context``, after verifying the requester is
authorized (course-unit manager, or an approved student and the book is
published). See ``course_books.py`` for the visibility index this all reads
from.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from deeptutor.api.routers.auth import TokenPayload, require_auth, require_instructor_or_admin
from deeptutor.multi_user.models import LOCAL_ADMIN_ID, CurrentUser

from .course_books import (
    assign_book_to_course_unit,
    get_book_entry,
    list_entries_for_course_unit,
    set_book_status,
    unassign_book,
)
from .course_units import get_course_unit, is_approved_student_of, is_instructor_of
from .paths import local_admin_user, scope_for_user, user_context

router = APIRouter()


class AssignBookRequest(BaseModel):
    course_unit_id: str


async def _manages_course_unit(current: TokenPayload, course_unit_id: str) -> bool:
    """Whether ``current`` has management access to the course unit.
    Local async version — the original in assignments_router.py will be made
    async by Track 3; this avoids a cross-track dependency."""
    return current.role == "admin" or (
        current.role == "instructor" and await is_instructor_of(current.user_id, course_unit_id)
    )


def _owner_context(owner_id: str):
    """Context manager: temporarily resolve workspace-path resolution to
    ``owner_id``'s scope, so BookEngine/BookStorage read the owner's files
    regardless of who's actually making the request. Caller must already
    have verified the requester is authorized before entering this."""
    if owner_id == LOCAL_ADMIN_ID:
        return user_context(local_admin_user())
    scope = scope_for_user(owner_id, is_admin=False)
    return user_context(CurrentUser(id=owner_id, username=owner_id, role="user", scope=scope))


def _read_book_summary(owner_id: str, book_id: str) -> dict[str, Any] | None:
    """Title/description only — for list views. Cheap, avoids loading every
    page's content just to show a library card."""
    from deeptutor.book import get_book_engine

    with _owner_context(owner_id):
        engine = get_book_engine()
        book = engine.load_book(book_id)
        if book is None:
            return None
        return {
            "id": book.id,
            "title": book.title,
            "description": book.description,
            "page_count": book.page_count,
            "chapter_count": book.chapter_count,
        }


def _read_book_full(owner_id: str, book_id: str) -> dict[str, Any] | None:
    """Book + spine + pages — the full read a student needs to actually
    read the notes. Mirrors what GET /api/v1/book/books/{book_id} returns
    for an owner reading their own book."""
    from deeptutor.book import get_book_engine

    with _owner_context(owner_id):
        engine = get_book_engine()
        book = engine.load_book(book_id)
        if book is None:
            return None
        spine = engine.load_spine(book_id)
        pages = engine.list_pages(book_id)
        return {
            "book": book.model_dump(mode="json"),
            "spine": spine.model_dump(mode="json") if spine else None,
            "pages": [p.model_dump(mode="json") for p in pages],
        }


def _book_exists_for_owner(owner_id: str, book_id: str) -> bool:
    return _read_book_summary(owner_id, book_id) is not None


@router.post("/books/{book_id}/course-unit")
async def assign_book_endpoint(
    book_id: str,
    payload: AssignBookRequest,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    """Attach one of *my own* books to a course unit I manage — draft by
    default. The book must actually exist in my own workspace (checked
    directly, no impersonation needed since the caller is the owner here)."""
    if await get_course_unit(payload.course_unit_id) is None:
        raise HTTPException(status_code=404, detail="Course unit not found")
    if not await _manages_course_unit(current, payload.course_unit_id):
        raise HTTPException(status_code=403, detail="You do not manage this course unit")
    if not _book_exists_for_owner(current.user_id, book_id):
        raise HTTPException(status_code=404, detail="Book not found in your library")
    record = await assign_book_to_course_unit(book_id, current.user_id, payload.course_unit_id)
    return {"entry": record}


@router.delete("/books/{book_id}/course-unit")
async def unassign_book_endpoint(
    book_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    entry = await get_book_entry(book_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="This book isn't assigned to a course unit")
    if not await _manages_course_unit(current, entry["course_unit_id"]):
        raise HTTPException(status_code=403, detail="You do not manage this course unit")
    await unassign_book(book_id)
    return {"ok": True}


@router.post("/books/{book_id}/publish")
async def publish_book_endpoint(
    book_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    entry = await get_book_entry(book_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="This book isn't assigned to a course unit")
    if not await _manages_course_unit(current, entry["course_unit_id"]):
        raise HTTPException(status_code=403, detail="You do not manage this course unit")
    record = await set_book_status(book_id, "published")
    return {"entry": record}


@router.post("/books/{book_id}/unpublish")
async def unpublish_book_endpoint(
    book_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    entry = await get_book_entry(book_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="This book isn't assigned to a course unit")
    if not await _manages_course_unit(current, entry["course_unit_id"]):
        raise HTTPException(status_code=403, detail="You do not manage this course unit")
    record = await set_book_status(book_id, "draft")
    return {"entry": record}


@router.get("/course-units/{course_unit_id}/books")
async def list_course_unit_books_endpoint(
    course_unit_id: str,
    current: TokenPayload | None = Depends(require_auth),
) -> dict[str, Any]:
    """Instructor/admin: every book assigned to this unit (draft + published).
    Student: published books only, and only if approved-enrolled."""
    if await get_course_unit(course_unit_id) is None:
        raise HTTPException(status_code=404, detail="Course unit not found")

    manages = current is not None and await _manages_course_unit(current, course_unit_id)
    entries = await list_entries_for_course_unit(course_unit_id)
    if not manages:
        user_id = current.user_id if current else ""
        if not await is_approved_student_of(user_id, course_unit_id):
            raise HTTPException(
                status_code=403, detail="You are not enrolled in this course unit"
            )
        entries = [e for e in entries if e["status"] == "published"]

    books = []
    for entry in entries:
        summary = _read_book_summary(entry["owner_id"], entry["book_id"])
        if summary is None:
            continue  # book was deleted from the owner's library but the index wasn't cleaned up
        books.append({**summary, "status": entry["status"], "book_id": entry["book_id"]})
    return {"books": books}


@router.get("/books/{book_id}/course-content")
async def get_course_book_content_endpoint(
    book_id: str,
    current: TokenPayload | None = Depends(require_auth),
) -> dict[str, Any]:
    """The actual read: book + spine + pages, resolved from the owner's
    workspace. A course-unit manager may preview a draft; anyone else needs
    the book to be published and themselves to be an approved student."""
    entry = await get_book_entry(book_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Book not found")

    manages = current is not None and await _manages_course_unit(current, entry["course_unit_id"])
    if not manages:
        if entry["status"] != "published":
            raise HTTPException(status_code=404, detail="Book not found")
        user_id = current.user_id if current else ""
        if not await is_approved_student_of(user_id, entry["course_unit_id"]):
            raise HTTPException(
                status_code=403, detail="You are not enrolled in this course unit"
            )

    content = _read_book_full(entry["owner_id"], book_id)
    if content is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return content
