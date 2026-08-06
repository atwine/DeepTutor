"""Admin APIs for the optional multi-user layer."""

from __future__ import annotations

import asyncio
import logging
import mimetypes
from pathlib import Path
from typing import Any

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, field_validator

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
    check_and_mark_completion,
    count_course_units,
    count_course_units_for_instructor,
    count_course_units_for_student,
    count_enrollments_for_course,
    create_course_unit,
    create_material_record,
    delete_course_unit,
    delete_material,
    enroll_student,
    get_course_kb_name,
    get_course_unit,
    get_material,
    get_material_orm,
    is_approved_student_of,
    is_instructor_of,
    list_course_units,
    list_course_units_for_instructor,
    list_course_units_for_student,
    list_enrollments_for_course,
    list_enrollments_for_student,
    list_leave_requests_for_course,
    list_materials_for_course,
    publish_material,
    reject_leave,
    request_enrollment,
    request_leave,
    unarchive_course_unit,
    unpublish_material,
    unenroll_student,
    update_course_unit,
    update_ingestion_status,
)
from .grants import load_grant, save_grant
from .gradebook import build_instructor_report, build_instructor_report_csv
from .identity import get_user_by_id, get_users_by_ids, list_user_info, search_enrollable_users
from .knowledge_access import admin_kb_base_dir
from .model_access import is_owner_bound
from .paths import get_admin_path_service
from deeptutor.services.db import session_scope
from deeptutor.services.db.models import (
    Assignment,
    CourseUnit,
    Enrollment,
    Submission,
)
from sqlalchemy import func, select

logger = logging.getLogger(__name__)

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


async def _require_assignable_user(user_id: str) -> tuple[str, dict[str, Any]]:
    user_record = await get_user_by_id(user_id)
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
    await _require_assignable_user(user_id)
    return {"grant": load_grant(user_id)}


@router.put("/users/{user_id}/grants")
async def put_user_grants(
    user_id: str,
    payload: GrantPayload,
    _: object = Depends(require_admin),
) -> dict[str, Any]:
    await _require_assignable_user(user_id)
    try:
        grant = await save_grant(user_id, payload.grant)
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
    return {"users": await list_user_info()}


# ---------------------------------------------------------------------------
# Course units — instructors manage only the units they're attached to;
# admins manage all of them. (Re)assigning a unit's instructor_ids is
# admin-only (see update_course_unit_endpoint below); B4 lets an instructor
# create a unit with themselves auto-added, but they can't hand it to/take
# it from someone else afterward without an admin.
# ---------------------------------------------------------------------------


class CourseUnitCreate(BaseModel):
    name: str
    term: str = ""
    description: str = ""
    instructor_ids: list[str] = []
    start_date: str = ""
    end_date: str = ""

    # Issue #61: the frontend form enforces "Name is required" client-side
    # only — nothing stopped a direct API call from creating a permanently
    # blank, unlabeled course unit that clutters Browse Courses for everyone.
    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Course unit name is required.")
        return trimmed


class CourseUnitUpdate(BaseModel):
    name: str | None = None
    term: str | None = None
    description: str | None = None
    instructor_ids: list[str] | None = None
    start_date: str | None = None
    end_date: str | None = None

    # Issue #61: same gap on update — a caller could rename an existing
    # course unit to a blank name.
    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, value: str | None) -> str | None:
        if value is None:
            return value
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Course unit name is required.")
        return trimmed


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


async def _with_instructor_names(
    unit: dict[str, Any],
    user_records: dict[str, tuple[str, dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    """Attach resolved usernames for ``instructor_ids``.

    ``GET /users`` (the only place that lists every account) is admin-only, so
    an instructor viewing their own course unit has no other way to learn a
    co-instructor's username — without this, they'd see a bare user id.

    Issue #37: ``user_records`` is an optional pre-loaded batch from
    ``get_users_by_ids()``. When provided, each instructor lookup is an
    O(1) dict get instead of a full ``load_users()`` file read + scan.
    Use ``_with_instructor_names_batch()`` when processing a list of
    course units — it collects all instructor_ids across all units and
    does a single batched lookup.
    """
    names = []
    for uid in unit.get("instructor_ids", []):
        if user_records is not None:
            user_record = user_records.get(uid)
        else:
            user_record = await get_user_by_id(uid)
        names.append(user_record[0] if user_record is not None else uid)
    return {**unit, "instructor_usernames": names}


async def _with_instructor_names_batch(units: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Issue #37: Batched version of :func:`_with_instructor_names` for
    list endpoints. Collects all instructor_ids across all course units,
    does a **single** ``get_users_by_ids()`` call, then maps over the
    units with the pre-loaded dict — eliminating the N+1 where each unit
    was doing its own per-instructor file read."""
    all_instructor_ids: list[str] = []
    for unit in units:
        all_instructor_ids.extend(unit.get("instructor_ids", []))
    user_records = await get_users_by_ids(all_instructor_ids)
    return [await _with_instructor_names(u, user_records) for u in units]


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
    return {"course_unit": await _with_instructor_names(record)}


@router.get("/course-units")
async def list_course_units_endpoint(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    """Management view: admins see every course unit, instructors see only
    the ones they're attached to."""
    if current.role == "admin":
        units = await list_course_units(limit=limit, offset=offset)
        total = await count_course_units()
    else:
        units = await list_course_units_for_instructor(current.user_id, limit=limit, offset=offset)
        total = await count_course_units_for_instructor(current.user_id)
    return {"course_units": await _with_instructor_names_batch(units), "total": total, "limit": limit, "offset": offset}


@router.get("/course-units/catalog")
async def course_unit_catalog_endpoint(
    current: TokenPayload | None = Depends(require_auth),
) -> dict[str, Any]:
    """Every course unit, open to any signed-in account, annotated with the
    caller's own enrollment status (None/"pending"/"approved"/"teaching") —
    the student-facing "what can I join" browse view. Distinct from
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
    catalog = []
    filtered_units = []
    for unit in await list_course_units():
        if unit.get("is_archived") and unit["id"] not in status_by_unit:
            continue
        filtered_units.append(unit)
    # Issue #37: batch instructor name lookup — one file read for all
    # course units instead of one per unit.
    instructor_records = await get_users_by_ids(
        [uid for u in filtered_units for uid in u.get("instructor_ids", [])]
    )
    for unit in filtered_units:
        # An instructor browsing the catalog sees their own course(s) as
        # "teaching", not "Request to join" — they already have full access
        # via /my/course-units, and a join request against a course they
        # teach makes no sense. This only overrides *their own* units; an
        # instructor's join status on a colleague's course still resolves
        # from the enrollment lookup above like any other account.
        my_status = (
            "teaching"
            if user_id and user_id in unit.get("instructor_ids", [])
            else status_by_unit.get(unit["id"])
        )
        # Issue #4: for an approved student, check whether all published
        # assignments are submitted+graded and auto-mark completion. The
        # check is idempotent (only sets completed_at once) and never
        # revokes read access. "" for non-approved/teaching units.
        completed_at = ""
        if my_status == "approved" and user_id:
            completed_at = await check_and_mark_completion(unit["id"], user_id)
        catalog.append(
            {
                **await _with_instructor_names(unit, instructor_records),
                "my_status": my_status,
                "completed_at": completed_at,
            }
        )
    return {"course_units": catalog}


@router.get("/my/course-units")
async def my_course_units_endpoint(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current: TokenPayload | None = Depends(require_auth),
) -> dict[str, Any]:
    """Any authenticated account's own view: admins see everything,
    instructors see the units they teach, students see the units they're
    enrolled in."""
    if current is None or current.role == "admin":
        units = await list_course_units(limit=limit, offset=offset)
        total = await count_course_units()
    elif current.role == "instructor":
        units = await list_course_units_for_instructor(current.user_id, limit=limit, offset=offset)
        total = await count_course_units_for_instructor(current.user_id)
    else:
        units = await list_course_units_for_student(current.user_id, limit=limit, offset=offset)
        total = await count_course_units_for_student(current.user_id)
    return {"course_units": await _with_instructor_names_batch(units), "total": total, "limit": limit, "offset": offset}


@router.get("/course-units/{course_unit_id}")
async def get_course_unit_endpoint(
    course_unit_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    unit = await _require_course_unit_access(current, course_unit_id)
    return {"course_unit": await _with_instructor_names(unit)}


@router.put("/course-units/{course_unit_id}")
async def update_course_unit_endpoint(
    course_unit_id: str,
    payload: CourseUnitUpdate,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    """Round 4 Task 2 decision: opened up to instructor-or-admin (was
    admin-only), with the standard ``_require_course_unit_access`` ownership
    check — matching every other course-unit-scoped endpoint in this file
    (archive/unarchive, roster, gradebook, notes, leave-requests, etc.), all
    of which already let an instructor manage their own unit without an
    admin in the loop. Metadata edits (name/term/description/dates) carry
    the same risk profile as those already-open actions.

    ``instructor_ids`` reassignment is the one field on this payload that's
    NOT extended to instructors: it's the same "who has the keys to this
    course" concern B4 already drew a line around for creation (an
    instructor can add themselves when creating, but not freely add/remove
    others). Letting any instructor-of-the-unit silently reassign
    instructor_ids would let them unilaterally drop a co-instructor or hand
    the course to an arbitrary user id with no admin involved — a real
    privilege-escalation-shaped risk, not just a "bigger blast radius"
    inconvenience. So: non-admin callers have any ``instructor_ids`` in
    their payload ignored (the rest of the update still applies) rather than
    rejecting the whole request — the admin-only course-unit form is the
    only UI surface that shows the instructor picker at all (see
    ``web/app/(admin)/admin/course-units/page.tsx``), so a non-admin client
    should never legitimately be sending this field in the first place.
    """
    await _require_course_unit_access(current, course_unit_id)
    instructor_ids = payload.instructor_ids if current.role == "admin" else None
    record = await update_course_unit(
        course_unit_id,
        name=payload.name,
        term=payload.term,
        description=payload.description,
        instructor_ids=instructor_ids,
        start_date=payload.start_date,
        end_date=payload.end_date,
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Course unit not found")
    log_admin_action(
        "course_unit_update",
        summary={"course_unit_id": course_unit_id, "by_role": current.role},
    )
    return {"course_unit": await _with_instructor_names(record)}


@router.delete("/course-units/{course_unit_id}")
async def delete_course_unit_endpoint(
    course_unit_id: str,
    _: TokenPayload = Depends(require_admin),
) -> dict[str, Any]:
    """Round 4 Task 2 decision: stays admin-only, deliberately NOT opened to
    instructor-or-admin like every other course-unit endpoint in this file.
    Unlike archive (fully reversible) or the update endpoint above (metadata
    only, instructor_ids guarded separately), delete is irreversible and
    cascades away every assignment, submission, and course-book/notes link
    under the unit (see CourseUnit's ON DELETE CASCADE relationships in
    deeptutor/services/db/models.py) — a single instructor's mistake or
    account compromise can destroy another instructor's (on a co-taught
    unit) grade history with no undo. That asymmetry — one instructor
    action permanently destroying another instructor's data with no admin
    checkpoint — is enough to keep this admin-gated even though it's an
    outlier next to the rest of this file's instructor-or-admin pattern.
    Archive already covers the reversible "I'm done with this course"
    case for instructors; delete is for admins cleaning up for real.
    """
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
    return {"course_unit": await _with_instructor_names(record)}


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
    return {"course_unit": await _with_instructor_names(record)}


@router.post("/course-units/{course_unit_id}/enrollments")
async def enroll_student_endpoint(
    course_unit_id: str,
    payload: EnrollmentPayload,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    await _require_course_unit_access(current, course_unit_id)
    if await get_user_by_id(payload.user_id) is None:
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


async def _enrollment_with_student_info(
    enrollment: dict[str, Any],
    user_records: dict[str, tuple[str, dict[str, Any]]] | None = None,
) -> dict[str, Any] | None:
    """Attach username/full_name/registration_number to an enrollment dict.

    Issue #37: ``user_records`` is an optional pre-loaded batch from
    ``get_users_by_ids()``. When provided, the lookup is an O(1) dict
    get instead of a full ``load_users()`` file read + linear scan per
    enrollment. Callers that process multiple enrollments (roster,
    requests, leave-requests) should batch-load all user_ids first and
    pass the result here.
    """
    user_id = enrollment["user_id"]
    if user_records is not None:
        user_record = user_records.get(user_id)
    else:
        user_record = await get_user_by_id(user_id)
    if user_record is None:
        return None
    username, record = user_record
    return {
        "user_id": user_id,
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
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    """Approved enrollments only — a pending request belongs on the
    /requests endpoint until an instructor decides on it."""
    await _require_course_unit_access(current, course_unit_id)
    enrollments = [
        e for e in await list_enrollments_for_course(course_unit_id, limit=limit, offset=offset)
        if e.get("status", "approved") == "approved"
    ]
    total = await count_enrollments_for_course(course_unit_id, status="approved")
    # Issue #37: batch user lookup — one file read instead of N.
    user_records = await get_users_by_ids([e["user_id"] for e in enrollments])
    roster = [
        info
        for enrollment in enrollments
        if (info := await _enrollment_with_student_info(enrollment, user_records)) is not None
    ]
    return {"roster": roster, "total": total, "limit": limit, "offset": offset}


@router.get("/course-units/{course_unit_id}/requests")
async def course_unit_requests_endpoint(
    course_unit_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    """Pending enrollment requests awaiting this course unit's instructor(s)."""
    await _require_course_unit_access(current, course_unit_id)
    enrollments = [
        e for e in await list_enrollments_for_course(course_unit_id)
        if e.get("status", "approved") == "pending"
    ]
    # Issue #37: batch user lookup — one file read instead of N.
    user_records = await get_users_by_ids([e["user_id"] for e in enrollments])
    requests = [
        info
        for enrollment in enrollments
        if (info := await _enrollment_with_student_info(enrollment, user_records)) is not None
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
    enrollments = await list_leave_requests_for_course(course_unit_id)
    # Issue #37: batch user lookup — one file read instead of N.
    user_records = await get_users_by_ids([e["user_id"] for e in enrollments])
    requests = [
        info
        for enrollment in enrollments
        if (info := await _enrollment_with_student_info(enrollment, user_records)) is not None
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
    return {"students": await search_enrollable_users(q)}

# ---------------------------------------------------------------------------
# Issue #3: Course materials -- instructor uploads + course-specific RAG
# ---------------------------------------------------------------------------


# Max upload size for course materials (mirrors DocumentValidator.MAX_FILE_SIZE
# in the KB upload path -- kept as a local constant so the materials endpoints
# don't pull in the document-validator dependency graph at import time).
_COURSE_MATERIAL_MAX_BYTES = 200 * 1024 * 1024  # 200 MB


def _course_kb_raw_dir(kb_name: str) -> Path:
    """Resolve the raw/ directory for a course KB. The course KB lives in the
    admin workspace's knowledge-bases root (see ``admin_kb_base_dir``)."""
    base = admin_kb_base_dir()
    kb_dir = base / kb_name
    raw_dir = kb_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    return raw_dir


def _is_rag_supported(filename: str) -> bool:
    """Whether the file's extension is supported by the RAG FileTypeRouter
    (i.e. it will actually be indexed). Files like .ipynb are accepted as
    uploads but not indexed -- their ingestion_status stays 'pending'."""
    from deeptutor.services.rag.file_routing import FileTypeRouter

    return FileTypeRouter.has_supported_extension(filename)


async def _run_material_indexing(
    kb_name: str, material_id: str, file_path: str
) -> None:
    """Background task: index an uploaded course material into the course KB.

    Mirrors the existing KB upload path (``run_upload_processing_task`` in
    ``knowledge.py``) but lighter -- a single file, no task-stream wiring. The
    material's ``ingestion_status`` is updated (pending -> indexing ->
    ready/failed) so the frontend can poll. Non-RAG-supported files (e.g.
    .ipynb) skip indexing and stay 'pending' -- they're still stored and
    downloadable, just not in the RAG index.
    """
    try:
        await update_ingestion_status(material_id, "indexing")
        from deeptutor.knowledge.progress_tracker import ProgressTracker
        from deeptutor.services.rag.factory import has_ready_provider_index
        from deeptutor.services.rag.service import RAGService

        # ProgressTracker.__init__ does base_dir / kb_name, so base_dir
        # must be a Path, not str (same fix as commit 1442ab2 for the
        # auto-provisioning path).
        base_dir = admin_kb_base_dir().resolve()
        progress_tracker = ProgressTracker(kb_name, base_dir)
        kb_dir = base_dir / kb_name

        # Course KBs are provisioned empty (create_directory_structure only --
        # no index is built at creation time because there are no documents
        # yet). So the first material upload must *initialize* the index
        # rather than *add to* it. DocumentAdder.__init__ checks for an
        # existing provider index and raises "Knowledge base not initialized"
        # if none exists, so we branch here: initialize on first upload,
        # add_documents on subsequent ones.
        if not has_ready_provider_index(kb_dir, None):
            rag_service = RAGService(kb_base_dir=str(base_dir))
            success = await rag_service.initialize(
                kb_name=kb_name,
                file_paths=[file_path],
            )
            if success:
                await update_ingestion_status(material_id, "ready")
            else:
                logger.warning(
                    "Material %s indexing failed: RAG initialize returned False",
                    material_id,
                )
                await update_ingestion_status(material_id, "failed")
            return

        # Subsequent uploads: incremental add via DocumentAdder.
        from deeptutor.knowledge.add_documents import DocumentAdder

        adder = DocumentAdder(
            kb_name=kb_name,
            base_dir=str(base_dir),
            progress_tracker=progress_tracker,
        )
        staged = adder.add_documents([file_path], allow_duplicates=False)
        if not staged:
            await update_ingestion_status(material_id, "ready")
            return
        index_result = await adder.process_new_documents(staged)
        if index_result.has_failures:
            logger.warning(
                "Material %s indexing had failures: %s",
                material_id,
                index_result.failure_summary(),
            )
            await update_ingestion_status(material_id, "failed")
        else:
            adder.update_metadata(index_result.processed_count)
            await update_ingestion_status(material_id, "ready")
    except Exception as exc:
        logger.warning("Material %s indexing failed: %s", material_id, exc)
        await update_ingestion_status(material_id, "failed")


@router.post("/admin/course-units/{course_unit_id}/materials/upload")
async def upload_course_materials(
    course_unit_id: str,
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    """Upload one or more course materials (PDFs, notebooks, books) to the
    course unit's auto-provisioned RAG KB. Files are saved to the KB's raw/
    directory, a CourseMaterial record is created (status='draft',
    ingestion_status='pending'), and background indexing is triggered.

    Permission: instructor_or_admin (must be an instructor of this unit).
    """
    await _require_course_unit_access(current, course_unit_id)
    kb_name = await get_course_kb_name(course_unit_id)
    if not kb_name:
        raise HTTPException(
            status_code=409,
            detail="This course unit has no knowledge base provisioned. "
            "Contact an admin to provision one.",
        )
    raw_dir = _course_kb_raw_dir(kb_name)
    materials: list[dict[str, Any]] = []
    for upload in files:
        original = upload.filename or "upload"
        # Sanitize the filename -- strip path components, keep the extension.
        safe_name = Path(original).name
        if not safe_name or safe_name.startswith((".", "..")):
            raise HTTPException(
                status_code=400, detail=f"Invalid filename: {original}"
            )
        dest = raw_dir / safe_name
        # Avoid clobbering an existing file -- append a short suffix on collision.
        if dest.exists():
            stem = dest.stem
            suffix = dest.suffix
            import uuid as _uuid

            dest = raw_dir / f"{stem}_{_uuid.uuid4().hex[:8]}{suffix}"
        written = 0
        upload.file.seek(0)
        with open(dest, "wb") as buf:
            for chunk in iter(lambda: upload.file.read(8192), b""):
                written += len(chunk)
                if written > _COURSE_MATERIAL_MAX_BYTES:
                    buf.close()
                    dest.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=400,
                        detail=f"File '{original}' exceeds the 200 MB size limit",
                    )
                buf.write(chunk)
        rel_path = dest.relative_to(raw_dir).as_posix()
        record = await create_material_record(
            course_unit_id=course_unit_id,
            filename=dest.name,
            file_path=rel_path,
            size_bytes=written,
        )
        # Trigger background indexing only for RAG-supported files. Non-RAG
        # files (e.g. .ipynb) stay 'pending' -- they're stored and downloadable
        # but not in the RAG index.
        if _is_rag_supported(dest.name):
            background_tasks.add_task(
                _run_material_indexing,
                kb_name=kb_name,
                material_id=record["id"],
                file_path=str(dest),
            )
        materials.append(record)
    log_admin_action(
        "course_material_upload",
        summary={
            "course_unit_id": course_unit_id,
            "count": len(materials),
            "by_role": current.role,
        },
    )
    return {"materials": materials}


@router.get("/admin/course-units/{course_unit_id}/materials")
async def list_course_materials(
    course_unit_id: str,
    current: TokenPayload | None = Depends(require_auth),
) -> dict[str, Any]:
    """List course materials for a course unit.

    Instructors/admins see ALL materials (including draft). Students see ONLY
    published materials, and only if they're enrolled in the unit.
    """
    unit = await get_course_unit(course_unit_id)
    if unit is None:
        raise HTTPException(status_code=404, detail="Course unit not found")
    is_manager = (
        current is not None
        and (
            current.role == "admin"
            or (current.role == "instructor" and await is_instructor_of(current.user_id, course_unit_id))
        )
    )
    if is_manager:
        materials = await list_materials_for_course(course_unit_id, include_draft=True)
    else:
        # Student (or unauthenticated when AUTH_ENABLED=false -> local admin,
        # which is_manager already caught). Must be enrolled to see anything.
        user_id = current.user_id if current else ""
        if not user_id or not await is_approved_student_of(user_id, course_unit_id):
            raise HTTPException(
                status_code=403,
                detail="You are not enrolled in this course unit",
            )
        materials = await list_materials_for_course(course_unit_id, include_draft=False)
    return {"materials": materials}


@router.post("/admin/course-units/{course_unit_id}/materials/{material_id}/publish")
async def publish_course_material(
    course_unit_id: str,
    material_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    """Publish a course material -- makes it visible/downloadable to enrolled
    students. Permission: instructor_or_admin (must be an instructor of this unit)."""
    await _require_course_unit_access(current, course_unit_id)
    record = await publish_material(course_unit_id, material_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Material not found")
    log_admin_action(
        "course_material_publish",
        summary={"course_unit_id": course_unit_id, "material_id": material_id},
    )
    return {"material": record}


@router.post("/admin/course-units/{course_unit_id}/materials/{material_id}/unpublish")
async def unpublish_course_material(
    course_unit_id: str,
    material_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    """Unpublish a course material -- reverts it to draft (hidden from students).
    Permission: instructor_or_admin (must be an instructor of this unit)."""
    await _require_course_unit_access(current, course_unit_id)
    record = await unpublish_material(course_unit_id, material_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Material not found")
    log_admin_action(
        "course_material_unpublish",
        summary={"course_unit_id": course_unit_id, "material_id": material_id},
    )
    return {"material": record}


@router.delete("/admin/course-units/{course_unit_id}/materials/{material_id}")
async def delete_course_material(
    course_unit_id: str,
    material_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    """Delete a course material -- removes the physical file from the KB's raw/
    directory and the DB record. Permission: instructor_or_admin (must be an
    instructor of this unit). Returns 204 No Content."""
    await _require_course_unit_access(current, course_unit_id)
    material = await get_material_orm(course_unit_id, material_id)
    if material is None:
        raise HTTPException(status_code=404, detail="Material not found")
    # Remove the physical file from the KB's raw/ directory (best-effort).
    kb_name = await get_course_kb_name(course_unit_id)
    if kb_name:
        try:
            raw_dir = _course_kb_raw_dir(kb_name)
            file_path = raw_dir / material.file_path
            if file_path.exists():
                file_path.unlink()
        except Exception as exc:
            logger.warning(
                "Failed to remove material file %s: %s", material.file_path, exc
            )
    removed = await delete_material(course_unit_id, material_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Material not found")
    log_admin_action(
        "course_material_delete",
        summary={"course_unit_id": course_unit_id, "material_id": material_id},
    )
    # 204 No Content -- return an empty body with the correct status.
    from fastapi import Response

    return Response(status_code=204)


@router.get("/admin/course-units/{course_unit_id}/materials/{material_id}/download")
async def download_course_material(
    course_unit_id: str,
    material_id: str,
    current: TokenPayload | None = Depends(require_auth),
) -> FileResponse:
    """Download a course material's physical file. Students must be enrolled
    AND the material must be published; instructors/admins can download any
    material (including draft). Returns the file blob with appropriate
    Content-Type and Content-Disposition headers."""
    material = await get_material(course_unit_id, material_id)
    if material is None:
        raise HTTPException(status_code=404, detail="Material not found")
    is_manager = (
        current is not None
        and (
            current.role == "admin"
            or (current.role == "instructor" and await is_instructor_of(current.user_id, course_unit_id))
        )
    )
    if not is_manager:
        # Student path: must be enrolled AND material must be published.
        user_id = current.user_id if current else ""
        if not user_id or not await is_approved_student_of(user_id, course_unit_id):
            raise HTTPException(
                status_code=403,
                detail="You are not enrolled in this course unit",
            )
        if material["status"] != "published":
            raise HTTPException(status_code=404, detail="Material not found")
    kb_name = await get_course_kb_name(course_unit_id)
    if not kb_name:
        raise HTTPException(status_code=409, detail="Course KB not provisioned")
    raw_dir = _course_kb_raw_dir(kb_name)
    file_path = raw_dir / material["file_path"]
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Material file not found on disk")
    media_type, _ = mimetypes.guess_type(file_path.name)
    if media_type is None:
        media_type = "application/octet-stream"
    return FileResponse(
        path=str(file_path),
        media_type=media_type,
        filename=file_path.name,
        headers={
            "Content-Disposition": f'attachment; filename="{file_path.name}"',
        },
    )


# ---------------------------------------------------------------------------
# Issue #33: Admin student dashboard — overview with enrollment + completion
# ---------------------------------------------------------------------------


@router.get("/admin/students/overview")
async def admin_students_overview(
    current: TokenPayload = Depends(require_admin),
) -> dict[str, Any]:
    """Bird's-eye view of all students for the admin dashboard.

    Returns every student (role == "user") with their enrollment count,
    course names, submission count, and completion summary — all via
    batched queries (NOT per-student loops, see issue #31).

    Also returns aggregate stats for the dashboard header cards and a
    course list for the filter dropdown.
    """
    # 1. All students from the identity store (Postgres `users` table).
    all_users = await list_user_info()
    students = [u for u in all_users if u.get("role") == "user"]
    instructors = [u for u in all_users if u.get("role") == "instructor"]
    student_ids = {s["id"] for s in students}

    # 2. Batched enrollment query: count + course names per student.
    #    One query joins enrollments → course_units, grouped by user_id.
    async with session_scope() as session:
        # Enrollment counts per student (approved only).
        if student_ids:
            enrollment_rows = (
                await session.execute(
                    select(
                        Enrollment.user_id,
                        Enrollment.course_unit_id,
                        Enrollment.completed_at,
                        CourseUnit.name.label("course_name"),
                    )
                    .join(CourseUnit, Enrollment.course_unit_id == CourseUnit.id)
                    .where(Enrollment.status == "approved")
                    .where(Enrollment.user_id.in_(student_ids))
                )
            ).all()

            # Submission counts per student (across all assignments).
            submission_counts_raw = (
                await session.execute(
                    select(Submission.user_id, func.count(Submission.id))
                    .where(Submission.user_id.in_(student_ids))
                    .group_by(Submission.user_id)
                )
            ).all()
        else:
            enrollment_rows = []
            submission_counts_raw = []

        # Total published assignments per course (for completion math).
        assignment_counts_raw = (
            await session.execute(
                select(
                    Assignment.course_unit_id,
                    func.count(Assignment.id),
                )
                .where(Assignment.status == "published")
                .group_by(Assignment.course_unit_id)
            )
        ).all()

        # Total course units (for stats card).
        total_courses = (
            await session.execute(select(func.count(CourseUnit.id)))
        ).scalar_one()

    # Build per-student aggregates from the batched results.
    # enrollments_by_user: {user_id: [{course_unit_id, course_name, completed_at}, ...]}
    enrollments_by_user: dict[str, list[dict[str, Any]]] = {}
    for row in enrollment_rows:
        uid, cu_id, completed_at, course_name = row
        enrollments_by_user.setdefault(uid, []).append({
            "course_unit_id": cu_id,
            "course_name": course_name,
            "completed_at": completed_at.isoformat() if completed_at else "",
        })

    # submission_count_by_user: {user_id: int}
    submission_count_by_user = {uid: count for uid, count in submission_counts_raw}

    # assignment_count_by_course: {course_unit_id: int}
    assignment_count_by_course = {cu_id: count for cu_id, count in assignment_counts_raw}

    # Build the student rows.
    student_rows: list[dict[str, Any]] = []
    for s in students:
        uid = s["id"]
        enrollments = enrollments_by_user.get(uid, [])
        course_names = [e["course_name"] for e in enrollments]
        completed_count = sum(1 for e in enrollments if e["completed_at"])

        # Completion summary: "X/Y courses completed"
        total_enrolled = len(enrollments)
        completion_summary = {
            "completed": completed_count,
            "total": total_enrolled,
        }

        student_rows.append({
            "id": uid,
            "username": s["username"],
            "full_name": s.get("full_name") or "",
            "first_name": s.get("first_name") or "",
            "surname": s.get("surname") or "",
            "registration_number": s.get("registration_number") or "",
            "gender": s.get("gender") or "",
            "course": s.get("course") or "",
            "created_at": s.get("created_at") or "",
            "disabled": s.get("disabled", False),
            "avatar": s.get("avatar") or "",
            "enrollment_count": total_enrolled,
            "course_names": course_names,
            "submission_count": submission_count_by_user.get(uid, 0),
            "completion_summary": completion_summary,
        })

    # Sort by username for stable display.
    student_rows.sort(key=lambda r: r["username"])

    # Aggregate stats for the dashboard header cards.
    active_students = sum(1 for s in students if not s.get("disabled", False))
    disabled_students = sum(1 for s in students if s.get("disabled", False))
    orphan_students = sum(1 for r in student_rows if r["enrollment_count"] == 0)
    total_enrollments = sum(r["enrollment_count"] for r in student_rows)
    total_completions = sum(r["completion_summary"]["completed"] for r in student_rows)
    completion_rate = (
        round(total_completions / total_enrollments * 100, 1)
        if total_enrollments > 0
        else 0.0
    )

    # Course list for the filter dropdown — all course names that appear
    # in at least one student's enrollment.
    course_options = sorted({
        name for names in [r["course_names"] for r in student_rows] for name in names
    })

    return {
        "stats": {
            "total_students": len(students),
            "active_students": active_students,
            "disabled_students": disabled_students,
            "orphan_students": orphan_students,
            "total_instructors": len(instructors),
            "total_courses": total_courses,
            "total_enrollments": total_enrollments,
            "completion_rate": completion_rate,
        },
        "course_options": course_options,
        "students": student_rows,
    }


# ---------------------------------------------------------------------------
# Insights — org-wide statistics for admins (gender/course-type breakdown,
# per-course completion rates, term-over-term history). Deliberately
# surfaces numbers only — no automated "this course is underperforming"
# judgment calls; that reading is left to the admin looking at the chart.
# ---------------------------------------------------------------------------


@router.get("/admin/insights")
async def admin_insights(
    term: str = Query("", description="Filter to a single CourseUnit.term; empty = all terms"),
    _: TokenPayload = Depends(require_admin),
) -> dict[str, Any]:
    """Aggregate statistics for the admin Insights page.

    Everything here is computed from data that's already tracked per
    account (gender, course/degree) and per enrollment (created_at,
    completed_at) — no new fields, no backfill needed.

    Known gap, deliberately not papered over: this cannot report a
    "dropout" number. Unenrolling a student deletes their Enrollment row
    outright (see unenroll_student), so once someone leaves a course there
    is no trace left to count. Tracking dropouts would mean switching
    unenroll to a soft status instead of a delete — a separate, larger
    change than this endpoint.
    """
    all_users = await list_user_info()
    students = [u for u in all_users if u.get("role") == "user"]
    student_ids = {s["id"] for s in students}

    async with session_scope() as session:
        terms_raw = (
            await session.execute(
                select(CourseUnit.term).where(CourseUnit.term != "").distinct()
            )
        ).all()
        terms = sorted({t for (t,) in terms_raw})

        course_query = select(CourseUnit.id, CourseUnit.name, CourseUnit.term)
        if term:
            course_query = course_query.where(CourseUnit.term == term)
        courses = (await session.execute(course_query)).all()
        course_ids = [c.id for c in courses]

        enrollment_rows: list[Any] = []
        if course_ids and student_ids:
            enrollment_rows = (
                await session.execute(
                    select(
                        Enrollment.user_id,
                        Enrollment.course_unit_id,
                        Enrollment.completed_at,
                    )
                    .where(Enrollment.status == "approved")
                    .where(Enrollment.course_unit_id.in_(course_ids))
                    .where(Enrollment.user_id.in_(student_ids))
                )
            ).all()

    # Students who have at least one approved enrollment in the filtered
    # term — the population the gender/course-type breakdown below scopes
    # to when a term filter is active (when it isn't, every student counts).
    enrolled_student_ids = {row.user_id for row in enrollment_rows}
    breakdown_population = (
        [s for s in students if s["id"] in enrolled_student_ids] if term else students
    )

    def _percent_breakdown(values: list[str], labels: dict[str, str]) -> dict[str, Any]:
        counts: dict[str, int] = {label: 0 for label in labels.values()}
        counts["Unspecified"] = 0
        for raw in values:
            key = labels.get(str(raw or "").strip().lower(), "Unspecified")
            counts[key] += 1
        total = sum(counts.values())
        return {
            "counts": counts,
            "percentages": {
                k: round(v / total * 100, 1) if total else 0.0 for k, v in counts.items()
            },
            "total": total,
        }

    gender_breakdown = _percent_breakdown(
        [s.get("gender", "") for s in breakdown_population],
        {"male": "Male", "female": "Female"},
    )
    course_type_breakdown = _percent_breakdown(
        [s.get("course", "") for s in breakdown_population],
        {"masters": "Masters", "phd": "PhD"},
    )

    # Per-course enrolled/completed counts, from the same batched query.
    per_course_counts: dict[str, dict[str, int]] = {
        c.id: {"enrolled": 0, "completed": 0} for c in courses
    }
    for row in enrollment_rows:
        bucket = per_course_counts[row.course_unit_id]
        bucket["enrolled"] += 1
        if row.completed_at:
            bucket["completed"] += 1

    per_course = []
    for c in courses:
        counts = per_course_counts[c.id]
        rate = round(counts["completed"] / counts["enrolled"] * 100, 1) if counts["enrolled"] else 0.0
        per_course.append(
            {
                "id": c.id,
                "name": c.name,
                "term": c.term,
                "enrolled": counts["enrolled"],
                "completed": counts["completed"],
                "completion_rate": rate,
            }
        )
    per_course.sort(key=lambda r: r["completion_rate"], reverse=True)

    total_enrolled = sum(c["enrolled"] for c in per_course)
    total_completed = sum(c["completed"] for c in per_course)
    overall_completion_rate = (
        round(total_completed / total_enrolled * 100, 1) if total_enrolled else 0.0
    )

    return {
        "terms": terms,
        "selected_term": term,
        "stats": {
            "total_students": len(breakdown_population),
            "total_courses": len(courses),
            "total_enrolled": total_enrolled,
            "total_completed": total_completed,
            "overall_completion_rate": overall_completion_rate,
        },
        "gender_breakdown": gender_breakdown,
        "course_type_breakdown": course_type_breakdown,
        "per_course": per_course,
    }


# ---------------------------------------------------------------------------
# Issue #34: Instructor student dashboard — scoped to instructor's own courses
# ---------------------------------------------------------------------------


@router.get("/instructor/students/overview")
async def instructor_students_overview(
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    """Bird's-eye view of students for an instructor — same shape as the
    admin endpoint (#33) but scoped to the courses this instructor teaches.

    Admins calling this endpoint get the admin-scoped view (all courses)
    instead — they have the admin dashboard for the global view, but this
    endpoint returning their (empty) instructor set would be confusing.
    """
    # Admins should use the admin endpoint — redirect them there logically
    # by returning the same data shape with all courses. But actually, an
    # admin doesn't teach courses, so their instructor set is empty. Return
    # an empty result with a note — they have /admin/students for the
    # global view.
    if current.role == "admin":
        return {
            "stats": {
                "total_students": 0,
                "active_students": 0,
                "disabled_students": 0,
                "orphan_students": 0,
                "total_instructors": 0,
                "total_courses": 0,
                "total_enrollments": 0,
                "completion_rate": 0.0,
            },
            "course_options": [],
            "students": [],
        }

    instructor_id = current.user_id

    # 1. Get the instructor's course units.
    my_units = await list_course_units_for_instructor(instructor_id)
    my_course_ids = {u["id"] for u in my_units}
    my_course_names = {u["id"]: u["name"] for u in my_units}

    if not my_course_ids:
        # Instructor teaches no courses — return empty.
        return {
            "stats": {
                "total_students": 0,
                "active_students": 0,
                "disabled_students": 0,
                "orphan_students": 0,
                "total_instructors": 0,
                "total_courses": 0,
                "total_enrollments": 0,
                "completion_rate": 0.0,
            },
            "course_options": [],
            "students": [],
        }

    # 2. Get all enrollments for the instructor's courses (approved only).
    async with session_scope() as session:
        enrollment_rows = (
            await session.execute(
                select(
                    Enrollment.user_id,
                    Enrollment.course_unit_id,
                    Enrollment.completed_at,
                )
                .where(Enrollment.status == "approved")
                .where(Enrollment.course_unit_id.in_(my_course_ids))
            )
        ).all()

        # Get the assignment IDs for the instructor's courses, then count
        # submissions per student for those assignments only.
        assignment_rows = (
            await session.execute(
                select(Assignment.id, Assignment.course_unit_id)
                .where(Assignment.course_unit_id.in_(my_course_ids))
                .where(Assignment.status == "published")
            )
        ).all()

        assignment_ids = [a[0] for a in assignment_rows]
        # assignment_count_by_course: {course_unit_id: int}
        assignment_count_by_course: dict[str, int] = {}
        for aid, cu_id in assignment_rows:
            assignment_count_by_course[cu_id] = assignment_count_by_course.get(cu_id, 0) + 1

        # Submission counts per student (only for this instructor's assignments).
        if assignment_ids:
            submission_counts_raw = (
                await session.execute(
                    select(Submission.user_id, func.count(Submission.id))
                    .where(Submission.assignment_id.in_(assignment_ids))
                    .group_by(Submission.user_id)
                )
            ).all()
        else:
            submission_counts_raw = []

    # 3. Collect the student user_ids and fetch their identity records.
    student_ids = {row[0] for row in enrollment_rows}
    all_users = await list_user_info()
    users_by_id = {u["id"]: u for u in all_users if u["id"] in student_ids}

    # 4. Build per-student aggregates.
    enrollments_by_user: dict[str, list[dict[str, Any]]] = {}
    for row in enrollment_rows:
        uid, cu_id, completed_at = row
        enrollments_by_user.setdefault(uid, []).append({
            "course_unit_id": cu_id,
            "course_name": my_course_names.get(cu_id, ""),
            "completed_at": completed_at.isoformat() if completed_at else "",
        })

    submission_count_by_user = {uid: count for uid, count in submission_counts_raw}

    student_rows: list[dict[str, Any]] = []
    for uid, user_info in users_by_id.items():
        enrollments = enrollments_by_user.get(uid, [])
        course_names = [e["course_name"] for e in enrollments if e["course_name"]]
        completed_count = sum(1 for e in enrollments if e["completed_at"])
        total_enrolled = len(enrollments)

        student_rows.append({
            "id": uid,
            "username": user_info["username"],
            "full_name": user_info.get("full_name") or "",
            "first_name": user_info.get("first_name") or "",
            "surname": user_info.get("surname") or "",
            "registration_number": user_info.get("registration_number") or "",
            "gender": user_info.get("gender") or "",
            "course": user_info.get("course") or "",
            "created_at": user_info.get("created_at") or "",
            "disabled": user_info.get("disabled", False),
            "avatar": user_info.get("avatar") or "",
            "enrollment_count": total_enrolled,
            "course_names": course_names,
            "submission_count": submission_count_by_user.get(uid, 0),
            "completion_summary": {
                "completed": completed_count,
                "total": total_enrolled,
            },
        })

    student_rows.sort(key=lambda r: r["username"])

    # 5. Aggregate stats (scoped to this instructor's courses).
    total_students = len(student_rows)
    active_students = sum(1 for s in student_rows if not s["disabled"])
    disabled_students = sum(1 for s in student_rows if s["disabled"])
    total_enrollments = sum(r["enrollment_count"] for r in student_rows)
    total_completions = sum(r["completion_summary"]["completed"] for r in student_rows)
    completion_rate = (
        round(total_completions / total_enrollments * 100, 1)
        if total_enrollments > 0
        else 0.0
    )

    course_options = sorted(my_course_names.values())

    return {
        "stats": {
            "total_students": total_students,
            "active_students": active_students,
            "disabled_students": disabled_students,
            "orphan_students": 0,  # Can't be an orphan if they're enrolled in this instructor's course
            "total_instructors": 0,  # Not relevant for the instructor view
            "total_courses": len(my_course_ids),
            "total_enrollments": total_enrollments,
            "completion_rate": completion_rate,
        },
        "course_options": course_options,
        "students": student_rows,
    }


# ---------------------------------------------------------------------------
# Issue #35: Admin actions from the student dashboard
# ---------------------------------------------------------------------------


@router.delete(
    "/admin/students/{user_id}/submissions/{assignment_id}",
)
async def admin_reset_submission_attempts(
    user_id: str,
    assignment_id: str,
    current: TokenPayload = Depends(require_admin),
) -> dict[str, Any]:
    """Delete all of a student's submissions for one assignment — the
    "reset attempts" admin action. Gives the student a clean slate as if
    they never submitted, so they can try again from scratch.

    Admin-only (the admin is the last-resort fixer). Instructors use the
    assignment access grant system for accommodations instead.
    """
    from sqlalchemy import delete as sa_delete

    async with session_scope() as session:
        result = await session.execute(
            sa_delete(Submission).where(
                Submission.assignment_id == assignment_id,
                Submission.user_id == str(user_id),
            )
        )
        deleted_count = result.rowcount

    if deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="No submissions found for this student/assignment pair",
        )

    log_admin_action(
        "reset_submission_attempts",
        summary={
            "user_id": user_id,
            "assignment_id": assignment_id,
            "deleted": deleted_count,
        },
    )
    return {"ok": True, "deleted": deleted_count}
