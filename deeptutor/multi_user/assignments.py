"""Official (graded) assignments — a fixed, persisted question set scoped to
a course unit, with per-student submissions and grading.

Distinct from the ephemeral Quiz/``deep_question`` capability, which
regenerates fresh questions every time and only ever produces conversational
feedback: an Assignment's questions are authored once and then locked on
publish (see :func:`update_assignment`), so a score means the same thing for
every student who takes it, and a ``Submission`` is a permanent, persisted
record rather than a chat-turn artifact.

Storage mirrors ``course_units.py``: plain JSON files under ``SYSTEM_ROOT``,
serialized through a single process-wide lock.
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

# Co-located with course_units.py's store — same deployment-state tree.
ASSIGNMENTS_DIR = SYSTEM_ROOT / "courses"
ASSIGNMENTS_FILE = ASSIGNMENTS_DIR / "assignments.json"
SUBMISSIONS_FILE = ASSIGNMENTS_DIR / "submissions.json"

# Auto-gradable by exact (normalized) string match against `correct_answer`.
QUESTION_TYPES_AUTO_GRADABLE = {"choice", "concept", "fill_in_blank"}
# Free-text — graded via the AI Judge (see grading.py).
QUESTION_TYPES_FREE_TEXT = {"short_answer", "written", "coding"}


def new_assignment_id() -> str:
    return f"asg_{uuid4().hex}"


def new_submission_id() -> str:
    return f"sub_{uuid4().hex}"


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


def _load_assignments() -> dict[str, dict[str, Any]]:
    ensure_system_dirs()
    return _read_json(ASSIGNMENTS_FILE)


def _load_submissions() -> dict[str, dict[str, Any]]:
    ensure_system_dirs()
    return _read_json(SUBMISSIONS_FILE)


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


# ---------------------------------------------------------------------------
# Assignments
# ---------------------------------------------------------------------------


def create_assignment(
    course_unit_id: str,
    title: str,
    description: str,
    questions: list[dict[str, Any]],
    *,
    weight: float = 1.0,
    attempt_limit: int = 1,
    due_at: str = "",
    created_by: str = "",
) -> dict[str, Any]:
    record = {
        "id": new_assignment_id(),
        "course_unit_id": course_unit_id,
        "title": title,
        "description": description,
        "questions": [_normalize_question(q) for q in questions],
        "weight": weight,
        "attempt_limit": max(1, int(attempt_limit)),
        "due_at": due_at,
        "status": "draft",
        "created_by": created_by,
        "created_at": utc_now(),
    }
    with _WRITE_LOCK:
        assignments = _load_assignments()
        assignments[record["id"]] = record
        _write_json(ASSIGNMENTS_FILE, assignments)
    return record


def get_assignment(assignment_id: str) -> dict[str, Any] | None:
    return _load_assignments().get(assignment_id)


def list_assignments_for_course(course_unit_id: str) -> list[dict[str, Any]]:
    return [
        a for a in _load_assignments().values() if a.get("course_unit_id") == course_unit_id
    ]


def update_assignment(
    assignment_id: str,
    *,
    title: str | None = None,
    description: str | None = None,
    questions: list[dict[str, Any]] | None = None,
    weight: float | None = None,
    attempt_limit: int | None = None,
    due_at: str | None = None,
) -> dict[str, Any] | None:
    """Questions can only be edited while the assignment is still a draft —
    once published, a student may already be looking at them, and changing
    the question set out from under an in-progress or already-graded attempt
    would make scores incomparable between students. Metadata (title,
    description, weight, due date) can still change after publish."""
    with _WRITE_LOCK:
        assignments = _load_assignments()
        record = assignments.get(assignment_id)
        if record is None:
            return None
        if questions is not None and record.get("status") == "published":
            raise ValueError("Cannot edit questions on a published assignment.")
        if title is not None:
            record["title"] = title
        if description is not None:
            record["description"] = description
        if questions is not None:
            record["questions"] = [_normalize_question(q) for q in questions]
        if weight is not None:
            record["weight"] = weight
        if attempt_limit is not None:
            record["attempt_limit"] = max(1, int(attempt_limit))
        if due_at is not None:
            record["due_at"] = due_at
        assignments[assignment_id] = record
        _write_json(ASSIGNMENTS_FILE, assignments)
        return record


def publish_assignment(assignment_id: str) -> dict[str, Any] | None:
    with _WRITE_LOCK:
        assignments = _load_assignments()
        record = assignments.get(assignment_id)
        if record is None:
            return None
        record["status"] = "published"
        assignments[assignment_id] = record
        _write_json(ASSIGNMENTS_FILE, assignments)
        return record


def delete_assignment(assignment_id: str) -> bool:
    with _WRITE_LOCK:
        assignments = _load_assignments()
        if assignment_id not in assignments:
            return False
        assignments.pop(assignment_id, None)
        _write_json(ASSIGNMENTS_FILE, assignments)
        submissions = _load_submissions()
        remaining = {
            sid: rec
            for sid, rec in submissions.items()
            if rec.get("assignment_id") != assignment_id
        }
        if len(remaining) != len(submissions):
            _write_json(SUBMISSIONS_FILE, remaining)
        return True


# ---------------------------------------------------------------------------
# Submissions
# ---------------------------------------------------------------------------


def count_submissions(assignment_id: str, user_id: str) -> int:
    return len(
        [
            s
            for s in _load_submissions().values()
            if s.get("assignment_id") == assignment_id and str(s.get("user_id")) == str(user_id)
        ]
    )


def create_submission(
    assignment_id: str,
    user_id: str,
    *,
    answers: list[dict[str, Any]],
    question_results: list[dict[str, Any]],
    score: float,
    max_score: float,
) -> dict[str, Any]:
    record = {
        "id": new_submission_id(),
        "assignment_id": assignment_id,
        "user_id": str(user_id),
        "answers": answers,
        "question_results": question_results,
        "score": score,
        "max_score": max_score,
        "submitted_at": utc_now(),
    }
    with _WRITE_LOCK:
        submissions = _load_submissions()
        submissions[record["id"]] = record
        _write_json(SUBMISSIONS_FILE, submissions)
    return record


def get_submission(submission_id: str) -> dict[str, Any] | None:
    return _load_submissions().get(submission_id)


def list_submissions_for_assignment(assignment_id: str) -> list[dict[str, Any]]:
    return [s for s in _load_submissions().values() if s.get("assignment_id") == assignment_id]


def get_latest_submission(assignment_id: str, user_id: str) -> dict[str, Any] | None:
    matches = [
        s
        for s in _load_submissions().values()
        if s.get("assignment_id") == assignment_id and str(s.get("user_id")) == str(user_id)
    ]
    if not matches:
        return None
    return max(matches, key=lambda s: s.get("submitted_at", ""))
