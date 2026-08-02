"""Admin APIs for the optional multi-user layer."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from deeptutor.api.routers.auth import (
    TokenPayload,
    require_admin,
    require_auth,
    require_instructor_or_admin,
)
from deeptutor.knowledge.manager import KnowledgeBaseManager
from deeptutor.services.config.model_catalog import ModelCatalogService
from deeptutor.services.skill.service import SkillService

from .audit import log_admin_action
from .course_units import (
    CourseUnitArchivedError,
    approve_enrollment,
    approve_leave,
    archive_course_unit,
    create_course_unit,
    delete_course_unit,
    enroll_student,
    get_course_unit,
    is_instructor_of,
    list_course_units,
    list_course_units_for_instructor,
    list_course_units_for_student,
    list_enrollments_for_course,
    list_enrollments_for_student,
    list_leave_requests_for_course,
    reject_leave,
    request_enrollment,
    request_leave,
    unarchive_course_unit,
    unenroll_student,
    update_course_unit,
)
from .grants import load_grant, save_grant
from .gradebook import build_instructor_report, build_instructor_report_csv
from .identity import get_user_by_id, list_user_info, search_enrollable_users
from .knowledge_access import admin_kb_base_dir
from .model_access import is_owner_bound
from .paths import get_admin_path_service

router = APIRouter()


class GrantPayload(BaseModel):
    grant: dict[str, Any]


class SkillInstallPayload(BaseModel):
    ref: str
    name: str | None = None
    force: bool = False
    allow_unverified: bool = False


def _admin_catalog_summary() -> dict[str, list[dict[str, Any]]]:
    catalog = ModelCatalogService(
        path=get_admin_path_service().get_settings_file("model_catalog")
    ).load()
    out: dict[str, list[dict[str, Any]]] = {"llm": []}
    for service, state in (catalog.get("services") or {}).items():
        if service not in out:
            continue
        for profile in state.get("profiles", []) or []:
            if is_owner_bound(profile):
                # Bound to one person's OAuth identity, so it is not assignable.
                # Listing it here would offer admins a grant the server drops.
                continue
            profile_id = str(profile.get("id") or "")
            models = []
            for model in profile.get("models", []) or []:
                models.append(
                    {
                        "model_id": model.get("id", ""),
                        "name": model.get("name") or model.get("model") or model.get("id"),
                        "model": model.get("model", ""),
                    }
                )
            out[service].append(
                {
                    "profile_id": profile_id,
                    "name": profile.get("name") or profile_id,
                    "models": models,
                }
            )
    return out


def _admin_kb_summary() -> list[dict[str, Any]]:
    manager = KnowledgeBaseManager(base_dir=str(admin_kb_base_dir()))
    return [
        {
            "resource_id": f"admin:kb:{name}",
            "name": name,
            "source": "admin",
        }
        for name in manager.list_knowledge_bases()
    ]


def _admin_skill_summary() -> list[dict[str, Any]]:
    root = get_admin_path_service().get_workspace_dir() / "skills"
    service = SkillService(root=root)
    return [item.to_dict() for item in service.list_skills()]


def _admin_partner_summary() -> list[dict[str, Any]]:
    """The partners an admin can assign. Partners are process-wide resources
    anchored at the admin workspace, so this lists them all (identity only — no
    channel wiring or model selection leaks into the assignable summary)."""
    from deeptutor.services.partners import get_partner_manager

    return [
        {
            "partner_id": str(item.get("partner_id") or ""),
            "name": item.get("name") or item.get("partner_id") or "",
            "description": item.get("description") or "",
            "emoji": item.get("emoji") or "",
        }
        for item in get_partner_manager().list_partners()
    ]


def _require_assignable_user(user_id: str) -> tuple[str, dict[str, Any]]:
    user_record = get_user_by_id(user_id)
    if user_record is None:
        raise HTTPException(status_code=404, detail="User not found")
    username, record = user_record
    if str(record.get("role") or "user") == "admin":
        raise HTTPException(
            status_code=403,
            detail="Admin users use the main workspace and cannot receive assignments.",
        )
    return username, record


@router.get("/admin/resources")
async def admin_resources(_: object = Depends(require_admin)) -> dict[str, Any]:
    """Everything an admin can assign to a user: models, KBs, skills, and
    the tool surface (system tools + MCP tools, same pool partners use)."""
    from deeptutor.api.utils.tool_options import build_tool_options

    tool_options = await build_tool_options()
    return {
        "models": _admin_catalog_summary(),
        "knowledge_bases": _admin_kb_summary(),
        "skills": _admin_skill_summary(),
        "partners": _admin_partner_summary(),
        "tools": tool_options["tools"],
        "mcp_tools": tool_options["mcp_tools"],
    }


@router.get("/users/{user_id}/grants")
async def get_user_grants(user_id: str, _: object = Depends(require_admin)) -> dict[str, Any]:
    _require_assignable_user(user_id)
    return {"grant": load_grant(user_id)}


@router.put("/users/{user_id}/grants")
async def put_user_grants(
    user_id: str,
    payload: GrantPayload,
    _: object = Depends(require_admin),
) -> dict[str, Any]:
    _require_assignable_user(user_id)
    try:
        grant = save_grant(user_id, payload.grant)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    log_admin_action(
        "grant_set",
        target_user_id=user_id,
        summary={
            "model_count": len(grant.get("models", {}).get("llm", []) or []),
            "kb_count": len(grant.get("knowledge_bases", []) or []),
            "skill_count": len(grant.get("skills", []) or []),
            "partner_count": len(grant.get("partners", []) or []),
            "enabled_tools": grant.get("enabled_tools"),
            "mcp_tool_count": (
                None if grant.get("mcp_tools") is None else len(grant.get("mcp_tools") or [])
            ),
            "exec_enabled": grant.get("exec_enabled"),
        },
    )
    return {"grant": grant}


@router.post("/admin/skills/install")
async def admin_install_skill(
    payload: SkillInstallPayload,
    _: object = Depends(require_admin),
) -> dict[str, Any]:
    """Install a hub skill into the admin catalog (``<hub>:<slug>[@version]``).

    The skill lands in the admin workspace — the same pool ``/admin/resources``
    lists — so it stays invisible to non-admin users until a grant assigns it.
    The install pipeline (verdict gate, safe extraction, ``always`` stripping)
    lives in :func:`deeptutor.services.skill.hub.install_from_hub`; this
    endpoint only chooses the target root and audits the action.
    """
    from deeptutor.services.skill.hub import HubError, install_from_hub
    from deeptutor.services.skill.service import (
        InvalidSkillNameError,
        SkillExistsError,
        SkillImportError,
    )

    service = SkillService(root=get_admin_path_service().get_workspace_dir() / "skills")
    try:
        outcome = await asyncio.to_thread(
            install_from_hub,
            payload.ref,
            service=service,
            rename_to=payload.name,
            force=payload.force,
            allow_unverified=payload.allow_unverified,
        )
    except SkillExistsError as exc:
        raise HTTPException(status_code=409, detail=f"Skill already exists: {exc}") from exc
    except (SkillImportError, InvalidSkillNameError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HubError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    log_admin_action(
        "skill_hub_install",
        summary={
            "ref": payload.ref,
            "installed_as": outcome.result.info.name,
            "version": outcome.ref.version,
            "verdict": outcome.verdict.status,
            "forced": payload.force,
            "allow_unverified": payload.allow_unverified,
        },
    )
    return {
        "skill": outcome.result.info.to_dict(),
        "verdict": {"status": outcome.verdict.status, "detail": outcome.verdict.detail},
        "version": outcome.ref.version,
        "skipped": [{"path": rel, "reason": reason} for rel, reason in outcome.result.skipped],
    }


@router.get("/users")
async def multi_user_list_users(_: object = Depends(require_admin)) -> dict[str, Any]:
    return {"users": list_user_info()}


# ---------------------------------------------------------------------------
# Course units — instructors manage only the units they're attached to;
# admins manage all of them. Creating a unit and (re)assigning its
# instructor(s) is an admin-only action, mirroring how grants are assigned.
# ---------------------------------------------------------------------------


class CourseUnitCreate(BaseModel):
    name: str
    term: str = ""
    description: str = ""
    instructor_ids: list[str] = []
    start_date: str = ""
    end_date: str = ""


class CourseUnitUpdate(BaseModel):
    name: str | None = None
    term: str | None = None
    description: str | None = None
    instructor_ids: list[str] | None = None
    start_date: str | None = None
    end_date: str | None = None


class EnrollmentPayload(BaseModel):
    user_id: str


async def _require_course_unit_access(payload: TokenPayload, course_unit_id: str) -> dict[str, Any]:
    unit = await get_course_unit(course_unit_id)
    if unit is None:
        raise HTTPException(status_code=404, detail="Course unit not found")
    if payload.role == "admin":
        return unit
    if payload.role == "instructor" and await is_instructor_of(payload.user_id, course_unit_id):
        return unit
    raise HTTPException(status_code=403, detail="You do not manage this course unit")


def _with_instructor_names(unit: dict[str, Any]) -> dict[str, Any]:
    """Attach resolved usernames for ``instructor_ids``.

    ``GET /users`` (the only place that lists every account) is admin-only, so
    an instructor viewing their own course unit has no other way to learn a
    co-instructor's username — without this, they'd see a bare user id.
    """
    names = []
    for uid in unit.get("instructor_ids", []):
        user_record = get_user_by_id(uid)
        names.append(user_record[0] if user_record is not None else uid)
    return {**unit, "instructor_usernames": names}


@router.post("/course-units")
async def create_course_unit_endpoint(
    payload: CourseUnitCreate,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    # B4: Instructors can now create their own course units (previously
    # admin-only). An instructor creating a course is automatically included
    # in instructor_ids — they can't create a course and assign it to someone
    # else without also being on it themselves. Admins keep the ability to
    # create for/assign anyone (no auto-add).
    instructor_ids = payload.instructor_ids
    if current.role == "instructor" and current.user_id not in instructor_ids:
        instructor_ids = [*instructor_ids, current.user_id]
    record = await create_course_unit(
        payload.name,
        payload.term,
        instructor_ids,
        payload.description,
        start_date=payload.start_date,
        end_date=payload.end_date,
    )
    log_admin_action(
        "course_unit_create",
        summary={"course_unit_id": record["id"], "name": record["name"]},
    )
    return {"course_unit": _with_instructor_names(record)}


@router.get("/course-units")
async def list_course_units_endpoint(
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    """Management view: admins see every course unit, instructors see only
    the ones they're attached to."""
    if current.role == "admin":
        units = await list_course_units()
    else:
        units = await list_course_units_for_instructor(current.user_id)
    return {"course_units": [_with_instructor_names(u) for u in units]}


@router.get("/course-units/catalog")
async def course_unit_catalog_endpoint(
    current: TokenPayload | None = Depends(require_auth),
) -> dict[str, Any]:
    """Every course unit, open to any signed-in account, annotated with the
    caller's own enrollment status (None/"pending"/"approved") — the
    student-facing "what can I join" browse view. Distinct from
    ``/course-units`` (the admin/instructor management view) and
    ``/my/course-units`` (units already approved/taught/administered).

    Registered before ``/course-units/{course_unit_id}`` deliberately: routes
    are matched in registration order, and without this ordering a request
    for "catalog" would be swallowed by the dynamic route as if "catalog"
    were a course_unit_id.
    """
    user_id = current.user_id if current else ""
    status_by_unit = {
        rec["course_unit_id"]: rec.get("status", "approved")
        for rec in await list_enrollments_for_student(user_id)
    }
    # Round 3: an archived unit shouldn't be discoverable as joinable by
    # someone with no existing relationship to it — but a student who's
    # already enrolled/pending/leave_requested on it still sees it here
    # (their access itself reads as blocked via _is_student_access_expired,
    # same as an expired course past its grace period; no special-case
    # needed beyond not surfacing it as a *new* thing to join).
    catalog = [
        {**_with_instructor_names(unit), "my_status": status_by_unit.get(unit["id"])}
        for unit in await list_course_units()
        if not unit.get("is_archived") or unit["id"] in status_by_unit
    ]
    return {"course_units": catalog}


@router.get("/my/course-units")
async def my_course_units_endpoint(
    current: TokenPayload | None = Depends(require_auth),
) -> dict[str, Any]:
    """Any authenticated account's own view: admins see everything,
    instructors see the units they teach, students see the units they're
    enrolled in."""
    if current is None or current.role == "admin":
        units = await list_course_units()
    elif current.role == "instructor":
        units = await list_course_units_for_instructor(current.user_id)
    else:
        units = await list_course_units_for_student(current.user_id)
    return {"course_units": [_with_instructor_names(u) for u in units]}


@router.get("/course-units/{course_unit_id}")
async def get_course_unit_endpoint(
    course_unit_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    unit = await _require_course_unit_access(current, course_unit_id)
    return {"course_unit": _with_instructor_names(unit)}


@router.put("/course-units/{course_unit_id}")
async def update_course_unit_endpoint(
    course_unit_id: str,
    payload: CourseUnitUpdate,
    _: TokenPayload = Depends(require_admin),
) -> dict[str, Any]:
    record = await update_course_unit(
        course_unit_id,
        name=payload.name,
        term=payload.term,
        description=payload.description,
        instructor_ids=payload.instructor_ids,
        start_date=payload.start_date,
        end_date=payload.end_date,
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Course unit not found")
    log_admin_action("course_unit_update", summary={"course_unit_id": course_unit_id})
    return {"course_unit": _with_instructor_names(record)}


@router.delete("/course-units/{course_unit_id}")
async def delete_course_unit_endpoint(
    course_unit_id: str,
    _: TokenPayload = Depends(require_admin),
) -> dict[str, Any]:
    removed = await delete_course_unit(course_unit_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Course unit not found")
    log_admin_action("course_unit_delete", summary={"course_unit_id": course_unit_id})
    return {"ok": True}


@router.post("/course-units/{course_unit_id}/archive")
async def archive_course_unit_endpoint(
    course_unit_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    """Round 3: Archive a course unit — instructor-of-that-unit or admin,
    same gating as the rest of this router's course-unit-scoped endpoints
    (``_require_course_unit_access``). Students immediately read as blocked
    from new actions on it (``_is_student_access_expired`` now also checks
    ``is_archived``); instructor/admin roster/gradebook/submission access is
    unaffected."""
    await _require_course_unit_access(current, course_unit_id)
    record = await archive_course_unit(course_unit_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Course unit not found")
    log_admin_action("course_unit_archive", summary={"course_unit_id": course_unit_id})
    return {"course_unit": _with_instructor_names(record)}


@router.post("/course-units/{course_unit_id}/unarchive")
async def unarchive_course_unit_endpoint(
    course_unit_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    """Round 3: Reverse of the archive endpoint above — same gating."""
    await _require_course_unit_access(current, course_unit_id)
    record = await unarchive_course_unit(course_unit_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Course unit not found")
    log_admin_action("course_unit_unarchive", summary={"course_unit_id": course_unit_id})
    return {"course_unit": _with_instructor_names(record)}


@router.post("/course-units/{course_unit_id}/enrollments")
async def enroll_student_endpoint(
    course_unit_id: str,
    payload: EnrollmentPayload,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    await _require_course_unit_access(current, course_unit_id)
    if get_user_by_id(payload.user_id) is None:
        raise HTTPException(status_code=404, detail="User not found")
    record = await enroll_student(course_unit_id, payload.user_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Course unit not found")
    return {"enrollment": record}


@router.delete("/course-units/{course_unit_id}/enrollments/{user_id}")
async def unenroll_student_endpoint(
    course_unit_id: str,
    user_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    await _require_course_unit_access(current, course_unit_id)
    removed = await unenroll_student(course_unit_id, user_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    return {"ok": True}


def _enrollment_with_student_info(enrollment: dict[str, Any]) -> dict[str, Any] | None:
    user_record = get_user_by_id(enrollment["user_id"])
    if user_record is None:
        return None
    username, record = user_record
    return {
        "user_id": enrollment["user_id"],
        "username": username,
        "role": record.get("role", "user"),
        "full_name": str(record.get("full_name") or ""),
        "registration_number": str(record.get("registration_number") or ""),
        "requested_at": enrollment.get("created_at", ""),
        "approved_at": enrollment.get("approved_at", ""),
    }


@router.get("/course-units/{course_unit_id}/roster")
async def course_unit_roster_endpoint(
    course_unit_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    """Approved enrollments only — a pending request belongs on the
    /requests endpoint until an instructor decides on it."""
    await _require_course_unit_access(current, course_unit_id)
    roster = [
        info
        for enrollment in await list_enrollments_for_course(course_unit_id)
        if enrollment.get("status", "approved") == "approved"
        and (info := _enrollment_with_student_info(enrollment)) is not None
    ]
    return {"roster": roster}


@router.get("/course-units/{course_unit_id}/requests")
async def course_unit_requests_endpoint(
    course_unit_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    """Pending enrollment requests awaiting this course unit's instructor(s)."""
    await _require_course_unit_access(current, course_unit_id)
    requests = [
        info
        for enrollment in await list_enrollments_for_course(course_unit_id)
        if enrollment.get("status", "approved") == "pending"
        and (info := _enrollment_with_student_info(enrollment)) is not None
    ]
    return {"requests": requests}


@router.post("/course-units/{course_unit_id}/requests/{user_id}/approve")
async def approve_enrollment_request_endpoint(
    course_unit_id: str,
    user_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    await _require_course_unit_access(current, course_unit_id)
    record = await approve_enrollment(course_unit_id, user_id)
    if record is None:
        raise HTTPException(status_code=404, detail="No pending request for this student")
    return {"enrollment": record}


@router.post("/course-units/{course_unit_id}/requests/{user_id}/reject")
async def reject_enrollment_request_endpoint(
    course_unit_id: str,
    user_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    await _require_course_unit_access(current, course_unit_id)
    removed = await unenroll_student(course_unit_id, user_id)
    if not removed:
        raise HTTPException(status_code=404, detail="No request found for this student")
    return {"ok": True}


@router.post("/course-units/{course_unit_id}/enrollment-requests")
async def request_enrollment_endpoint(
    course_unit_id: str,
    current: TokenPayload | None = Depends(require_auth),
) -> dict[str, Any]:
    """Student-initiated: request enrollment in a course unit found via the
    catalog. Creates a pending request for the instructor to approve."""
    from deeptutor.multi_user.models import LOCAL_ADMIN_ID

    user_id = current.user_id if current else LOCAL_ADMIN_ID
    try:
        record = await request_enrollment(course_unit_id, user_id)
    except CourseUnitArchivedError as exc:
        raise HTTPException(
            status_code=409,
            detail="This course unit is archived and not accepting new enrollment requests",
        ) from exc
    if record is None:
        raise HTTPException(status_code=404, detail="Course unit not found")
    return {"enrollment": record}


# ---------------------------------------------------------------------------
# Leave requests (B2) — student-initiated unenroll with instructor confirmation
# ---------------------------------------------------------------------------


@router.post("/course-units/{course_unit_id}/leave-requests")
async def request_leave_endpoint(
    course_unit_id: str,
    current: TokenPayload | None = Depends(require_auth),
) -> dict[str, Any]:
    """B2: Student-initiated: request to leave (unenroll from) a course unit.
    Creates a ``leave_requested`` status on the student's approved enrollment
    for the instructor to confirm or reject. The student is NOT unenrolled
    until the instructor confirms — the repo owner's note was explicit that
    the instructor confirms, not auto-removed on request alone."""
    from deeptutor.multi_user.models import LOCAL_ADMIN_ID

    user_id = current.user_id if current else LOCAL_ADMIN_ID
    record = await request_leave(course_unit_id, user_id)
    if record is None:
        raise HTTPException(
            status_code=404,
            detail="No approved enrollment found for this student in this course unit",
        )
    return {"enrollment": record}


@router.get("/course-units/{course_unit_id}/leave-requests")
async def list_leave_requests_endpoint(
    course_unit_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    """B2: Leave requests awaiting instructor confirmation for this course unit."""
    await _require_course_unit_access(current, course_unit_id)
    requests = [
        info
        for enrollment in await list_leave_requests_for_course(course_unit_id)
        if (info := _enrollment_with_student_info(enrollment)) is not None
    ]
    return {"requests": requests}


@router.post("/course-units/{course_unit_id}/leave-requests/{user_id}/approve")
async def approve_leave_request_endpoint(
    course_unit_id: str,
    user_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    """B2: Instructor confirms a leave request — removes the Enrollment row.
    The student's existing Submission rows are NOT deleted (kept for grading
    history/audit integrity)."""
    await _require_course_unit_access(current, course_unit_id)
    removed = await approve_leave(course_unit_id, user_id)
    if not removed:
        raise HTTPException(status_code=404, detail="No leave request found for this student")
    return {"ok": True}


@router.post("/course-units/{course_unit_id}/leave-requests/{user_id}/reject")
async def reject_leave_request_endpoint(
    course_unit_id: str,
    user_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    """B2: Instructor rejects a leave request — reverts enrollment status
    back to ``approved``."""
    await _require_course_unit_access(current, course_unit_id)
    record = await reject_leave(course_unit_id, user_id)
    if record is None:
        raise HTTPException(status_code=404, detail="No leave request found for this student")
    return {"enrollment": record}


# ---------------------------------------------------------------------------
# B3: Cross-course per-instructor compiled report
# ---------------------------------------------------------------------------


@router.get("/instructor/report")
async def instructor_report_endpoint(
    term: str = "",
    instructor_id: str = "",
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    """B3: Compiled gradebook data across every course unit the calling
    instructor teaches, optionally filtered by ``term``. Admins can query
    any instructor's report by passing ``instructor_id`` as a query param;
    instructors automatically get their own. Reuses ``build_gradebook``
    per unit — does NOT re-derive the weighted-average math."""
    target_id = instructor_id.strip() if current.role == "admin" and instructor_id.strip() else current.user_id
    term_filter = term.strip() or None
    return await build_instructor_report(target_id, term_filter)


@router.get("/instructor/report/export")
async def export_instructor_report_csv_endpoint(
    term: str = "",
    instructor_id: str = "",
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> PlainTextResponse:
    """B3: CSV export of the per-instructor compiled report."""
    target_id = instructor_id.strip() if current.role == "admin" and instructor_id.strip() else current.user_id
    term_filter = term.strip() or None
    csv_text = await build_instructor_report_csv(target_id, term_filter)
    return PlainTextResponse(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="instructor_report.csv"'},
    )


@router.get("/students/search")
async def search_students_endpoint(
    q: str = "",
    _: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    """Find student accounts by username, full name, or registration number —
    backs the enrollment picker. Scoped to role=="user" accounts and a
    minimal field set (see :func:`search_enrollable_users`), since ``GET
    /users`` (the full roster) is admin-only and instructors need a way to
    look someone up without it."""
    return {"students": search_enrollable_users(q)}
