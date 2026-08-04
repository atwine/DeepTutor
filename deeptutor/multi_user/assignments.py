"""Official (graded) assignments — a fixed, persisted question set scoped to a
course unit, with per-student submissions and grading.

Distinct from the ephemeral Quiz/``deep_question`` capability, which
regenerates fresh questions every time and only ever produces conversational
feedback: an Assignment's questions are authored once and then locked on
publish (see :func:`update_assignment`), so a score means the same thing for
every student who takes it, and a ``Submission`` is a permanent, persisted
record rather than a chat-turn artifact.

Storage is now Postgres-backed via SQLAlchemy 2.0 async (see
``deeptutor/services/db/``). Every public function here keeps the same name
and signature it had under the old flat-JSON store so the routers
(``assignments_router.py``) and downstream consumers (``gradebook.py``) only
need to gain ``await`` at call sites, not logic changes — see
``devin-handoff/DATABASE_MIGRATION_PLAN.md`` "Decision, post-audit" section.
``grading.py`` imports only the ``QUESTION_TYPES_AUTO_GRADABLE`` constant and
is not affected by the async change.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from deeptutor.multi_user.notifications import create_notification
from deeptutor.services.db import session_scope
from deeptutor.services.db.models import Assignment, AssignmentAccessGrant, Submission

# Sentinel for "parameter not provided" (distinct from None which means
# "clear the field") — used by update_assignment for nullable fields.
_UNSET = object()

# Auto-gradable by exact (normalized) string match against `correct_answer`.
QUESTION_TYPES_AUTO_GRADABLE = {"choice", "concept", "fill_in_blank"}
# Free-text — graded via the AI Judge (see grading.py).
QUESTION_TYPES_FREE_TEXT = {"short_answer", "written", "coding"}


def new_assignment_id() -> str:
    return f"asg_{uuid4().hex}"


def new_submission_id() -> str:
    return f"sub_{uuid4().hex}"


def _normalize_question(q: dict[str, Any]) -> dict[str, Any]:
    """Canonical shape for a stored question — mirrors the Quiz capability's
    ``QuizPair`` fields (question/question_type/options/correct_answer/
    explanation) so a future LLM-assisted drafting step can slot in without a
    schema change; adds ``points`` for weighted grading."""
    return {
        "question_id": str(q.get("question_id") or uuid4().hex),
        "question": str(q.get("question") or ""),
        "question_type": str(q.get("question_type") or "short_answer"),
        "options": q.get("options") if isinstance(q.get("options"), dict) else None,
        "correct_answer": str(q.get("correct_answer") or ""),
        "explanation": str(q.get("explanation") or ""),
        "points": float(q.get("points") or 1.0),
    }


def public_question_view(question: dict[str, Any]) -> dict[str, Any]:
    """A student sees the question, options, and points — never the answer
    key or explanation before they've submitted (that would defeat the
    point of grading)."""
    return {
        "question_id": question.get("question_id", ""),
        "question": question.get("question", ""),
        "question_type": question.get("question_type", ""),
        "options": question.get("options"),
        "points": question.get("points", 1.0),
    }


def _assignment_to_dict(a: Assignment) -> dict[str, Any]:
    """Map an ORM ``Assignment`` row to the dict shape the routers and
    gradebook expect — field-for-field identical to the old JSON record.
    ``created_at`` is rendered as an ISO string to match the previous
    ``utc_now()`` (``datetime.isoformat()``) contract, not a raw datetime
    object, so downstream code and the frontend that parsed it as a string
    keep working unchanged."""
    return {
        "id": a.id,
        "course_unit_id": a.course_unit_id,
        "title": a.title,
        "description": a.description,
        "questions": a.questions,
        "weight": a.weight,
        "attempt_limit": a.attempt_limit,
        "due_at": a.due_at,
        "status": a.status,
        "created_by": a.created_by,
        "created_at": a.created_at.isoformat() if a.created_at else "",
        "is_timed": a.is_timed,
        "time_limit_minutes": a.time_limit_minutes,
        "is_major": a.is_major,
        "passing_score": a.passing_score,
    }


def _submission_to_dict(s: Submission) -> dict[str, Any]:
    """Map an ORM ``Submission`` row to the dict shape the routers expect —
    field-for-field identical to the old JSON record. ``submitted_at`` is
    rendered as an ISO string for the same reason as ``created_at`` above."""
    return {
        "id": s.id,
        "assignment_id": s.assignment_id,
        "user_id": s.user_id,
        "answers": s.answers,
        "question_results": s.question_results,
        "score": s.score,
        "max_score": s.max_score,
        "submitted_at": s.submitted_at.isoformat() if s.submitted_at else "",
    }


# ---------------------------------------------------------------------------
# Assignments
# ---------------------------------------------------------------------------


async def create_assignment(
    course_unit_id: str,
    title: str,
    description: str,
    questions: list[dict[str, Any]],
    *,
    weight: float = 1.0,
    attempt_limit: int = 1,
    due_at: str = "",
    created_by: str = "",
    is_timed: bool = False,
    time_limit_minutes: int | None = None,
    is_major: bool = False,
    passing_score: float | None = None,
) -> dict[str, Any]:
    record = Assignment(
        id=new_assignment_id(),
        course_unit_id=course_unit_id,
        title=title,
        description=description,
        questions=[_normalize_question(q) for q in questions],
        weight=weight,
        attempt_limit=max(1, int(attempt_limit)),
        due_at=due_at,
        status="draft",
        created_by=created_by,
        is_timed=is_timed,
        time_limit_minutes=time_limit_minutes,
        is_major=is_major,
        passing_score=passing_score,
    )
    async with session_scope() as session:
        session.add(record)
        await session.flush()
        return _assignment_to_dict(record)


async def get_assignment(assignment_id: str) -> dict[str, Any] | None:
    async with session_scope() as session:
        result = await session.execute(
            select(Assignment).where(Assignment.id == assignment_id)
        )
        record = result.scalar_one_or_none()
        return _assignment_to_dict(record) if record else None


async def list_assignments_for_course(course_unit_id: str) -> list[dict[str, Any]]:
    async with session_scope() as session:
        result = await session.execute(
            select(Assignment)
            .where(Assignment.course_unit_id == course_unit_id)
            .order_by(Assignment.created_at)
        )
        return [_assignment_to_dict(a) for a in result.scalars()]


async def update_assignment(
    assignment_id: str,
    *,
    title: str | None = None,
    description: str | None = None,
    questions: list[dict[str, Any]] | None = None,
    weight: float | None = None,
    attempt_limit: int | None = None,
    due_at: str | None = None,
    is_timed: bool | None = None,
    time_limit_minutes: int | None = _UNSET,  # type: ignore[assignment]
    is_major: bool | None = None,
    passing_score: float | None = _UNSET,  # type: ignore[assignment]
) -> dict[str, Any] | None:
    """Questions can only be edited while the assignment is still a draft —
    once published, a student may already be looking at them, and changing
    the question set out from under an in-progress or already-graded attempt
    would make scores incomparable between students. Metadata (title,
    description, weight, due date, timer settings) can still change after
    publish."""
    async with session_scope() as session:
        result = await session.execute(
            select(Assignment).where(Assignment.id == assignment_id)
        )
        record = result.scalar_one_or_none()
        if record is None:
            return None
        if questions is not None and record.status == "published":
            raise ValueError("Cannot edit questions on a published assignment.")
        if title is not None:
            record.title = title
        if description is not None:
            record.description = description
        if questions is not None:
            record.questions = [_normalize_question(q) for q in questions]
        if weight is not None:
            record.weight = weight
        if attempt_limit is not None:
            record.attempt_limit = max(1, int(attempt_limit))
        if due_at is not None:
            record.due_at = due_at
        if is_timed is not None:
            record.is_timed = is_timed
        if time_limit_minutes is not _UNSET:
            record.time_limit_minutes = time_limit_minutes
        if is_major is not None:
            record.is_major = is_major
        if passing_score is not _UNSET:
            record.passing_score = passing_score
        await session.flush()
        return _assignment_to_dict(record)


async def publish_assignment(assignment_id: str) -> dict[str, Any] | None:
    async with session_scope() as session:
        result = await session.execute(
            select(Assignment).where(Assignment.id == assignment_id)
        )
        record = result.scalar_one_or_none()
        if record is None:
            return None
        record.status = "published"
        await session.flush()
        course_unit_id, title = record.course_unit_id, record.title
        payload = _assignment_to_dict(record)

    await create_notification(
        course_unit_id, "assignment_published", f"New assignment: {title}"
    )
    return payload


async def unpublish_assignment(assignment_id: str) -> dict[str, Any] | None:
    """Revert a published assignment back to draft. Existing submissions are
    preserved (scores remain for audit/history), but no *new* submissions are
    accepted while the assignment is in draft status — the submit endpoint
    already checks ``status == "published"`` before allowing a submit.

    Decision rationale (logged in DEVIN_LOG.md): option (a) from the plan —
    keep existing submissions, just block new ones while in draft. This allows
    an instructor to fix a typo in a question (questions become editable again
    once status is 'draft') without destroying grading history."""
    async with session_scope() as session:
        result = await session.execute(
            select(Assignment).where(Assignment.id == assignment_id)
        )
        record = result.scalar_one_or_none()
        if record is None:
            return None
        record.status = "draft"
        await session.flush()
        return _assignment_to_dict(record)


async def delete_assignment(assignment_id: str) -> bool:
    """Deletes the assignment and — via ``ON DELETE CASCADE`` on the
    ``submissions`` foreign key — all of its submissions, declaratively.
    Replaces the old JSON store's manual sweep of two files under a
    process-wide ``threading.Lock``."""
    async with session_scope() as session:
        result = await session.execute(
            delete(Assignment).where(Assignment.id == assignment_id)
        )
        return result.rowcount > 0


# ---------------------------------------------------------------------------
# Submissions
# ---------------------------------------------------------------------------


async def count_submissions(assignment_id: str, user_id: str) -> int:
    """Indexed lookup — ``submissions`` has a composite index on
    ``(assignment_id, user_id)`` (see models.py), so this is O(log n) rather
    than the old O(all submissions system-wide) linear scan."""
    async with session_scope() as session:
        result = await session.execute(
            select(func.count())
            .select_from(Submission)
            .where(
                Submission.assignment_id == assignment_id,
                Submission.user_id == str(user_id),
            )
        )
        return int(result.scalar() or 0)


async def create_submission(
    assignment_id: str,
    user_id: str,
    *,
    answers: list[dict[str, Any]],
    question_results: list[dict[str, Any]],
    score: float,
    max_score: float,
) -> dict[str, Any]:
    record = Submission(
        id=new_submission_id(),
        assignment_id=assignment_id,
        user_id=str(user_id),
        answers=answers,
        question_results=question_results,
        score=score,
        max_score=max_score,
    )
    async with session_scope() as session:
        session.add(record)
        await session.flush()
        return _submission_to_dict(record)


async def get_submission(submission_id: str) -> dict[str, Any] | None:
    async with session_scope() as session:
        result = await session.execute(
            select(Submission).where(Submission.id == submission_id)
        )
        record = result.scalar_one_or_none()
        return _submission_to_dict(record) if record else None


async def list_submissions_for_assignment(assignment_id: str) -> list[dict[str, Any]]:
    async with session_scope() as session:
        result = await session.execute(
            select(Submission)
            .where(Submission.assignment_id == assignment_id)
            .order_by(Submission.submitted_at)
        )
        return [_submission_to_dict(s) for s in result.scalars()]


async def get_latest_submission(assignment_id: str, user_id: str) -> dict[str, Any] | None:
    """A student's most recent submission for an assignment — indexed by
    ``(assignment_id, user_id)``, ordered by ``submitted_at`` descending."""
    async with session_scope() as session:
        result = await session.execute(
            select(Submission)
            .where(
                Submission.assignment_id == assignment_id,
                Submission.user_id == str(user_id),
            )
            .order_by(Submission.submitted_at.desc())
            .limit(1)
        )
        record = result.scalar_one_or_none()
        return _submission_to_dict(record) if record else None


async def get_latest_submissions_batch(
    assignment_ids: list[str],
) -> dict[tuple[str, str], dict[str, Any]]:
    """Batched version of :func:`get_latest_submission` — fetches the latest
    submission per ``(assignment_id, user_id)`` pair for *all* given
    assignments in a **single query**, eliminating the N+1 pattern in
    ``build_gradebook()`` (issue #31).

    Uses ``ROW_NUMBER() OVER (PARTITION BY assignment_id, user_id ORDER BY
    submitted_at DESC)`` to pick the latest submission per pair, then
    filters to ``row_number = 1``. This is portable SQL (works on Postgres
    and SQLite) and reduces N×M queries to **1 query**.

    Returns a dict keyed by ``(assignment_id, user_id)`` with the
    submission dict as the value — the same shape ``build_gradebook``
    consumes, just looked up from a dict instead of fetched per pair.
    """
    if not assignment_ids:
        return {}

    from sqlalchemy import literal_column, text

    # Use a subquery with ROW_NUMBER() to pick the latest submission per
    # (assignment_id, user_id) pair, then join back to get full rows.
    # This is a single SQL query regardless of how many assignments/students
    # there are — the O(N×M) Python loop is replaced by an O(1) dict lookup.
    subq = (
        select(
            Submission.id.label("latest_id"),
            Submission.assignment_id,
            Submission.user_id,
            func.row_number()
            .over(
                partition_by=[Submission.assignment_id, Submission.user_id],
                order_by=Submission.submitted_at.desc(),
            )
            .label("rn"),
        )
        .where(Submission.assignment_id.in_(assignment_ids))
        .subquery()
    )

    async with session_scope() as session:
        result = await session.execute(
            select(Submission)
            .join(subq, Submission.id == subq.c.latest_id)
            .where(subq.c.rn == 1)
        )
        records = result.scalars().all()

    return {
        (record.assignment_id, record.user_id): _submission_to_dict(record)
        for record in records
    }


# ---------------------------------------------------------------------------
# Advisory-lock helpers for the submit flow's attempt-limit guard
# ---------------------------------------------------------------------------


async def _acquire_submit_advisory_lock(
    session, assignment_id: str, user_id: str
) -> None:
    """Take a per-(assignment, student) Postgres advisory lock for the
    duration of the current transaction.

    This replaces the old in-process ``asyncio.Lock`` dict in
    ``assignments_router._submit_locks``. ``pg_advisory_xact_lock`` is held
    until the surrounding transaction commits/rolls back and — unlike the old
    in-process lock — is correct across multiple app processes (e.g. two
    Railway replicas), which was the whole point of migrating off the
    JSON+``threading.Lock`` store.

    The key is derived from ``hashtext(assignment_id || user_id)`` so two
    concurrent submits for the same student+assignment serialize against each
    other, while unrelated submits (different student and/or assignment) don't
    contend. ``SELECT ... FOR UPDATE`` was considered and rejected: under
    Postgres's default READ COMMITTED isolation it locks *existing* matching
    rows but does not block a concurrent INSERT for the same
    ``(assignment_id, user_id)`` (no MySQL-style gap locking), so two
    transactions could both see count=0 and both insert — silently
    reintroducing the K1 double-submission bug. The advisory lock closes that
    window because it serializes the count-check + insert critical section
    regardless of whether matching rows exist yet.

    Call this inside a ``session_scope()`` block — the lock auto-releases on
    transaction end, so there is no unlock to forget.
    """
    await session.execute(
        func.pg_advisory_xact_lock(func.hashtext(assignment_id + user_id))
    )


async def check_attempt_limit(
    assignment_id: str, user_id: str, attempt_limit: int
) -> None:
    """First short transaction of the submit flow: acquire the advisory lock,
    count the student's existing submissions, and raise ``ValueError`` if the
    attempt limit is already reached. The transaction commits (releasing the
    lock) on return — this is a fail-fast check before the caller spends LLM
    tokens on grading, not a lock held across the grading call.

    The real guard is :func:`create_submission_checked` below, which re-checks
    under the advisory lock after grading. This function exists only to reject
    early; the advisory lock here is a courtesy that prevents a concurrent
    submit from passing the same early check simultaneously, but the
    correctness guarantee does not depend on it.
    """
    async with session_scope() as session:
        await _acquire_submit_advisory_lock(session, assignment_id, user_id)
        result = await session.execute(
            select(func.count())
            .select_from(Submission)
            .where(
                Submission.assignment_id == assignment_id,
                Submission.user_id == str(user_id),
            )
        )
        already = int(result.scalar() or 0)
        if already >= attempt_limit:
            raise ValueError(f"Attempt limit reached ({attempt_limit}).")


async def create_submission_checked(
    assignment_id: str,
    user_id: str,
    *,
    answers: list[dict[str, Any]],
    question_results: list[dict[str, Any]],
    score: float,
    max_score: float,
    attempt_limit: int,
) -> dict[str, Any]:
    """Second short transaction of the submit flow: re-acquire the advisory
    lock, re-count (a concurrent submit may have inserted between the first
    check and now), raise ``ValueError`` if the limit is now reached, and
    insert the new submission. Returns the new submission as a dict.

    This is the real attempt-limit guard — the advisory lock serializes the
    count-check + insert critical section, so two concurrent submits for the
    same student+assignment cannot both see count < limit and both insert.
    The LLM grading call happens *between* :func:`check_attempt_limit` and
    this function, with no transaction or advisory lock held, so the
    connection pool is not exhausted by a long-running LLM call holding a
    transaction open (the exact anti-pattern the migration restructures away
    — see DATABASE_MIGRATION_PLAN.md "Decision, post-audit" §3).
    """
    async with session_scope() as session:
        await _acquire_submit_advisory_lock(session, assignment_id, user_id)
        result = await session.execute(
            select(func.count())
            .select_from(Submission)
            .where(
                Submission.assignment_id == assignment_id,
                Submission.user_id == str(user_id),
            )
        )
        already_after = int(result.scalar() or 0)
        if already_after >= attempt_limit:
            raise ValueError(f"Attempt limit reached ({attempt_limit}).")
        record = Submission(
            id=new_submission_id(),
            assignment_id=assignment_id,
            user_id=str(user_id),
            answers=answers,
            question_results=question_results,
            score=score,
            max_score=max_score,
        )
        session.add(record)
        await session.flush()
        return _submission_to_dict(record)


# ---------------------------------------------------------------------------
# Access grants (A3) — per-student exception/emergency access
# ---------------------------------------------------------------------------


async def get_access_grant(
    assignment_id: str, user_id: str
) -> dict[str, Any] | None:
    """Retrieve a per-student access grant for an assignment, or None."""
    async with session_scope() as session:
        result = await session.execute(
            select(AssignmentAccessGrant).where(
                AssignmentAccessGrant.assignment_id == assignment_id,
                AssignmentAccessGrant.user_id == str(user_id),
            )
        )
        grant = result.scalar_one_or_none()
        if grant is None:
            return None
        return _grant_to_dict(grant)


async def upsert_access_grant(
    assignment_id: str,
    user_id: str,
    *,
    extra_attempts: int | None = None,
    extended_due_at: str | None = None,
    granted_by: str,
) -> dict[str, Any]:
    """Create or update a per-student access grant. Upsert on
    (assignment_id, user_id) unique constraint."""
    async with session_scope() as session:
        result = await session.execute(
            select(AssignmentAccessGrant).where(
                AssignmentAccessGrant.assignment_id == assignment_id,
                AssignmentAccessGrant.user_id == str(user_id),
            )
        )
        existing = result.scalar_one_or_none()
        if existing is not None:
            if extra_attempts is not None:
                existing.extra_attempts = extra_attempts
            if extended_due_at is not None:
                existing.extended_due_at = extended_due_at
            existing.granted_by = granted_by
            existing.granted_at = datetime.now(timezone.utc)
            await session.flush()
            return _grant_to_dict(existing)
        grant = AssignmentAccessGrant(
            id=f"aag_{uuid4().hex}",
            assignment_id=assignment_id,
            user_id=str(user_id),
            extra_attempts=extra_attempts,
            extended_due_at=extended_due_at,
            granted_by=granted_by,
        )
        session.add(grant)
        await session.flush()
        return _grant_to_dict(grant)


async def revoke_access_grant(assignment_id: str, user_id: str) -> bool:
    """Remove a per-student access grant."""
    async with session_scope() as session:
        result = await session.execute(
            delete(AssignmentAccessGrant).where(
                AssignmentAccessGrant.assignment_id == assignment_id,
                AssignmentAccessGrant.user_id == str(user_id),
            )
        )
        return result.rowcount > 0


async def list_access_grants_for_assignment(
    assignment_id: str,
) -> list[dict[str, Any]]:
    """List all per-student grants for an assignment."""
    async with session_scope() as session:
        result = await session.execute(
            select(AssignmentAccessGrant).where(
                AssignmentAccessGrant.assignment_id == assignment_id
            )
        )
        return [_grant_to_dict(g) for g in result.scalars()]


def _grant_to_dict(g: AssignmentAccessGrant) -> dict[str, Any]:
    return {
        "id": g.id,
        "assignment_id": g.assignment_id,
        "user_id": g.user_id,
        "extra_attempts": g.extra_attempts,
        "extended_due_at": g.extended_due_at,
        "granted_by": g.granted_by,
        "granted_at": g.granted_at.isoformat() if g.granted_at else "",
    }


# ---------------------------------------------------------------------------
# Due-at enforcement (A2) + access-grant-aware attempt limit
# ---------------------------------------------------------------------------


def get_effective_attempt_limit(
    assignment: dict[str, Any], grant: dict[str, Any] | None
) -> int:
    """Compute the effective attempt limit for a student, taking their
    per-student access grant into account.

    Round 3 retake policy: if ``is_major`` is set, the effective limit is
    hard-capped at 1 no matter what ``attempt_limit`` is stored on the
    record — an instructor should not be able to accidentally allow a
    retake on a major/final exam. This is enforced here (the single place
    both the submit flow and the student-facing view read the limit from)
    rather than by mutating the stored ``attempt_limit`` column, so toggling
    ``is_major`` off later doesn't lose whatever value the instructor had
    configured. Per-student access grants are deliberately still ignored for
    a major assignment's own attempt count — an emergency accommodation
    grant is a separate, explicit instructor action (see A3), not something
    that should silently reopen a major exam via a generic default."""
    if assignment.get("is_major"):
        return 1
    base = assignment["attempt_limit"]
    if grant and grant.get("extra_attempts"):
        return base + grant["extra_attempts"]
    return base


def get_retake_block_reason(
    assignment: dict[str, Any],
    grant: dict[str, Any] | None,
    attempts_count: int,
    latest_submission: dict[str, Any] | None,
) -> tuple[str, str] | None:
    """Single source of truth for whether a student may submit again.

    Returns ``None`` if another submission is allowed, otherwise a
    ``(reason_code, message)`` tuple where ``reason_code`` is one of:

    - ``"attempt_limit"`` — every configured/granted attempt has been used.
    - ``"already_passed"`` — not a major assignment, a ``passing_score`` is
      configured, and the student's most recent submission already cleared
      it. A student shouldn't be able to keep retrying just to inflate an
      already-passing score, even if attempts remain.

    Used by both the submit endpoint (to reject a disallowed resubmission —
    manual click and timer auto-submit both funnel through the same submit
    function, so this one check covers both paths) and the student-facing
    assignment view (to explain, before they try, why a "Try again" option
    isn't offered) — so enforcement and UI messaging can never drift apart.

    If ``passing_score`` is ``None`` and ``is_major`` is ``False``, this
    reduces to the pre-existing attempt-limit-only behavior."""
    effective_limit = get_effective_attempt_limit(assignment, grant)
    if attempts_count >= effective_limit:
        return ("attempt_limit", f"Attempt limit reached ({effective_limit}).")
    passing_score = assignment.get("passing_score")
    if not assignment.get("is_major") and passing_score is not None and latest_submission:
        max_score = latest_submission.get("max_score") or 0
        if max_score > 0:
            pct = (latest_submission.get("score", 0) / max_score) * 100
            if pct >= passing_score:
                return (
                    "already_passed",
                    "You have already passed this assignment and cannot submit again.",
                )
    return None


def check_due_at(
    assignment: dict[str, Any], grant: dict[str, Any] | None
) -> None:
    """Raise ValueError if the assignment is past its due date for this
    student. If the student has an extended_due_at grant, that overrides
    the assignment's due_at. Empty/unparseable due_at means no deadline."""
    due_at_str = assignment.get("due_at") or ""
    if grant and grant.get("extended_due_at"):
        due_at_str = grant["extended_due_at"]
    if not due_at_str:
        return  # No deadline
    try:
        due_at = datetime.fromisoformat(due_at_str)
    except (ValueError, TypeError):
        return  # Unparseable — treat as no deadline
    # Ensure timezone-aware comparison
    if due_at.tzinfo is None:
        due_at = due_at.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    if now > due_at:
        raise ValueError("This assignment is past its due date.")
