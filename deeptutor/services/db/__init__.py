"""Postgres-backed storage for course units, assignments, submissions, and
course-book entries — see devin-handoff/DATABASE_MIGRATION_PLAN.md.

Public surface Tracks 2 and 3 import from:

    from deeptutor.services.db import session_scope
    from deeptutor.services.db.models import CourseUnit, Enrollment, ...

Nothing else in this codebase should import from this package yet — the
existing JSON-backed `course_units.py`/`assignments.py`/`course_books.py`
stay authoritative until their respective tracks land.
"""

from .engine import dispose_engine, get_engine, get_session_factory, session_scope
from .models import (
    Assignment,
    Base,
    CourseBookEntry,
    CourseUnit,
    CourseUnitInstructor,
    Enrollment,
    Submission,
)

__all__ = [
    "Assignment",
    "Base",
    "CourseBookEntry",
    "CourseUnit",
    "CourseUnitInstructor",
    "Enrollment",
    "Submission",
    "dispose_engine",
    "get_engine",
    "get_session_factory",
    "session_scope",
]
