"""API for Official Assignments — a persisted, gradable test scoped to a
course unit. Mirrors the access-control pattern in ``router.py``: an
instructor manages only assignments in course units they teach, a student
sees only published assignments in course units they're approved-enrolled
in, and an admin can do anything.
"""

from __future__ import annotations

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
    check_attempt_limit,
    check_due_at,
    count_submissions,
    create_assignment,
    create_submission_checked,
    delete_assignment,
    get_access_grant,
    get_assignment,
    get_effective_attempt_limit,
    get_latest_submission,
    get_retake_block_reason,
    list_access_grants_for_assignment,
    list_assignments_for_course,
    list_submissions_for_assignment,
    public_question_view,
    publish_assignment,
    revoke_access_grant,
    unpublish_assignment,
    update_assignment,
    upsert_access_grant,
)
from .course_units import get_course_unit, is_approved_student_of, is_instructor_of
from .grading import grade_submission
from .gradebook import build_gradebook, build_gradebook_csv
from .identity import get_user_by_id

router = APIRouter()


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
    is_timed: bool = False
    time_limit_minutes: int | None = None
    # Round 3: retake policy. is_major hard-caps the effective attempt limit
    # at 1 server-side regardless of attempt_limit (see
    # assignments.get_effective_attempt_limit). passing_score is a 0-100
    # percentage; None means no pass/fail gating.
    is_major: bool = False
    passing_score: float | None = None


class AssignmentUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    questions: list[QuestionPayload] | None = None
    weight: float | None = None
    attempt_limit: int | None = None
    due_at: str | None = None
    is_timed: bool | None = None
    time_limit_minutes: int | None = None
    is_major: bool | None = None
    passing_score: float | None = None


class AnswerPayload(BaseModel):
    question_id: str
    answer: str = ""


class SubmitPayload(BaseModel):
    answers: list[AnswerPayload] = []


async def _manages_course_unit(current: TokenPayload, course_unit_id: str) -> bool:
    return current.role == "admin" or (
        current.role == "instructor" and await is_instructor_of(current.user_id, course_unit_id)
    )


async def _require_manage_access(current: TokenPayload, assignment: dict[str, Any]) -> None:
    if not await _manages_course_unit(current, assignment["course_unit_id"]):
        raise HTTPException(status_code=403, detail="You do not manage this assignment")


def _enrollment_error_detail(current: TokenPayload | None) -> str:
    """The 'you can't see this' message for a non-managing, non-enrolled
    caller depends on who they are. The gradebook page's equivalent
    access-denied case correctly reads "You do not manage this course unit"
    for an instructor/admin who isn't attached to this course unit; the
    assignments endpoints previously always raised the student-facing
    "You are not enrolled in this course unit" message even when the caller
    was an instructor who simply doesn't manage this particular unit —
    confusing, since "enrollment" isn't even a concept that applies to
    instructors. Match wording to the caller's role instead of assuming
    student in every case."""
    if current is not None and current.role in ("admin", "instructor"):
        return "You do not manage this course unit"
    return "You are not enrolled in this course unit"


async def _get_assignment_or_404(assignment_id: str) -> dict[str, Any]:
    assignment = await get_assignment(assignment_id)
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
        "is_timed": assignment.get("is_timed", False),
        "time_limit_minutes": assignment.get("time_limit_minutes"),
        "is_major": assignment.get("is_major", False),
        "passing_score": assignment.get("passing_score"),
        "question_count": len(assignment.get("questions", [])),
        "created_at": assignment["created_at"],
    }


@router.post("/course-units/{course_unit_id}/assignments")
async def create_assignment_endpoint(
    course_unit_id: str,
    payload: AssignmentCreate,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    if await get_course_unit(course_unit_id) is None:
        raise HTTPException(status_code=404, detail="Course unit not found")
    if not await _manages_course_unit(current, course_unit_id):
        raise HTTPException(status_code=403, detail="You do not manage this course unit")
    record = await create_assignment(
        course_unit_id,
        payload.title,
        payload.description,
        [q.model_dump() for q in payload.questions],
        weight=payload.weight,
        attempt_limit=payload.attempt_limit,
        due_at=payload.due_at,
        created_by=current.user_id,
        is_timed=payload.is_timed,
        time_limit_minutes=payload.time_limit_minutes,
        is_major=payload.is_major,
        passing_score=payload.passing_score,
    )
    return {"assignment": record}


@router.get("/course-units/{course_unit_id}/assignments")
async def list_assignments_endpoint(
    course_unit_id: str,
    current: TokenPayload | None = Depends(require_auth),
) -> dict[str, Any]:
    if await get_course_unit(course_unit_id) is None:
        raise HTTPException(status_code=404, detail="Course unit not found")
    payload = current
    if payload is not None and await _manages_course_unit(payload, course_unit_id):
        assignments = await list_assignments_for_course(course_unit_id)
    else:
        user_id = payload.user_id if payload else ""
        if not await is_approved_student_of(user_id, course_unit_id):
            raise HTTPException(
                status_code=403, detail=_enrollment_error_detail(payload)
            )
        assignments = [
            a for a in await list_assignments_for_course(course_unit_id) if a["status"] == "published"
        ]
    return {"assignments": [_assignment_summary(a) for a in assignments]}


@router.get("/assignments/{assignment_id}")
async def get_assignment_endpoint(
    assignment_id: str,
    current: TokenPayload | None = Depends(require_auth),
) -> dict[str, Any]:
    assignment = await _get_assignment_or_404(assignment_id)
    course_unit_id = assignment["course_unit_id"]
    manages = current is not None and await _manages_course_unit(current, course_unit_id)

    if manages:
        return {"assignment": assignment}

    if assignment["status"] != "published":
        raise HTTPException(status_code=404, detail="Assignment not found")
    user_id = current.user_id if current else ""
    if not await is_approved_student_of(user_id, course_unit_id):
        raise HTTPException(status_code=403, detail=_enrollment_error_detail(current))

    grant = await get_access_grant(assignment_id, user_id) if user_id else None
    latest = await get_latest_submission(assignment_id, user_id)
    attempts_count = await count_submissions(assignment_id, user_id)
    # Round 3: the raw stored attempt_limit doesn't reflect an is_major hard
    # cap or a per-student access grant's extra_attempts — show the effective
    # limit here so a student's own view is never more permissive-looking
    # than what the submit endpoint will actually allow.
    block = get_retake_block_reason(assignment, grant, attempts_count, latest)
    student_view = {
        **_assignment_summary(assignment),
        "questions": [public_question_view(q) for q in assignment.get("questions", [])],
        "attempt_limit": get_effective_attempt_limit(assignment, grant),
    }
    student_view["my_attempts"] = attempts_count
    student_view["my_latest_submission"] = latest
    student_view["retake_blocked_reason"] = block[0] if block else None
    student_view["retake_blocked_message"] = block[1] if block else None
    return {"assignment": student_view}


@router.put("/assignments/{assignment_id}")
async def update_assignment_endpoint(
    assignment_id: str,
    payload: AssignmentUpdate,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    assignment = await _get_assignment_or_404(assignment_id)
    await _require_manage_access(current, assignment)
    from .assignments import _UNSET
    try:
        record = await update_assignment(
            assignment_id,
            title=payload.title,
            description=payload.description,
            questions=[q.model_dump() for q in payload.questions]
            if payload.questions is not None
            else None,
            weight=payload.weight,
            attempt_limit=payload.attempt_limit,
            due_at=payload.due_at,
            is_timed=payload.is_timed,
            time_limit_minutes=(
                payload.time_limit_minutes
                if "time_limit_minutes" in payload.model_fields_set
                else _UNSET
            ),
            is_major=payload.is_major,
            passing_score=(
                payload.passing_score
                if "passing_score" in payload.model_fields_set
                else _UNSET
            ),
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
    assignment = await _get_assignment_or_404(assignment_id)
    await _require_manage_access(current, assignment)
    if not assignment.get("questions"):
        raise HTTPException(status_code=400, detail="Add at least one question before publishing")
    record = await publish_assignment(assignment_id)
    return {"assignment": record}


@router.post("/assignments/{assignment_id}/unpublish")
async def unpublish_assignment_endpoint(
    assignment_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    """Revert a published assignment to draft. Existing submissions are
    preserved; no new submissions accepted while in draft."""
    assignment = await _get_assignment_or_404(assignment_id)
    await _require_manage_access(current, assignment)
    record = await unpublish_assignment(assignment_id)
    return {"assignment": record}


@router.delete("/assignments/{assignment_id}")
async def delete_assignment_endpoint(
    assignment_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    assignment = await _get_assignment_or_404(assignment_id)
    await _require_manage_access(current, assignment)
    await delete_assignment(assignment_id)
    return {"ok": True}


@router.post("/assignments/{assignment_id}/submit")
async def submit_assignment_endpoint(
    assignment_id: str,
    payload: SubmitPayload,
    current: TokenPayload | None = Depends(require_auth),
) -> dict[str, Any]:
    assignment = await _get_assignment_or_404(assignment_id)
    if assignment["status"] != "published":
        raise HTTPException(status_code=400, detail="This assignment is not open for submissions")
    course_unit_id = assignment["course_unit_id"]
    user_id = current.user_id if current else ""
    if not await is_approved_student_of(user_id, course_unit_id):
        raise HTTPException(status_code=403, detail=_enrollment_error_detail(current))

    # A2/A3: check per-student access grant for deadline extension and extra
    # attempts before proceeding with the submit flow.
    grant = await get_access_grant(assignment_id, user_id)

    # A2: due_at enforcement — reject if past deadline (respects per-student
    # extended_due_at from an access grant).
    try:
        check_due_at(assignment, grant)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # A3: effective attempt limit — base + extra_attempts from grant. Round 3:
    # also hard-capped at 1 if the assignment is_major, regardless of the
    # stored attempt_limit value (see get_effective_attempt_limit).
    attempt_limit = get_effective_attempt_limit(assignment, grant)

    # Round 3 retake policy: reject early (before spending LLM tokens on
    # grading) if the student has exhausted their attempts OR — for a
    # non-major assignment with a passing_score configured — already cleared
    # it on a previous submission. This is the same check used to build the
    # student-facing view (get_assignment_endpoint), so the UI and this
    # enforcement can't drift apart. This is one shared code path regardless
    # of whether the request came from a manual "Submit" click or the
    # client's timer auto-submit — both hit this same endpoint.
    attempts_count = await count_submissions(assignment_id, user_id)
    latest_submission = await get_latest_submission(assignment_id, user_id)
    block = get_retake_block_reason(assignment, grant, attempts_count, latest_submission)
    if block is not None:
        raise HTTPException(status_code=400, detail=block[1])

    # The submit flow uses two short Postgres transactions with
    # `pg_advisory_xact_lock` per (assignment, student), with the LLM grading
    # call BETWEEN them holding no DB resources:
    #
    #   txn1: advisory_lock + count → raise if >= limit (fail-fast) → release
    #   LLM: await grade_submission(...) — no transaction/lock held
    #   txn2: advisory_lock + re-count + insert → raise if >= limit → release
    try:
        await check_attempt_limit(assignment_id, user_id, attempt_limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    answers = [a.model_dump() for a in payload.answers]
    question_results, score, max_score = await grade_submission(assignment, answers)

    try:
        record = await create_submission_checked(
            assignment_id,
            user_id,
            answers=answers,
            question_results=question_results,
            score=score,
            max_score=max_score,
            attempt_limit=attempt_limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"submission": record}


@router.get("/assignments/{assignment_id}/submissions")
async def list_submissions_endpoint(
    assignment_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    assignment = await _get_assignment_or_404(assignment_id)
    await _require_manage_access(current, assignment)
    submissions = []
    for record in await list_submissions_for_assignment(assignment_id):
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
    assignment = await _get_assignment_or_404(assignment_id)
    user_id = current.user_id if current else ""
    if not await is_approved_student_of(user_id, assignment["course_unit_id"]):
        raise HTTPException(status_code=403, detail=_enrollment_error_detail(current))
    return {"submission": await get_latest_submission(assignment_id, user_id)}


async def _require_course_unit_manage_access(current: TokenPayload, course_unit_id: str) -> None:
    if await get_course_unit(course_unit_id) is None:
        raise HTTPException(status_code=404, detail="Course unit not found")
    if not await _manages_course_unit(current, course_unit_id):
        raise HTTPException(status_code=403, detail="You do not manage this course unit")


@router.get("/course-units/{course_unit_id}/gradebook")
async def get_gradebook_endpoint(
    course_unit_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    await _require_course_unit_manage_access(current, course_unit_id)
    return await build_gradebook(course_unit_id)


@router.get("/course-units/{course_unit_id}/gradebook/export")
async def export_gradebook_csv_endpoint(
    course_unit_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> PlainTextResponse:
    await _require_course_unit_manage_access(current, course_unit_id)
    unit = await get_course_unit(course_unit_id)
    csv_text = await build_gradebook_csv(course_unit_id)
    safe_name = "".join(c if c.isalnum() or c in "-_ " else "_" for c in unit["name"]).strip() or "gradebook"
    return PlainTextResponse(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.csv"'},
    )


# ---------------------------------------------------------------------------
# Access grants (A3) — per-student exception/emergency access endpoints
# ---------------------------------------------------------------------------


class AccessGrantPayload(BaseModel):
    user_id: str
    extra_attempts: int | None = None
    extended_due_at: str | None = None


@router.get("/assignments/{assignment_id}/access-grants")
async def list_access_grants_endpoint(
    assignment_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    """List all per-student access grants for an assignment."""
    assignment = await _get_assignment_or_404(assignment_id)
    await _require_manage_access(current, assignment)
    grants = await list_access_grants_for_assignment(assignment_id)
    return {"grants": grants}


@router.post("/assignments/{assignment_id}/access-grants")
async def create_access_grant_endpoint(
    assignment_id: str,
    payload: AccessGrantPayload,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    """Create or update a per-student access grant (extra attempts and/or
    extended deadline) for a specific student on this assignment."""
    assignment = await _get_assignment_or_404(assignment_id)
    await _require_manage_access(current, assignment)
    if get_user_by_id(payload.user_id) is None:
        raise HTTPException(status_code=404, detail="Student not found")
    grant = await upsert_access_grant(
        assignment_id,
        payload.user_id,
        extra_attempts=payload.extra_attempts,
        extended_due_at=payload.extended_due_at,
        granted_by=current.user_id,
    )
    return {"grant": grant}


@router.delete("/assignments/{assignment_id}/access-grants/{user_id}")
async def revoke_access_grant_endpoint(
    assignment_id: str,
    user_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    """Revoke a per-student access grant."""
    assignment = await _get_assignment_or_404(assignment_id)
    await _require_manage_access(current, assignment)
    removed = await revoke_access_grant(assignment_id, user_id)
    if not removed:
        raise HTTPException(status_code=404, detail="No access grant found for this student")
    return {"ok": True}
