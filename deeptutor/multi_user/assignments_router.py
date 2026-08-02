"""API for Official Assignments — a persisted, gradable test scoped to a
course unit. Mirrors the access-control pattern in ``router.py``: an
instructor manages only assignments in course units they teach, a student
sees only published assignments in course units they're approved-enrolled
in, and an admin can do anything.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from deeptutor.api.routers.auth import (
    TokenPayload,
    require_auth,
    require_instructor_or_admin,
)

from .assignments import (
    count_submissions,
    create_assignment,
    create_submission,
    delete_assignment,
    get_assignment,
    get_latest_submission,
    list_assignments_for_course,
    list_submissions_for_assignment,
    public_question_view,
    publish_assignment,
    update_assignment,
)
from .course_units import get_course_unit, is_approved_student_of, is_instructor_of
from .grading import grade_submission
from .gradebook import build_gradebook, build_gradebook_csv
from .identity import get_user_by_id

router = APIRouter()

# Per-(assignment_id, user_id) lock to serialize concurrent submissions for the
# same student+assignment, preventing the race where two near-simultaneous
# submits both pass the attempt-count check before either writes.
#
# Must be ``asyncio.Lock``, not ``threading.Lock``: the submit flow holds this
# lock across ``await grade_submission(...)`` (a real LLM call for free-text
# questions). A ``threading.Lock`` blocks the OS thread on contention — and
# since this app runs one event loop on one thread, a second coroutine
# blocking on ``threading.Lock.acquire()`` freezes that thread entirely,
# which means the first coroutine's own pending LLM response can never be
# delivered to let it finish and release the lock. That's a total, permanent
# deadlock (confirmed live: the whole backend became unresponsive to even a
# health check), not just added latency. ``asyncio.Lock`` is itself
# awaitable, so a contended waiter yields to the event loop instead of
# blocking it. Dict creation below has no ``await`` in it, so it's safe
# without a separate guard lock — coroutines only interleave at await points.
_submit_locks: dict[str, asyncio.Lock] = {}


def _get_submit_lock(assignment_id: str, user_id: str) -> asyncio.Lock:
    key = f"{assignment_id}:{user_id}"
    lock = _submit_locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _submit_locks[key] = lock
    return lock


class QuestionPayload(BaseModel):
    question_id: str = ""
    question: str
    question_type: str = "short_answer"
    options: dict[str, str] | None = None
    correct_answer: str = ""
    explanation: str = ""
    points: float = 1.0


class AssignmentCreate(BaseModel):
    title: str
    description: str = ""
    questions: list[QuestionPayload] = []
    weight: float = 1.0
    attempt_limit: int = 1
    due_at: str = ""


class AssignmentUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    questions: list[QuestionPayload] | None = None
    weight: float | None = None
    attempt_limit: int | None = None
    due_at: str | None = None


class AnswerPayload(BaseModel):
    question_id: str
    answer: str = ""


class SubmitPayload(BaseModel):
    answers: list[AnswerPayload] = []


def _manages_course_unit(current: TokenPayload, course_unit_id: str) -> bool:
    return current.role == "admin" or (
        current.role == "instructor" and is_instructor_of(current.user_id, course_unit_id)
    )


def _require_manage_access(current: TokenPayload, assignment: dict[str, Any]) -> None:
    if not _manages_course_unit(current, assignment["course_unit_id"]):
        raise HTTPException(status_code=403, detail="You do not manage this assignment")


def _get_assignment_or_404(assignment_id: str) -> dict[str, Any]:
    assignment = get_assignment(assignment_id)
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")
    return assignment


def _assignment_summary(assignment: dict[str, Any]) -> dict[str, Any]:
    """Metadata only — no question bodies. Used by the list endpoint; the
    single-assignment endpoint returns the (student-view-stripped) questions."""
    return {
        "id": assignment["id"],
        "course_unit_id": assignment["course_unit_id"],
        "title": assignment["title"],
        "description": assignment["description"],
        "status": assignment["status"],
        "weight": assignment["weight"],
        "attempt_limit": assignment["attempt_limit"],
        "due_at": assignment["due_at"],
        "question_count": len(assignment.get("questions", [])),
        "created_at": assignment["created_at"],
    }


@router.post("/course-units/{course_unit_id}/assignments")
async def create_assignment_endpoint(
    course_unit_id: str,
    payload: AssignmentCreate,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    if get_course_unit(course_unit_id) is None:
        raise HTTPException(status_code=404, detail="Course unit not found")
    if not _manages_course_unit(current, course_unit_id):
        raise HTTPException(status_code=403, detail="You do not manage this course unit")
    record = create_assignment(
        course_unit_id,
        payload.title,
        payload.description,
        [q.model_dump() for q in payload.questions],
        weight=payload.weight,
        attempt_limit=payload.attempt_limit,
        due_at=payload.due_at,
        created_by=current.user_id,
    )
    return {"assignment": record}


@router.get("/course-units/{course_unit_id}/assignments")
async def list_assignments_endpoint(
    course_unit_id: str,
    current: TokenPayload | None = Depends(require_auth),
) -> dict[str, Any]:
    if get_course_unit(course_unit_id) is None:
        raise HTTPException(status_code=404, detail="Course unit not found")
    payload = current
    if payload is not None and _manages_course_unit(payload, course_unit_id):
        assignments = list_assignments_for_course(course_unit_id)
    else:
        user_id = payload.user_id if payload else ""
        if not is_approved_student_of(user_id, course_unit_id):
            raise HTTPException(
                status_code=403, detail="You are not enrolled in this course unit"
            )
        assignments = [
            a for a in list_assignments_for_course(course_unit_id) if a["status"] == "published"
        ]
    return {"assignments": [_assignment_summary(a) for a in assignments]}


@router.get("/assignments/{assignment_id}")
async def get_assignment_endpoint(
    assignment_id: str,
    current: TokenPayload | None = Depends(require_auth),
) -> dict[str, Any]:
    assignment = _get_assignment_or_404(assignment_id)
    course_unit_id = assignment["course_unit_id"]
    manages = current is not None and _manages_course_unit(current, course_unit_id)

    if manages:
        return {"assignment": assignment}

    if assignment["status"] != "published":
        raise HTTPException(status_code=404, detail="Assignment not found")
    user_id = current.user_id if current else ""
    if not is_approved_student_of(user_id, course_unit_id):
        raise HTTPException(status_code=403, detail="You are not enrolled in this course unit")

    student_view = {
        **_assignment_summary(assignment),
        "questions": [public_question_view(q) for q in assignment.get("questions", [])],
    }
    latest = get_latest_submission(assignment_id, user_id)
    student_view["my_attempts"] = count_submissions(assignment_id, user_id)
    student_view["my_latest_submission"] = latest
    return {"assignment": student_view}


@router.put("/assignments/{assignment_id}")
async def update_assignment_endpoint(
    assignment_id: str,
    payload: AssignmentUpdate,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    assignment = _get_assignment_or_404(assignment_id)
    _require_manage_access(current, assignment)
    try:
        record = update_assignment(
            assignment_id,
            title=payload.title,
            description=payload.description,
            questions=[q.model_dump() for q in payload.questions]
            if payload.questions is not None
            else None,
            weight=payload.weight,
            attempt_limit=payload.attempt_limit,
            due_at=payload.due_at,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if record is None:
        raise HTTPException(status_code=404, detail="Assignment not found")
    return {"assignment": record}


@router.post("/assignments/{assignment_id}/publish")
async def publish_assignment_endpoint(
    assignment_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    assignment = _get_assignment_or_404(assignment_id)
    _require_manage_access(current, assignment)
    if not assignment.get("questions"):
        raise HTTPException(status_code=400, detail="Add at least one question before publishing")
    record = publish_assignment(assignment_id)
    return {"assignment": record}


@router.delete("/assignments/{assignment_id}")
async def delete_assignment_endpoint(
    assignment_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    assignment = _get_assignment_or_404(assignment_id)
    _require_manage_access(current, assignment)
    delete_assignment(assignment_id)
    return {"ok": True}


@router.post("/assignments/{assignment_id}/submit")
async def submit_assignment_endpoint(
    assignment_id: str,
    payload: SubmitPayload,
    current: TokenPayload | None = Depends(require_auth),
) -> dict[str, Any]:
    assignment = _get_assignment_or_404(assignment_id)
    if assignment["status"] != "published":
        raise HTTPException(status_code=400, detail="This assignment is not open for submissions")
    course_unit_id = assignment["course_unit_id"]
    user_id = current.user_id if current else ""
    if not is_approved_student_of(user_id, course_unit_id):
        raise HTTPException(status_code=403, detail="You are not enrolled in this course unit")

    # Hold a per-student+assignment lock across grading + write so two
    # concurrent submits can't both pass the attempt-count check. The lock is
    # only held for this student's submission flow — other students' submits
    # and all unrelated writes proceed independently.
    submit_lock = _get_submit_lock(assignment_id, user_id)
    async with submit_lock:
        already = count_submissions(assignment_id, user_id)
        if already >= assignment["attempt_limit"]:
            raise HTTPException(
                status_code=400,
                detail=f"Attempt limit reached ({assignment['attempt_limit']}).",
            )

        answers = [a.model_dump() for a in payload.answers]
        question_results, score, max_score = await grade_submission(assignment, answers)

        # Re-check after grading: the attempt count can't have changed during
        # grading since we hold the lock, but this guards against any path that
        # bypasses the lock (e.g. a future code change or a manual DB write).
        already_after = count_submissions(assignment_id, user_id)
        if already_after >= assignment["attempt_limit"]:
            raise HTTPException(
                status_code=400,
                detail=f"Attempt limit reached ({assignment['attempt_limit']}).",
            )

        record = create_submission(
            assignment_id,
            user_id,
            answers=answers,
            question_results=question_results,
            score=score,
            max_score=max_score,
        )
    return {"submission": record}


@router.get("/assignments/{assignment_id}/submissions")
async def list_submissions_endpoint(
    assignment_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    assignment = _get_assignment_or_404(assignment_id)
    _require_manage_access(current, assignment)
    submissions = []
    for record in list_submissions_for_assignment(assignment_id):
        user_record = get_user_by_id(record["user_id"])
        username = user_record[0] if user_record else record["user_id"]
        full_name = str(user_record[1].get("full_name") or "") if user_record else ""
        registration_number = (
            str(user_record[1].get("registration_number") or "") if user_record else ""
        )
        submissions.append(
            {
                **record,
                "username": username,
                "full_name": full_name,
                "registration_number": registration_number,
            }
        )
    return {"submissions": submissions}


@router.get("/assignments/{assignment_id}/my-submission")
async def get_my_submission_endpoint(
    assignment_id: str,
    current: TokenPayload | None = Depends(require_auth),
) -> dict[str, Any]:
    assignment = _get_assignment_or_404(assignment_id)
    user_id = current.user_id if current else ""
    if not is_approved_student_of(user_id, assignment["course_unit_id"]):
        raise HTTPException(status_code=403, detail="You are not enrolled in this course unit")
    return {"submission": get_latest_submission(assignment_id, user_id)}


def _require_course_unit_manage_access(current: TokenPayload, course_unit_id: str) -> None:
    if get_course_unit(course_unit_id) is None:
        raise HTTPException(status_code=404, detail="Course unit not found")
    if not _manages_course_unit(current, course_unit_id):
        raise HTTPException(status_code=403, detail="You do not manage this course unit")


@router.get("/course-units/{course_unit_id}/gradebook")
async def get_gradebook_endpoint(
    course_unit_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    _require_course_unit_manage_access(current, course_unit_id)
    return build_gradebook(course_unit_id)


@router.get("/course-units/{course_unit_id}/gradebook/export")
async def export_gradebook_csv_endpoint(
    course_unit_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> PlainTextResponse:
    _require_course_unit_manage_access(current, course_unit_id)
    unit = get_course_unit(course_unit_id)
    csv_text = build_gradebook_csv(course_unit_id)
    safe_name = "".join(c if c.isalnum() or c in "-_ " else "_" for c in unit["name"]).strip() or "gradebook"
    return PlainTextResponse(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.csv"'},
    )
