"""Course unit and enrollment storage for the optional multi-user layer.

Mirrors the pattern in ``identity.py``: plain JSON files under ``SYSTEM_ROOT``,
serialized through a single process-wide lock. A ``CourseUnit`` can have more
than one instructor id (co-instructors/TAs), and the same instructor can own
several course units at once (e.g. teaching two subjects in one term) — both
are plain list/many-to-many relationships, not a one-instructor-one-team
assumption. ``Enrollment`` is the many-to-many join between students and
course units.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import threading
from typing import Any
from uuid import uuid4

from .paths import SYSTEM_ROOT, ensure_system_dirs

logger = logging.getLogger(__name__)

_WRITE_LOCK = threading.Lock()

COURSE_DIR = SYSTEM_ROOT / "courses"
COURSE_UNITS_FILE = COURSE_DIR / "course_units.json"
ENROLLMENTS_FILE = COURSE_DIR / "enrollments.json"


def new_course_unit_id() -> str:
    return f"cu_{uuid4().hex}"


def new_enrollment_id() -> str:
    return f"en_{uuid4().hex}"


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


def _load_course_units() -> dict[str, dict[str, Any]]:
    ensure_system_dirs()
    return _read_json(COURSE_UNITS_FILE)


def _load_enrollments() -> dict[str, dict[str, Any]]:
    ensure_system_dirs()
    return _read_json(ENROLLMENTS_FILE)


# ---------------------------------------------------------------------------
# Course units
# ---------------------------------------------------------------------------


def create_course_unit(
    name: str,
    term: str,
    instructor_ids: list[str],
    description: str = "",
) -> dict[str, Any]:
    record = {
        "id": new_course_unit_id(),
        "name": name,
        "term": term,
        "description": description,
        "instructor_ids": [str(uid) for uid in instructor_ids if str(uid).strip()],
        "created_at": utc_now(),
    }
    with _WRITE_LOCK:
        units = _load_course_units()
        units[record["id"]] = record
        _write_json(COURSE_UNITS_FILE, units)
    return record


def list_course_units() -> list[dict[str, Any]]:
    return list(_load_course_units().values())


def get_course_unit(course_unit_id: str) -> dict[str, Any] | None:
    return _load_course_units().get(course_unit_id)


def update_course_unit(
    course_unit_id: str,
    *,
    name: str | None = None,
    term: str | None = None,
    description: str | None = None,
    instructor_ids: list[str] | None = None,
) -> dict[str, Any] | None:
    with _WRITE_LOCK:
        units = _load_course_units()
        record = units.get(course_unit_id)
        if record is None:
            return None
        if name is not None:
            record["name"] = name
        if term is not None:
            record["term"] = term
        if description is not None:
            record["description"] = description
        if instructor_ids is not None:
            record["instructor_ids"] = [str(uid) for uid in instructor_ids if str(uid).strip()]
        units[course_unit_id] = record
        _write_json(COURSE_UNITS_FILE, units)
        return record


def delete_course_unit(course_unit_id: str) -> bool:
    with _WRITE_LOCK:
        units = _load_course_units()
        if course_unit_id not in units:
            return False
        units.pop(course_unit_id, None)
        _write_json(COURSE_UNITS_FILE, units)
        enrollments = _load_enrollments()
        remaining = {
            eid: rec for eid, rec in enrollments.items() if rec.get("course_unit_id") != course_unit_id
        }
        if len(remaining) != len(enrollments):
            _write_json(ENROLLMENTS_FILE, remaining)
        return True


def is_instructor_of(user_id: str, course_unit_id: str) -> bool:
    record = get_course_unit(course_unit_id)
    if record is None:
        return False
    return str(user_id) in [str(uid) for uid in record.get("instructor_ids", [])]


def is_approved_student_of(user_id: str, course_unit_id: str) -> bool:
    """Whether ``user_id`` has an *approved* enrollment in this course unit —
    a pending request doesn't grant access to assignments any more than it
    grants access to the course units list."""
    return any(
        str(rec.get("user_id")) == str(user_id) and rec.get("status", "approved") == "approved"
        for rec in list_enrollments_for_course(course_unit_id)
    )


def list_course_units_for_instructor(user_id: str) -> list[dict[str, Any]]:
    return [
        record
        for record in _load_course_units().values()
        if str(user_id) in [str(uid) for uid in record.get("instructor_ids", [])]
    ]


def list_course_units_for_student(user_id: str) -> list[dict[str, Any]]:
    """Units ``user_id`` has *approved* access to — a pending request alone
    doesn't grant it."""
    unit_ids = {
        rec.get("course_unit_id")
        for rec in _load_enrollments().values()
        if str(rec.get("user_id")) == str(user_id) and rec.get("status", "approved") == "approved"
    }
    units = _load_course_units()
    return [units[uid] for uid in unit_ids if uid in units]


# ---------------------------------------------------------------------------
# Enrollments
# ---------------------------------------------------------------------------


def _find_enrollment(
    enrollments: dict[str, dict[str, Any]], course_unit_id: str, user_id: str
) -> dict[str, Any] | None:
    for record in enrollments.values():
        if (
            record.get("course_unit_id") == course_unit_id
            and str(record.get("user_id")) == str(user_id)
        ):
            return record
    return None


def enroll_student(course_unit_id: str, user_id: str) -> dict[str, Any] | None:
    """Instructor/admin directly enrolls a student — always ends up approved.
    The manual fallback path (e.g. the student can't reach the platform
    themselves, or an instructor is confirming someone in person). If the
    student already has a *pending* request, this approves it in place
    (an instructor clicking "Enroll" on someone who already asked should
    obviously let them in, not silently no-op); an already-approved
    enrollment is left as-is. Returns None if the course unit doesn't exist."""
    with _WRITE_LOCK:
        units = _load_course_units()
        if course_unit_id not in units:
            return None
        enrollments = _load_enrollments()
        existing = _find_enrollment(enrollments, course_unit_id, user_id)
        if existing is not None:
            if existing.get("status", "approved") != "approved":
                existing["status"] = "approved"
                existing["approved_at"] = utc_now()
                _write_json(ENROLLMENTS_FILE, enrollments)
            return existing
        record = {
            "id": new_enrollment_id(),
            "course_unit_id": course_unit_id,
            "user_id": str(user_id),
            "status": "approved",
            "created_at": utc_now(),
            "approved_at": utc_now(),
        }
        enrollments[record["id"]] = record
        _write_json(ENROLLMENTS_FILE, enrollments)
        return record


def request_enrollment(course_unit_id: str, user_id: str) -> dict[str, Any] | None:
    """Student-initiated: creates a ``pending`` enrollment for the instructor
    to approve or reject. Idempotent — an existing enrollment of either
    status (already pending, or already approved) is returned unchanged, so
    re-requesting can't downgrade an approved student back to pending.
    Returns None if the course unit doesn't exist."""
    with _WRITE_LOCK:
        units = _load_course_units()
        if course_unit_id not in units:
            return None
        enrollments = _load_enrollments()
        existing = _find_enrollment(enrollments, course_unit_id, user_id)
        if existing is not None:
            return existing
        record = {
            "id": new_enrollment_id(),
            "course_unit_id": course_unit_id,
            "user_id": str(user_id),
            "status": "pending",
            "created_at": utc_now(),
            "approved_at": "",
        }
        enrollments[record["id"]] = record
        _write_json(ENROLLMENTS_FILE, enrollments)
        return record


def approve_enrollment(course_unit_id: str, user_id: str) -> dict[str, Any] | None:
    """Approve a pending enrollment request. Returns None if there is no
    matching pending request (already approved, rejected/removed, or never
    requested)."""
    with _WRITE_LOCK:
        enrollments = _load_enrollments()
        record = _find_enrollment(enrollments, course_unit_id, user_id)
        if record is None or record.get("status", "approved") != "pending":
            return None
        record["status"] = "approved"
        record["approved_at"] = utc_now()
        _write_json(ENROLLMENTS_FILE, enrollments)
        return record


def unenroll_student(course_unit_id: str, user_id: str) -> bool:
    with _WRITE_LOCK:
        enrollments = _load_enrollments()
        remaining = {
            eid: rec
            for eid, rec in enrollments.items()
            if not (
                rec.get("course_unit_id") == course_unit_id
                and str(rec.get("user_id")) == str(user_id)
            )
        }
        if len(remaining) == len(enrollments):
            return False
        _write_json(ENROLLMENTS_FILE, remaining)
        return True


def list_enrollments_for_course(course_unit_id: str) -> list[dict[str, Any]]:
    return [
        record
        for record in _load_enrollments().values()
        if record.get("course_unit_id") == course_unit_id
    ]


def list_enrollments_for_student(user_id: str) -> list[dict[str, Any]]:
    return [
        record
        for record in _load_enrollments().values()
        if str(record.get("user_id")) == str(user_id)
    ]
