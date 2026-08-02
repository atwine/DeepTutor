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

from datetime import datetime, timezone
import logging
from typing import Any
from uuid import uuid4

from sqlalchemy import delete, select

from deeptutor.services.db import session_scope
from deeptutor.services.db.models import CourseUnit, CourseUnitInstructor, Enrollment

logger = logging.getLogger(__name__)


def new_course_unit_id() -> str:
    return f"cu_{uuid4().hex}"


def new_enrollment_id() -> str:
    return f"en_{uuid4().hex}"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _unit_to_dict(unit: CourseUnit) -> dict[str, Any]:
    """Serialize a CourseUnit ORM instance to the same dict shape the old
    JSON store returned — preserves backward compatibility for all callers."""
    return {
        "id": unit.id,
        "name": unit.name,
        "term": unit.term,
        "description": unit.description,
        "instructor_ids": [i.instructor_id for i in unit.instructors],
        "created_at": unit.created_at.isoformat() if unit.created_at else "",
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
    }


# ---------------------------------------------------------------------------
# Course units
# ---------------------------------------------------------------------------


async def create_course_unit(
    name: str,
    term: str,
    instructor_ids: list[str],
    description: str = "",
) -> dict[str, Any]:
    unit_id = new_course_unit_id()
    now = datetime.now(timezone.utc)
    clean_ids = [str(uid) for uid in instructor_ids if str(uid).strip()]
    async with session_scope() as session:
        unit = CourseUnit(
            id=unit_id,
            name=name,
            term=term,
            description=description,
            created_at=now,
        )
        session.add(unit)
        await session.flush()
        for uid in clean_ids:
            session.add(CourseUnitInstructor(course_unit_id=unit_id, instructor_id=uid))
        await session.flush()
        # Eagerly load instructors for serialization
        await session.refresh(unit, ["instructors"])
    return _unit_to_dict(unit)


async def list_course_units() -> list[dict[str, Any]]:
    async with session_scope() as session:
        result = await session.execute(
            select(CourseUnit).order_by(CourseUnit.created_at)
        )
        units = result.scalars().unique().all()
        # Eagerly load instructors
        for u in units:
            await session.refresh(u, ["instructors"])
    return [_unit_to_dict(u) for u in units]


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


async def is_instructor_of(user_id: str, course_unit_id: str) -> bool:
    async with session_scope() as session:
        result = await session.execute(
            select(CourseUnitInstructor).where(
                CourseUnitInstructor.course_unit_id == course_unit_id,
                CourseUnitInstructor.instructor_id == str(user_id),
            )
        )
        return result.scalar_one_or_none() is not None


async def is_approved_student_of(user_id: str, course_unit_id: str) -> bool:
    """Whether ``user_id`` has an *approved* enrollment in this course unit —
    a pending request doesn't grant access to assignments any more than it
    grants access to the course units list."""
    async with session_scope() as session:
        result = await session.execute(
            select(Enrollment).where(
                Enrollment.course_unit_id == course_unit_id,
                Enrollment.user_id == str(user_id),
                Enrollment.status == "approved",
            )
        )
        return result.scalar_one_or_none() is not None


async def list_course_units_for_instructor(user_id: str) -> list[dict[str, Any]]:
    async with session_scope() as session:
        result = await session.execute(
            select(CourseUnit)
            .join(CourseUnitInstructor)
            .where(CourseUnitInstructor.instructor_id == str(user_id))
            .order_by(CourseUnit.created_at)
        )
        units = result.scalars().unique().all()
        for u in units:
            await session.refresh(u, ["instructors"])
    return [_unit_to_dict(u) for u in units]


async def list_course_units_for_student(user_id: str) -> list[dict[str, Any]]:
    """Units ``user_id`` has *approved* access to — a pending request alone
    doesn't grant it."""
    async with session_scope() as session:
        result = await session.execute(
            select(CourseUnit)
            .join(Enrollment)
            .where(
                Enrollment.user_id == str(user_id),
                Enrollment.status == "approved",
            )
            .order_by(CourseUnit.created_at)
        )
        units = result.scalars().unique().all()
        for u in units:
            await session.refresh(u, ["instructors"])
    return [_unit_to_dict(u) for u in units]


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
            return _enrollment_to_dict(existing)
        enrollment = Enrollment(
            id=new_enrollment_id(),
            course_unit_id=course_unit_id,
            user_id=str(user_id),
            status="approved",
            created_at=now,
            approved_at=now,
        )
        session.add(enrollment)
    return _enrollment_to_dict(enrollment)


async def request_enrollment(course_unit_id: str, user_id: str) -> dict[str, Any] | None:
    """Student-initiated: creates a ``pending`` enrollment for the instructor
    to approve or reject. Idempotent — an existing enrollment of either
    status (already pending, or already approved) is returned unchanged, so
    re-requesting can't downgrade an approved student back to pending.
    Returns None if the course unit doesn't exist."""
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
    return _enrollment_to_dict(enrollment)


async def unenroll_student(course_unit_id: str, user_id: str) -> bool:
    async with session_scope() as session:
        result = await session.execute(
            delete(Enrollment).where(
                Enrollment.course_unit_id == course_unit_id,
                Enrollment.user_id == str(user_id),
            )
        )
        return result.rowcount > 0


async def list_enrollments_for_course(course_unit_id: str) -> list[dict[str, Any]]:
    async with session_scope() as session:
        result = await session.execute(
            select(Enrollment).where(Enrollment.course_unit_id == course_unit_id)
        )
        enrollments = result.scalars().all()
    return [_enrollment_to_dict(e) for e in enrollments]


async def list_enrollments_for_student(user_id: str) -> list[dict[str, Any]]:
    async with session_scope() as session:
        result = await session.execute(
            select(Enrollment).where(Enrollment.user_id == str(user_id))
        )
        enrollments = result.scalars().all()
    return [_enrollment_to_dict(e) for e in enrollments]
