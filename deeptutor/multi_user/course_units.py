"""Course unit and enrollment storage for the optional multi-user layer.

Backed by Postgres via SQLAlchemy async (see DATABASE_MIGRATION_PLAN.md).
A ``CourseUnit`` can have more than one instructor id (co-instructors/TAs),
and the same instructor can own several course units at once — both are
many-to-many relationships stored in ``course_unit_instructors``.
``Enrollment`` is the many-to-many join between students and course units,
with a UNIQUE constraint on (course_unit_id, user_id) enforced by the DB.

All public functions are ``async def`` — callers must ``await`` them.
Names, parameters, and return shapes (plain dicts) are unchanged from the
JSON-backed version so downstream consumers (gradebook.py, grading.py) and
routers only gain ``await``, no logic changes.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import logging
from typing import Any
from uuid import uuid4

from sqlalchemy import delete, func, select
from sqlalchemy.orm import selectinload

from deeptutor.services.db import session_scope
from deeptutor.services.db.models import (
    CourseMaterial,
    CourseUnit,
    CourseUnitInstructor,
    Enrollment,
    Submission,
)

logger = logging.getLogger(__name__)

# B1: Grace period after a course unit's end_date before student access to
# assignments/notes is blocked. The repo owner suggested ~1 week — kept as a
# named constant so it's easy to tune without hunting through if-statements.
# Instructors and admins are never blocked (archival access stays forever).
COURSE_END_GRACE_PERIOD_DAYS = 7


async def _sync_course_kb_grant(user_id: str, kb_name: str | None, *, grant_access: bool) -> None:
    """Issue #57: bridge enrollment to course-material RAG access.

    A course's knowledge base lives in the admin workspace's KB store
    (``_provision_course_kb``), so an enrolled student's own per-user
    ``resolve_kb()``/``list_visible_knowledge_bases()`` check never
    authorized it — materials indexed correctly, but chat could never
    retrieve them for a student, matching the existing admin-assigned-KB
    grant mechanism used elsewhere (``load_grant``/``save_grant`` in
    ``grants.py``). Called on every enrollment-status transition that
    grants or revokes course access; a no-op if the course has no KB
    provisioned yet, or the user is an admin (admins already see every
    KB and cannot hold a grants file — see ``save_grant``).
    """
    if not kb_name:
        return
    try:
        from .grants import load_grant, save_grant
        from .identity import get_user_by_id

        record = await get_user_by_id(user_id)
        if record is None or str(record[1].get("role") or "user") == "admin":
            return
        grant = load_grant(user_id)
        kb_list = grant.setdefault("knowledge_bases", [])
        existing = [item for item in kb_list if str(item.get("name") or "") == kb_name]
        if grant_access:
            if not existing:
                kb_list.append({"name": kb_name, "resource_id": f"admin:kb:{kb_name}"})
                await save_grant(user_id, grant)
        elif existing:
            grant["knowledge_bases"] = [
                item for item in kb_list if str(item.get("name") or "") != kb_name
            ]
            await save_grant(user_id, grant)
    except Exception:
        logger.warning(
            "Failed to sync course KB grant for user %s, kb %s", user_id, kb_name, exc_info=True
        )


def new_course_unit_id() -> str:
    return f"cu_{uuid4().hex}"


def new_enrollment_id() -> str:
    return f"en_{uuid4().hex}"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_material_id() -> str:
    return f"mat_{uuid4().hex}"


# ---------------------------------------------------------------------------
# Issue #3: Auto-provision a course-specific RAG knowledge base
# ---------------------------------------------------------------------------


def _provision_course_kb(unit_id: str) -> str | None:
    """Provision an empty KB named ``course_<unit_id>`` in the admin workspace's
    knowledge-bases root, using the same initializer the KB create endpoint uses
    (see ``deeptutor/api/routers/knowledge.py:create_knowledge_base`` and
    ``deeptutor/knowledge/initializer.py:KnowledgeBaseInitializer``).

    Returns the KB name on success, or ``None`` on failure (the caller --
    ``create_course_unit`` -- does NOT block on a provisioning failure; it logs
    a warning and leaves ``kb_name`` as None so it can be provisioned later).
    The KB is created with the default RAG provider and no initial documents --
    materials are indexed incrementally as instructors upload them.
    """
    try:
        from deeptutor.knowledge.initializer import KnowledgeBaseInitializer
        from deeptutor.knowledge.progress_tracker import ProgressTracker
        from deeptutor.multi_user.knowledge_access import admin_kb_base_dir

        kb_name = f"course_{unit_id}"
        base_dir_path = admin_kb_base_dir().resolve()
        base_dir = str(base_dir_path)
        # ProgressTracker joins base_dir / kb_name internally, so it needs a
        # Path, not the str KnowledgeBaseInitializer expects.
        progress_tracker = ProgressTracker(kb_name, base_dir_path)
        initializer = KnowledgeBaseInitializer(
            kb_name=kb_name,
            base_dir=base_dir,
            progress_tracker=progress_tracker,
        )
        # create_directory_structure mkdir-s raw/ and registers the KB in
        # kb_config.json with an "initializing" status -- no documents are
        # processed here (the KB starts empty; materials are added later).
        initializer.create_directory_structure()
        # Flip the KB to "ready" since there are no documents to index.
        from deeptutor.knowledge.manager import KnowledgeBaseManager

        manager = KnowledgeBaseManager(base_dir=base_dir)
        manager.update_kb_status(name=kb_name, status="ready")
        return kb_name
    except Exception as exc:
        logger.warning(
            "Failed to auto-provision course KB for unit %s: %s", unit_id, exc
        )
        return None


def _unit_to_dict(unit: CourseUnit) -> dict[str, Any]:
    """Serialize a CourseUnit ORM instance to the same dict shape the old
    JSON store returned — preserves backward compatibility for all callers."""
    return {
        "id": unit.id,
        "name": unit.name,
        "term": unit.term,
        "description": unit.description,
        "start_date": unit.start_date or "",
        "end_date": unit.end_date or "",
        "is_archived": bool(unit.is_archived),
        "instructor_ids": [i.instructor_id for i in unit.instructors],
        "created_at": unit.created_at.isoformat() if unit.created_at else "",
        # Issue #3: the auto-provisioned KB name for this course unit. "" when
        # no KB has been provisioned yet (existing units or a failed provision).
        "kb_name": unit.kb_name or "",
    }


def _enrollment_to_dict(enrollment: Enrollment) -> dict[str, Any]:
    """Serialize an Enrollment ORM instance to the same dict shape."""
    return {
        "id": enrollment.id,
        "course_unit_id": enrollment.course_unit_id,
        "user_id": enrollment.user_id,
        "status": enrollment.status,
        "created_at": enrollment.created_at.isoformat() if enrollment.created_at else "",
        "approved_at": enrollment.approved_at.isoformat() if enrollment.approved_at else "",
        # Issue #4: when the student completed the unit (all published
        # assignments submitted+graded). "" means not yet completed.
        "completed_at": enrollment.completed_at.isoformat() if enrollment.completed_at else "",
    }


# ---------------------------------------------------------------------------
# Course units
# ---------------------------------------------------------------------------


async def create_course_unit(
    name: str,
    term: str,
    instructor_ids: list[str],
    description: str = "",
    *,
    start_date: str = "",
    end_date: str = "",
) -> dict[str, Any]:
    unit_id = new_course_unit_id()
    now = datetime.now(timezone.utc)
    clean_ids = [str(uid) for uid in instructor_ids if str(uid).strip()]
    # Issue #3: Auto-provision a course-specific RAG KB. Done before the DB
    # insert so the KB name can be stored on the CourseUnit row in one write.
    # Failures are non-fatal -- the unit is still created with kb_name=None and
    # the KB can be provisioned later (see ``provision_course_kb_for_unit``).
    kb_name = _provision_course_kb(unit_id)
    async with session_scope() as session:
        unit = CourseUnit(
            id=unit_id,
            name=name,
            term=term,
            description=description,
            start_date=start_date or None,
            end_date=end_date or None,
            created_at=now,
            kb_name=kb_name,
        )
        session.add(unit)
        await session.flush()
        for uid in clean_ids:
            session.add(CourseUnitInstructor(course_unit_id=unit_id, instructor_id=uid))
        await session.flush()
        # Eagerly load instructors for serialization
        await session.refresh(unit, ["instructors"])
    return _unit_to_dict(unit)


async def list_course_units(
    *, limit: int = 50, offset: int = 0
) -> list[dict[str, Any]]:
    async with session_scope() as session:
        result = await session.execute(
            select(CourseUnit)
            .options(selectinload(CourseUnit.instructors))
            .order_by(CourseUnit.created_at)
            .limit(limit)
            .offset(offset)
        )
        units = result.scalars().unique().all()
    return [_unit_to_dict(u) for u in units]


async def count_course_units() -> int:
    async with session_scope() as session:
        result = await session.execute(select(func.count(CourseUnit.id)))
        return int(result.scalar() or 0)


async def get_course_unit(course_unit_id: str) -> dict[str, Any] | None:
    async with session_scope() as session:
        unit = await session.get(CourseUnit, course_unit_id)
        if unit is None:
            return None
        await session.refresh(unit, ["instructors"])
    return _unit_to_dict(unit)


async def update_course_unit(
    course_unit_id: str,
    *,
    name: str | None = None,
    term: str | None = None,
    description: str | None = None,
    instructor_ids: list[str] | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict[str, Any] | None:
    async with session_scope() as session:
        unit = await session.get(CourseUnit, course_unit_id)
        if unit is None:
            return None
        if name is not None:
            unit.name = name
        if term is not None:
            unit.term = term
        if description is not None:
            unit.description = description
        if start_date is not None:
            unit.start_date = start_date or None
        if end_date is not None:
            unit.end_date = end_date or None
        if instructor_ids is not None:
            # Replace instructor list: delete existing, insert new
            await session.execute(
                delete(CourseUnitInstructor).where(
                    CourseUnitInstructor.course_unit_id == course_unit_id
                )
            )
            clean_ids = [str(uid) for uid in instructor_ids if str(uid).strip()]
            for uid in clean_ids:
                session.add(CourseUnitInstructor(course_unit_id=course_unit_id, instructor_id=uid))
        await session.flush()
        await session.refresh(unit, ["instructors"])
    return _unit_to_dict(unit)


async def delete_course_unit(course_unit_id: str) -> bool:
    """Delete a course unit. ON DELETE CASCADE on foreign keys automatically
    removes all enrollments, assignments (+ their submissions), and
    course-book entries — no manual sweep needed."""
    async with session_scope() as session:
        unit = await session.get(CourseUnit, course_unit_id)
        if unit is None:
            return False
        await session.delete(unit)
    return True


async def archive_course_unit(course_unit_id: str) -> dict[str, Any] | None:
    """Round 3: Mark a course unit archived. Does not touch enrollments,
    assignments, or submissions — this is a pure flag flip. Student access
    blocking is derived from the flag by ``_is_student_access_expired``
    (see below), not stored redundantly anywhere else. Returns None if the
    course unit doesn't exist."""
    async with session_scope() as session:
        unit = await session.get(CourseUnit, course_unit_id)
        if unit is None:
            return None
        unit.is_archived = True
        await session.flush()
        await session.refresh(unit, ["instructors"])
    return _unit_to_dict(unit)


async def unarchive_course_unit(course_unit_id: str) -> dict[str, Any] | None:
    """Round 3: Reverse of ``archive_course_unit``. Returns None if the
    course unit doesn't exist."""
    async with session_scope() as session:
        unit = await session.get(CourseUnit, course_unit_id)
        if unit is None:
            return None
        unit.is_archived = False
        await session.flush()
        await session.refresh(unit, ["instructors"])
    return _unit_to_dict(unit)


async def is_instructor_of(user_id: str, course_unit_id: str) -> bool:
    async with session_scope() as session:
        result = await session.execute(
            select(CourseUnitInstructor).where(
                CourseUnitInstructor.course_unit_id == course_unit_id,
                CourseUnitInstructor.instructor_id == str(user_id),
            )
        )
        return result.scalar_one_or_none() is not None


def _is_student_access_expired(unit: CourseUnit) -> bool:
    """B1/Round 3: Check whether student access to this course unit has
    expired.

    Returns True if either:
    - the unit is archived (Round 3) — an archived course always reads as
      blocked-for-students regardless of dates, the same way an expired
      course reads as blocked past its grace period. Reusing this single
      check (rather than a second parallel "am I blocked" predicate) keeps
      the "archival access never disappears for the people who need the
      record" guarantee identical for both cases: instructors/admins call
      ``is_instructor_of``/admin-role checks instead of this function, so
      they're never affected by either condition.
    - ``end_date`` is set and the current UTC date is past
      ``end_date + COURSE_END_GRACE_PERIOD_DAYS``.

    Returns False if the unit isn't archived and ``end_date`` is not set
    (no expiry configured) or we're still within the grace period.

    ``end_date`` is stored as a string (e.g. "2026-12-31") to match the
    frontend date input format; we parse it with ``datetime.strptime`` for
    the comparison. An unparseable ``end_date`` is treated as "not expired"
    (fail-open) so a malformed date doesn't lock students out.
    """
    if unit.is_archived:
        return True
    end_str = unit.end_date
    if not end_str:
        return False
    try:
        end_date = datetime.strptime(end_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        logger.warning("Unparseable end_date %r on course unit %s — treating as not expired", end_str, unit.id)
        return False
    now = datetime.now(timezone.utc)
    grace_end = end_date + timedelta(days=COURSE_END_GRACE_PERIOD_DAYS)
    return now > grace_end


async def is_approved_student_of(user_id: str, course_unit_id: str) -> bool:
    """Whether ``user_id`` has an *approved* enrollment in this course unit —
    a pending request doesn't grant access to assignments any more than it
    grants access to the course units list.

    B1: Also returns False if the course unit's ``end_date`` +
    ``COURSE_END_GRACE_PERIOD_DAYS`` has passed, or (Round 3) if the course
    unit is archived — student access to assignments/notes is blocked in
    both cases, while instructor/admin archival access (via
    ``is_instructor_of``/admin role) is never blocked. The student still
    sees the course in their ``list_course_units_for_student`` (that
    function doesn't call this check) — they just can't take new actions
    on it."""
    async with session_scope() as session:
        result = await session.execute(
            select(Enrollment).where(
                Enrollment.course_unit_id == course_unit_id,
                Enrollment.user_id == str(user_id),
                Enrollment.status == "approved",
            )
        )
        enrollment = result.scalar_one_or_none()
        if enrollment is None:
            return False
        # B1: Check course-unit expiry — join to get the unit's end_date.
        unit = await session.get(CourseUnit, course_unit_id)
        if unit is not None and _is_student_access_expired(unit):
            return False
        return True


async def list_course_units_for_instructor(
    user_id: str, *, limit: int = 50, offset: int = 0
) -> list[dict[str, Any]]:
    async with session_scope() as session:
        result = await session.execute(
            select(CourseUnit)
            .options(selectinload(CourseUnit.instructors))
            .join(CourseUnitInstructor)
            .where(CourseUnitInstructor.instructor_id == str(user_id))
            .order_by(CourseUnit.created_at)
            .limit(limit)
            .offset(offset)
        )
        units = result.scalars().unique().all()
    return [_unit_to_dict(u) for u in units]


async def count_course_units_for_instructor(user_id: str) -> int:
    async with session_scope() as session:
        result = await session.execute(
            select(func.count())
            .select_from(CourseUnit)
            .join(CourseUnitInstructor)
            .where(CourseUnitInstructor.instructor_id == str(user_id))
        )
        return int(result.scalar() or 0)


async def list_course_units_for_student(
    user_id: str, *, limit: int = 50, offset: int = 0
) -> list[dict[str, Any]]:
    """Units ``user_id`` has *approved* access to — a pending request alone
    doesn't grant it."""
    async with session_scope() as session:
        result = await session.execute(
            select(CourseUnit)
            .options(selectinload(CourseUnit.instructors))
            .join(Enrollment)
            .where(
                Enrollment.user_id == str(user_id),
                Enrollment.status == "approved",
            )
            .order_by(CourseUnit.created_at)
            .limit(limit)
            .offset(offset)
        )
        units = result.scalars().unique().all()
    return [_unit_to_dict(u) for u in units]


async def count_course_units_for_student(user_id: str) -> int:
    async with session_scope() as session:
        result = await session.execute(
            select(func.count())
            .select_from(CourseUnit)
            .join(Enrollment)
            .where(
                Enrollment.user_id == str(user_id),
                Enrollment.status == "approved",
            )
        )
        return int(result.scalar() or 0)


# ---------------------------------------------------------------------------
# Enrollments
# ---------------------------------------------------------------------------


async def enroll_student(course_unit_id: str, user_id: str) -> dict[str, Any] | None:
    """Instructor/admin directly enrolls a student — always ends up approved.
    The manual fallback path (e.g. the student can't reach the platform
    themselves, or an instructor is confirming someone in person). If the
    student already has a *pending* request, this approves it in place
    (an instructor clicking "Enroll" on someone who already asked should
    obviously let them in, not silently no-op); an already-approved
    enrollment is left as-is. Returns None if the course unit doesn't exist."""
    now = datetime.now(timezone.utc)
    async with session_scope() as session:
        unit = await session.get(CourseUnit, course_unit_id)
        if unit is None:
            return None
        result = await session.execute(
            select(Enrollment).where(
                Enrollment.course_unit_id == course_unit_id,
                Enrollment.user_id == str(user_id),
            )
        )
        existing = result.scalar_one_or_none()
        if existing is not None:
            if existing.status != "approved":
                existing.status = "approved"
                existing.approved_at = now
            kb_name = unit.kb_name
        else:
            enrollment = Enrollment(
                id=new_enrollment_id(),
                course_unit_id=course_unit_id,
                user_id=str(user_id),
                status="approved",
                created_at=now,
                approved_at=now,
            )
            session.add(enrollment)
            kb_name = unit.kb_name
    await _sync_course_kb_grant(str(user_id), kb_name, grant_access=True)
    return _enrollment_to_dict(existing if existing is not None else enrollment)


class CourseUnitArchivedError(Exception):
    """Round 3: raised by ``request_enrollment`` when a student with no
    existing enrollment tries to join an archived course unit. An existing
    enrollment (any status) is left alone — this only blocks *new* joins,
    matching the "archived courses aren't joinable, already-enrolled access
    reads like an expired course" access model documented in DEVIN_LOG.md."""


async def request_enrollment(course_unit_id: str, user_id: str) -> dict[str, Any] | None:
    """Student-initiated: creates a ``pending`` enrollment for the instructor
    to approve or reject. Idempotent — an existing enrollment of either
    status (already pending, or already approved) is returned unchanged, so
    re-requesting can't downgrade an approved student back to pending.
    Returns None if the course unit doesn't exist. Raises
    ``CourseUnitArchivedError`` (Round 3) if the unit is archived and the
    student has no existing enrollment to fall back on — an archived course
    shouldn't be joinable by someone new."""
    now = datetime.now(timezone.utc)
    async with session_scope() as session:
        unit = await session.get(CourseUnit, course_unit_id)
        if unit is None:
            return None
        result = await session.execute(
            select(Enrollment).where(
                Enrollment.course_unit_id == course_unit_id,
                Enrollment.user_id == str(user_id),
            )
        )
        existing = result.scalar_one_or_none()
        if existing is not None:
            return _enrollment_to_dict(existing)
        if unit.is_archived:
            raise CourseUnitArchivedError(course_unit_id)
        enrollment = Enrollment(
            id=new_enrollment_id(),
            course_unit_id=course_unit_id,
            user_id=str(user_id),
            status="pending",
            created_at=now,
            approved_at=None,
        )
        session.add(enrollment)
    return _enrollment_to_dict(enrollment)


async def approve_enrollment(course_unit_id: str, user_id: str) -> dict[str, Any] | None:
    """Approve a pending enrollment request. Returns None if there is no
    matching pending request (already approved, rejected/removed, or never
    requested)."""
    now = datetime.now(timezone.utc)
    async with session_scope() as session:
        result = await session.execute(
            select(Enrollment).where(
                Enrollment.course_unit_id == course_unit_id,
                Enrollment.user_id == str(user_id),
                Enrollment.status == "pending",
            )
        )
        enrollment = result.scalar_one_or_none()
        if enrollment is None:
            return None
        enrollment.status = "approved"
        enrollment.approved_at = now
        unit = await session.get(CourseUnit, course_unit_id)
        kb_name = unit.kb_name if unit is not None else None
    await _sync_course_kb_grant(str(user_id), kb_name, grant_access=True)
    return _enrollment_to_dict(enrollment)


# ---------------------------------------------------------------------------
# Leave requests (B2) — student-initiated unenroll with instructor confirmation
# ---------------------------------------------------------------------------


async def request_leave(course_unit_id: str, user_id: str) -> dict[str, Any] | None:
    """B2: Student-initiated leave request. Sets an approved enrollment's
    status to ``leave_requested`` for the instructor to confirm or reject.
    Returns None if the student has no enrollment in this course unit.
    Idempotent — re-requesting leave on an already-leave-requested enrollment
    returns it unchanged (matches ``request_enrollment``'s idempotency
    pattern). Does NOT remove the enrollment or any submissions — the
    instructor must confirm before the student is actually unenrolled."""
    async with session_scope() as session:
        result = await session.execute(
            select(Enrollment).where(
                Enrollment.course_unit_id == course_unit_id,
                Enrollment.user_id == str(user_id),
            )
        )
        enrollment = result.scalar_one_or_none()
        if enrollment is None:
            return None
        # Only transition from approved -> leave_requested. An already-
        # leave_requested enrollment is returned unchanged (idempotent);
        # a pending enrollment can't request leave (student isn't in yet).
        if enrollment.status == "approved":
            enrollment.status = "leave_requested"
    return _enrollment_to_dict(enrollment)


async def approve_leave(course_unit_id: str, user_id: str) -> bool:
    """B2: Instructor confirms a leave request — removes the Enrollment row
    (the student stops appearing on the active roster and can't see/take new
    assignments). Does NOT delete the student's existing Submission rows —
    those stay for grading history/audit integrity (see B2 decision in
    DEVIN_LOG.md). Returns False if there is no leave_requested enrollment."""
    async with session_scope() as session:
        result = await session.execute(
            select(Enrollment).where(
                Enrollment.course_unit_id == course_unit_id,
                Enrollment.user_id == str(user_id),
                Enrollment.status == "leave_requested",
            )
        )
        enrollment = result.scalar_one_or_none()
        if enrollment is None:
            return False
        await session.delete(enrollment)
        unit = await session.get(CourseUnit, course_unit_id)
        kb_name = unit.kb_name if unit is not None else None
    await _sync_course_kb_grant(str(user_id), kb_name, grant_access=False)
    return True


async def reject_leave(course_unit_id: str, user_id: str) -> dict[str, Any] | None:
    """B2: Instructor rejects a leave request — reverts the enrollment status
    back to ``approved``. Returns None if there is no leave_requested
    enrollment."""
    async with session_scope() as session:
        result = await session.execute(
            select(Enrollment).where(
                Enrollment.course_unit_id == course_unit_id,
                Enrollment.user_id == str(user_id),
                Enrollment.status == "leave_requested",
            )
        )
        enrollment = result.scalar_one_or_none()
        if enrollment is None:
            return None
        enrollment.status = "approved"
        unit = await session.get(CourseUnit, course_unit_id)
        kb_name = unit.kb_name if unit is not None else None
    await _sync_course_kb_grant(str(user_id), kb_name, grant_access=True)
    return _enrollment_to_dict(enrollment)


async def list_leave_requests_for_course(course_unit_id: str) -> list[dict[str, Any]]:
    """B2: Leave-requested enrollments awaiting instructor confirmation."""
    async with session_scope() as session:
        result = await session.execute(
            select(Enrollment).where(
                Enrollment.course_unit_id == course_unit_id,
                Enrollment.status == "leave_requested",
            )
        )
        enrollments = result.scalars().all()
    return [_enrollment_to_dict(e) for e in enrollments]


async def unenroll_student(course_unit_id: str, user_id: str) -> bool:
    async with session_scope() as session:
        result = await session.execute(
            delete(Enrollment).where(
                Enrollment.course_unit_id == course_unit_id,
                Enrollment.user_id == str(user_id),
            )
        )
        removed = result.rowcount > 0
        unit = await session.get(CourseUnit, course_unit_id) if removed else None
        kb_name = unit.kb_name if unit is not None else None
    if removed:
        await _sync_course_kb_grant(str(user_id), kb_name, grant_access=False)
    return removed


async def list_enrollments_for_course(
    course_unit_id: str, *, limit: int = 0, offset: int = 0
) -> list[dict[str, Any]]:
    """Enrollments for a course unit. Issue #41: optional limit/offset
    for pagination — when limit=0 (default), returns all rows (backward
    compatible with callers that don't paginate)."""
    async with session_scope() as session:
        stmt = select(Enrollment).where(Enrollment.course_unit_id == course_unit_id)
        if limit > 0:
            stmt = stmt.limit(limit).offset(offset)
        result = await session.execute(stmt)
        enrollments = result.scalars().all()
    return [_enrollment_to_dict(e) for e in enrollments]


async def count_enrollments_for_course(course_unit_id: str, *, status: str = "") -> int:
    async with session_scope() as session:
        stmt = select(func.count(Enrollment.id)).where(
            Enrollment.course_unit_id == course_unit_id
        )
        if status:
            stmt = stmt.where(Enrollment.status == status)
        result = await session.execute(stmt)
        return int(result.scalar() or 0)


async def list_enrollments_for_student(user_id: str) -> list[dict[str, Any]]:
    async with session_scope() as session:
        result = await session.execute(
            select(Enrollment).where(Enrollment.user_id == str(user_id))
        )
        enrollments = result.scalars().all()
    return [_enrollment_to_dict(e) for e in enrollments]


# ---------------------------------------------------------------------------
# Issue #4: Automatic course-unit completion tracking
# ---------------------------------------------------------------------------


async def check_and_mark_completion(
    course_unit_id: str,
    user_id: str,
    *,
    published_assignments: list[dict[str, Any]] | None = None,
    submission_batch: dict[tuple[str, str], dict[str, Any]] | None = None,
) -> str:
    """Issue #4: A student is automatically marked complete with a course
    unit when every published assignment for it has a graded submission from
    them. Submissions are always graded at submit time (``Submission.score``
    is NOT NULL — see assignments.py's submit flow), so "submitted AND
    graded" reduces to "has a latest submission". A unit with no published
    assignments is never auto-completed (there's no work to finish).

    When the check passes, ``enrollment.completed_at`` is set to now (if not
    already set — idempotent) and the ISO timestamp is returned. Returns ""
    when the student is not yet complete or has no enrollment. Completion is
    additive: it never revokes the student's read access to course materials.

    Issue #31: The optional ``published_assignments`` and ``submission_batch``
    parameters let callers that already have this data (e.g.
    ``build_gradebook``) skip the per-student re-fetch — eliminating the
    secondary N+1 that was the real bottleneck. When omitted, the function
    falls back to fetching them itself (the original behavior, used by the
    submit flow where only one student is checked).
    """
    # Local import to keep the module's import graph unchanged at load time
    # (assignments.py does not import this module, so there's no cycle, but
    # mirroring the lazy-import pattern already used elsewhere in this layer
    # keeps the diff minimal and avoids any load-order surprise).
    from .assignments import get_latest_submission, list_assignments_for_course

    if published_assignments is not None:
        published = published_assignments
    else:
        published = [
            a for a in await list_assignments_for_course(course_unit_id) if a["status"] == "published"
        ]
    # Issue #32: optional/bonus assignments don't block completion — only
    # required (non-optional) published assignments must be submitted.
    required = [a for a in published if not a.get("is_optional", False)]
    if not required:
        return ""
    for assignment in required:
        if submission_batch is not None:
            submission = submission_batch.get((assignment["id"], str(user_id)))
        else:
            submission = await get_latest_submission(assignment["id"], user_id)
        if submission is None:
            return ""  # not all required assignments submitted+graded yet
    # All published assignments have a graded submission — mark complete.
    now = datetime.now(timezone.utc)
    async with session_scope() as session:
        result = await session.execute(
            select(Enrollment).where(
                Enrollment.course_unit_id == course_unit_id,
                Enrollment.user_id == str(user_id),
            )
        )
        enrollment = result.scalar_one_or_none()
        if enrollment is None:
            return ""
        if enrollment.completed_at is None:
            enrollment.completed_at = now
            await session.flush()
        return enrollment.completed_at.isoformat() if enrollment.completed_at else ""


async def check_and_mark_completion_batch(
    course_unit_id: str,
    user_ids: list[str],
    published_assignments: list[dict[str, Any]],
    submission_batch: dict[tuple[str, str], dict[str, Any]],
) -> dict[str, str]:
    """Issue #31: Batched version of :func:`check_and_mark_completion` —
    checks and marks completion for *all* students in a course unit in a
    **single DB query** (one SELECT for all enrollments + one UPDATE for
    newly-complete ones), instead of one session per student.

    Returns a dict mapping ``user_id`` → ``completed_at`` ISO string (or
    ``""`` if not complete). The caller (``build_gradebook``) uses this to
    avoid the per-student N+1 that was the real bottleneck.
    """
    if not published_assignments or not user_ids:
        return {uid: "" for uid in user_ids}

    # Issue #32: optional/bonus assignments don't block completion — only
    # required (non-optional) published assignments must be submitted.
    required_assignments = [a for a in published_assignments if not a.get("is_optional", False)]
    if not required_assignments:
        return {uid: "" for uid in user_ids}

    assignment_ids = [a["id"] for a in required_assignments]

    # Determine which students have submitted all published assignments —
    # pure dict lookups, no DB access.
    complete_user_ids: list[str] = []
    for uid in user_ids:
        all_submitted = all(
            submission_batch.get((aid, uid)) is not None
            for aid in assignment_ids
        )
        if all_submitted:
            complete_user_ids.append(uid)

    if not complete_user_ids:
        return {uid: "" for uid in user_ids}

    # Single query: fetch all enrollments for complete students, and mark
    # the ones that aren't already marked in the same transaction.
    now = datetime.now(timezone.utc)
    result_map: dict[str, str] = {uid: "" for uid in user_ids}

    async with session_scope() as session:
        rows = (
            await session.execute(
                select(Enrollment).where(
                    Enrollment.course_unit_id == course_unit_id,
                    Enrollment.user_id.in_([str(uid) for uid in complete_user_ids]),
                )
            )
        ).scalars().all()

        for enrollment in rows:
            if enrollment.completed_at is None:
                enrollment.completed_at = now
                await session.flush()
            if enrollment.completed_at:
                result_map[enrollment.user_id] = enrollment.completed_at.isoformat()

    return result_map


# ---------------------------------------------------------------------------
# User-deletion cascade sweep (B5)
# ---------------------------------------------------------------------------


async def delete_user_data(user_id: str) -> None:
    """Sweep all Postgres rows referencing ``user_id`` — enrollments and
    submissions — when a user is deleted from the JSON identity store.

    The ``Enrollment`` and ``Submission`` tables have no FK to a users table
    on purpose (identity stays in JSON, out of scope for the DB migration —
    see ``models.py``'s ``CourseUnitInstructor`` docstring for the rationale).
    Without this sweep, deleting a user leaves those rows pointing at a
    now-nonexistent ``user_id`` forever — orphaned roster entries and
    submission references that break gradebook/roster rendering.

    Submission rows are deleted (not kept) because a deleted user's
    submissions are meaningless for grading — the student is gone, the
    gradebook can't render their name, and leaving them pollutes the
    instructor's submission list. This matches the existing
    ``delete_course_unit`` cascade behavior for submissions.

    Called from ``identity.py:delete_user()`` after the JSON record is
    removed. Does NOT add a FK/cascade at the DB level — this stays an
    application-level sweep to match how the rest of this subsystem works.
    """
    async with session_scope() as session:
        await session.execute(
            delete(Enrollment).where(Enrollment.user_id == str(user_id))
        )
        await session.execute(
            delete(Submission).where(Submission.user_id == str(user_id))
        )

# ---------------------------------------------------------------------------
# Issue #3: Course materials (instructor uploads + course-specific RAG)
# ---------------------------------------------------------------------------


# Supported file types for course materials. Mirrors the API contract's
# file_type enum. Extensions not in the RAG FileTypeRouter's supported set
# (e.g. .ipynb) are still accepted as uploads -- they're stored and downloadable
# but won't be indexed into the RAG KB (ingestion_status stays "pending").
_COURSE_MATERIAL_FILE_TYPES: dict[str, str] = {
    ".ipynb": "ipynb",
    ".pdf": "pdf",
    ".docx": "docx",
    ".pptx": "pptx",
    ".xlsx": "xlsx",
    ".md": "md",
    ".markdown": "md",
    ".txt": "txt",
    ".text": "txt",
}


def _file_type_for_filename(filename: str) -> str:
    """Map a filename's extension to the CourseMaterial.file_type enum.
    Returns ``"other"`` for anything not in the explicit mapping above."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return _COURSE_MATERIAL_FILE_TYPES.get(f".{ext}", "other")


def _material_to_dict(material: CourseMaterial) -> dict[str, Any]:
    """Serialize a CourseMaterial ORM instance to the API response shape."""
    return {
        "id": material.id,
        "course_unit_id": material.course_unit_id,
        "filename": material.filename,
        "file_type": material.file_type,
        "size_bytes": material.size_bytes,
        "status": material.status,
        "uploaded_at": material.uploaded_at.isoformat() if material.uploaded_at else "",
        "published_at": material.published_at.isoformat() if material.published_at else None,
        "ingestion_status": material.ingestion_status,
    }


async def provision_course_kb_for_unit(course_unit_id: str) -> dict[str, Any] | None:
    """Provision (or re-provision) the course-specific KB for an existing
    course unit that was created before this feature (``kb_name`` is None).
    Stores the KB name on the CourseUnit row. Returns the updated unit dict,
    or None if the course unit doesn't exist or already has a KB provisioned."""
    async with session_scope() as session:
        unit = await session.get(CourseUnit, course_unit_id)
        if unit is None or unit.kb_name:
            return None
        kb_name = _provision_course_kb(course_unit_id)
        if kb_name is None:
            return None
        unit.kb_name = kb_name
        await session.flush()
        await session.refresh(unit, ["instructors"])
    return _unit_to_dict(unit)


async def get_course_kb_name(course_unit_id: str) -> str | None:
    """Return the auto-provisioned KB name for a course unit, or None if the
    unit doesn't exist or has no KB provisioned yet."""
    async with session_scope() as session:
        unit = await session.get(CourseUnit, course_unit_id)
        if unit is None:
            return None
        return unit.kb_name


async def create_material_record(
    course_unit_id: str,
    filename: str,
    file_path: str,
    size_bytes: int,
) -> dict[str, Any]:
    """Create a CourseMaterial record with status='draft' and
    ingestion_status='pending'. Returns the serialized material dict."""
    now = datetime.now(timezone.utc)
    material = CourseMaterial(
        id=new_material_id(),
        course_unit_id=course_unit_id,
        filename=filename,
        file_type=_file_type_for_filename(filename),
        file_path=file_path,
        size_bytes=size_bytes,
        status="draft",
        uploaded_at=now,
        published_at=None,
        ingestion_status="pending",
    )
    async with session_scope() as session:
        session.add(material)
        await session.flush()
    return _material_to_dict(material)


async def list_materials_for_course(
    course_unit_id: str, *, include_draft: bool = True
) -> list[dict[str, Any]]:
    """List course materials. When ``include_draft`` is False (student view),
    only published materials are returned."""
    async with session_scope() as session:
        query = select(CourseMaterial).where(
            CourseMaterial.course_unit_id == course_unit_id
        )
        if not include_draft:
            query = query.where(CourseMaterial.status == "published")
        query = query.order_by(CourseMaterial.uploaded_at)
        result = await session.execute(query)
        materials = result.scalars().all()
    return [_material_to_dict(m) for m in materials]


async def get_material(course_unit_id: str, material_id: str) -> dict[str, Any] | None:
    """Get a single course material by id. Returns None if not found or if it
    doesn't belong to the given course unit."""
    async with session_scope() as session:
        material = await session.get(CourseMaterial, material_id)
        if material is None or material.course_unit_id != course_unit_id:
            return None
        return _material_to_dict(material)


async def get_material_orm(
    course_unit_id: str, material_id: str
) -> CourseMaterial | None:
    """Get the raw CourseMaterial ORM instance (for file-path lookups in the
    download/delete endpoints). Returns None if not found or mismatched."""
    async with session_scope() as session:
        material = await session.get(CourseMaterial, material_id)
        if material is None or material.course_unit_id != course_unit_id:
            return None
        return material


async def publish_material(course_unit_id: str, material_id: str) -> dict[str, Any] | None:
    """Set a material's status to 'published' and record published_at. Returns
    None if the material doesn't exist or doesn't belong to this course unit."""
    now = datetime.now(timezone.utc)
    async with session_scope() as session:
        material = await session.get(CourseMaterial, material_id)
        if material is None or material.course_unit_id != course_unit_id:
            return None
        material.status = "published"
        material.published_at = now
        await session.flush()
    return _material_to_dict(material)


async def unpublish_material(course_unit_id: str, material_id: str) -> dict[str, Any] | None:
    """Revert a material's status to 'draft' and clear published_at. Returns
    None if the material doesn't exist or doesn't belong to this course unit."""
    async with session_scope() as session:
        material = await session.get(CourseMaterial, material_id)
        if material is None or material.course_unit_id != course_unit_id:
            return None
        material.status = "draft"
        material.published_at = None
        await session.flush()
    return _material_to_dict(material)


async def delete_material(course_unit_id: str, material_id: str) -> bool:
    """Delete a CourseMaterial DB record. Returns False if not found or
    mismatched. The caller is responsible for removing the physical file from
    the KB's raw/ directory (see the DELETE endpoint in router.py)."""
    async with session_scope() as session:
        material = await session.get(CourseMaterial, material_id)
        if material is None or material.course_unit_id != course_unit_id:
            return False
        await session.delete(material)
    return True


async def update_ingestion_status(
    material_id: str, status: str
) -> None:
    """Update a material's ingestion_status (pending -> indexing -> ready/failed).
    Called by the background indexing task. Best-effort -- logs a warning if the
    material no longer exists (e.g. deleted while indexing was in flight)."""
    async with session_scope() as session:
        material = await session.get(CourseMaterial, material_id)
        if material is None:
            logger.warning(
                "Cannot update ingestion_status for material %s: not found", material_id
            )
            return
        material.ingestion_status = status
        await session.flush()
