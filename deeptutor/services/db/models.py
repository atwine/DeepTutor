"""ORM models for the Postgres-backed course-unit/assignment store.

This is the frozen contract for the 3-way migration split (see
`devin-handoff/DATABASE_MIGRATION_PLAN.md`, "Work split — 3 tracks"):

* Track 2 (`course_units.py` + `course_books.py`) imports ``CourseUnit``,
  ``CourseUnitInstructor``, ``Enrollment``, and ``CourseBookEntry``.
* Track 3 (`assignments.py`) imports ``Assignment`` and ``Submission``.

Do not change column names, types, or table names here without re-syncing
with whichever track is already coding against them — that's the whole
point of freezing this module before Tracks 2 and 3 start.

Field-for-field, every column here maps to a key that exists in today's
JSON records (`course_units.py`, `assignments.py`, `course_books.py`) —
nothing added, nothing dropped, so a straight one-to-one migration script
(Phase F) is possible without inventing new fields.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Track 2 — course_units.py
# ---------------------------------------------------------------------------


class CourseUnit(Base):
    __tablename__ = "course_units"

    # Keep the existing "cu_<hex>" id format so callers that already store/
    # compare these ids as opaque strings (frontend, other JSON stores that
    # reference a course_unit_id) don't need to change.
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    term: Mapped[str] = mapped_column(String, nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # B1: Course start/end dates — nullable so existing units aren't forced to
    # backfill. Stored as date (not datetime) since course boundaries are
    # day-granular. When end_date is set, student access to assignments/notes
    # is blocked after end_date + COURSE_END_GRACE_PERIOD_DAYS (see
    # course_units.py); instructor/admin archival access is never blocked.
    start_date: Mapped[str | None] = mapped_column(String, nullable=True, default=None)
    end_date: Mapped[str | None] = mapped_column(String, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    instructors: Mapped[list["CourseUnitInstructor"]] = relationship(
        back_populates="course_unit", cascade="all, delete-orphan"
    )
    enrollments: Mapped[list["Enrollment"]] = relationship(
        back_populates="course_unit", cascade="all, delete-orphan"
    )
    assignments: Mapped[list["Assignment"]] = relationship(
        back_populates="course_unit", cascade="all, delete-orphan"
    )
    book_entries: Mapped[list["CourseBookEntry"]] = relationship(
        back_populates="course_unit", cascade="all, delete-orphan"
    )


class CourseUnitInstructor(Base):
    """Many-to-many: was a plain JSON list column (`instructor_ids`) on the
    course-unit record. `instructor_id` has no FK to a users table on
    purpose — `identity.py` (accounts) is explicitly out of scope for this
    migration (see the plan's scope section), so a deleted user's id can
    linger here exactly as it can in today's JSON `instructor_ids` list —
    a pre-existing gap, not one this migration introduces or is expected to
    close."""

    __tablename__ = "course_unit_instructors"

    course_unit_id: Mapped[str] = mapped_column(
        ForeignKey("course_units.id", ondelete="CASCADE"), primary_key=True
    )
    instructor_id: Mapped[str] = mapped_column(String, primary_key=True)

    course_unit: Mapped[CourseUnit] = relationship(back_populates="instructors")


class Enrollment(Base):
    __tablename__ = "enrollments"
    __table_args__ = (
        UniqueConstraint(
            "course_unit_id", "user_id", name="uq_enrollment_course_user"
        ),
    )

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: f"en_{uuid.uuid4().hex}"
    )
    course_unit_id: Mapped[str] = mapped_column(
        ForeignKey("course_units.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    # 'pending' | 'approved' — matches Enrollment.status in course_units.py today.
    status: Mapped[str] = mapped_column(String, nullable=False, default="approved")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    course_unit: Mapped[CourseUnit] = relationship(back_populates="enrollments")


# ---------------------------------------------------------------------------
# Track 3 — assignments.py
# ---------------------------------------------------------------------------


class Assignment(Base):
    __tablename__ = "assignments"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: f"asg_{uuid.uuid4().hex}"
    )
    course_unit_id: Mapped[str] = mapped_column(
        ForeignKey("course_units.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Canonical per-question shape (from assignments.py's _normalize_question):
    # {question_id: str, question: str, question_type: str,
    #  options: dict[str, str] | None, correct_answer: str,
    #  explanation: str, points: float}
    # Kept as JSONB rather than a child table — the question list's internal
    # shape doesn't need relational decomposition yet, and Postgres can still
    # index into JSONB later if that ever becomes necessary.
    questions: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, default=list)
    weight: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    attempt_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # Deliberately left as loose TEXT, matching today's contract (often empty,
    # opaque format) — not a migration target. Don't upgrade to a real
    # timestamp type as part of this migration; that's a separate decision
    # with its own frontend-form implications.
    due_at: Mapped[str] = mapped_column(String, nullable=False, default="")
    # 'draft' | 'published'
    status: Mapped[str] = mapped_column(String, nullable=False, default="draft")
    created_by: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    # A4: timed assignment support — optional countdown for "major" assignments.
    is_timed: Mapped[bool] = mapped_column(nullable=False, default=False)
    time_limit_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Round 3: retake policy tied to major/quiz + pass/fail, not just a raw
    # attempt counter (see assignments.py's get_effective_attempt_limit /
    # get_retake_block_reason). is_major hard-caps the *effective* attempt
    # limit at 1 regardless of the stored attempt_limit value — nullable=False
    # with a default since every assignment needs a definite answer here.
    # passing_score is a 0-100 percentage; NULL means no pass/fail gating
    # (current behavior: attempt_limit is the only gate).
    is_major: Mapped[bool] = mapped_column(nullable=False, default=False)
    passing_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    course_unit: Mapped[CourseUnit] = relationship(back_populates="assignments")
    submissions: Mapped[list["Submission"]] = relationship(
        back_populates="assignment", cascade="all, delete-orphan"
    )
    access_grants: Mapped[list["AssignmentAccessGrant"]] = relationship(
        back_populates="assignment", cascade="all, delete-orphan"
    )


class Submission(Base):
    __tablename__ = "submissions"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: f"sub_{uuid.uuid4().hex}"
    )
    assignment_id: Mapped[str] = mapped_column(
        ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    # [{question_id: str, answer: str}, ...]
    answers: Mapped[list[dict]] = mapped_column(JSONB, nullable=False, default=list)
    # [{question_id, question, user_answer, is_correct, score, max_score,
    #   feedback}, ...] — see grading.py's grade_submission() return shape.
    question_results: Mapped[list[dict]] = mapped_column(
        JSONB, nullable=False, default=list
    )
    score: Mapped[float] = mapped_column(Float, nullable=False)
    max_score: Mapped[float] = mapped_column(Float, nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    assignment: Mapped[Assignment] = relationship(back_populates="submissions")


# ---------------------------------------------------------------------------
# Track A (Round 2) — per-student exception/emergency access
# ---------------------------------------------------------------------------


class AssignmentAccessGrant(Base):
    """Per-student override for attempt limits and/or due dates on a specific
    assignment. Created by an instructor when a student has an emergency or
    needs accommodation — the submit flow checks this grant in addition to
    the assignment's own limits."""

    __tablename__ = "assignment_access_grants"
    __table_args__ = (
        UniqueConstraint(
            "assignment_id", "user_id", name="uq_access_grant_assignment_user"
        ),
    )

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: f"aag_{uuid.uuid4().hex}"
    )
    assignment_id: Mapped[str] = mapped_column(
        ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    # If set, the student gets this many *extra* attempts on top of the
    # assignment's base attempt_limit. NULL means no extra attempts granted.
    extra_attempts: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # If set, this student's personal deadline (overrides assignment.due_at).
    # NULL means the assignment's own due_at applies as normal.
    extended_due_at: Mapped[str | None] = mapped_column(String, nullable=True)
    granted_by: Mapped[str] = mapped_column(String, nullable=False)
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    assignment: Mapped[Assignment] = relationship(back_populates="access_grants")


# ---------------------------------------------------------------------------
# Track 2 — course_books.py
# ---------------------------------------------------------------------------


class Notification(Base):
    """Lightweight, polling-based per-course activity feed entry. Created
    when an instructor publishes something new (an assignment or course
    notes) so approved-enrolled students can see an alert on the platform.

    Deliberately NOT wired via a decorator/middleware — trigger points call
    `deeptutor.multi_user.notifications.create_notification()` explicitly,
    matching this codebase's access-control convention of explicit
    predicate/helper calls rather than framework magic (see
    ARCHITECTURE_AND_COMPLETED_WORK.md §7).

    Read/unread state is intentionally NOT a column on this table — see
    `NotificationRead` below.
    """

    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: f"notif_{uuid.uuid4().hex}"
    )
    course_unit_id: Mapped[str] = mapped_column(
        ForeignKey("course_units.id", ondelete="CASCADE"), nullable=False
    )
    # e.g. "assignment_published" | "notes_published"
    kind: Mapped[str] = mapped_column(String, nullable=False)
    # Short human-readable line, e.g. "New assignment: Pandas Fundamentals Quiz"
    title: Mapped[str] = mapped_column(String, nullable=False)
    # NOTE: DateTime(timezone=True) matches the convention used everywhere
    # else in this file — a prior round's bug was a naive-vs-aware datetime
    # mismatch from forgetting this on a new column. Don't repeat it.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)


class NotificationRead(Base):
    """Join table tracking which users have read which notification. Marking
    read is a simple insert (idempotent per user+notification via the unique
    constraint), not a mutation racing across students reading the same
    notification concurrently."""

    __tablename__ = "notification_reads"
    __table_args__ = (
        UniqueConstraint(
            "notification_id", "user_id", name="uq_notification_read_notification_user"
        ),
    )

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: f"nread_{uuid.uuid4().hex}"
    )
    notification_id: Mapped[str] = mapped_column(
        ForeignKey("notifications.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)


class CourseBookEntry(Base):
    """A Book stays physically stored in its owner's own per-user workspace
    (see ARCHITECTURE_AND_COMPLETED_WORK.md §2.4) — this table is only the
    index/pointer (book_id -> owning course unit + draft/published status),
    exactly mirroring today's course_books.py JSON index. It does not, and
    should not, store the book's actual content."""

    __tablename__ = "course_book_entries"

    book_id: Mapped[str] = mapped_column(String, primary_key=True)
    owner_id: Mapped[str] = mapped_column(String, nullable=False)
    course_unit_id: Mapped[str] = mapped_column(
        ForeignKey("course_units.id", ondelete="CASCADE"), nullable=False
    )
    # 'draft' | 'published'
    status: Mapped[str] = mapped_column(String, nullable=False, default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    course_unit: Mapped[CourseUnit] = relationship(back_populates="book_entries")
