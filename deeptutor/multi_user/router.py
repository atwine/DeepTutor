"""Admin APIs for the optional multi-user layer."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
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
    create_course_unit,
    delete_course_unit,
    enroll_student,
    get_course_unit,
    is_instructor_of,
    list_course_units,
    list_course_units_for_instructor,
    list_course_units_for_student,
    list_enrollments_for_course,
    unenroll_student,
    update_course_unit,
)
from .grants import load_grant, save_grant
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
    instructor_ids: list[str] = []


class CourseUnitUpdate(BaseModel):
    name: str | None = None
    term: str | None = None
    instructor_ids: list[str] | None = None


class EnrollmentPayload(BaseModel):
    user_id: str


def _require_course_unit_access(payload: TokenPayload, course_unit_id: str) -> dict[str, Any]:
    unit = get_course_unit(course_unit_id)
    if unit is None:
        raise HTTPException(status_code=404, detail="Course unit not found")
    if payload.role == "admin":
        return unit
    if payload.role == "instructor" and is_instructor_of(payload.user_id, course_unit_id):
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
    _: TokenPayload = Depends(require_admin),
) -> dict[str, Any]:
    record = create_course_unit(payload.name, payload.term, payload.instructor_ids)
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
        units = list_course_units()
    else:
        units = list_course_units_for_instructor(current.user_id)
    return {"course_units": [_with_instructor_names(u) for u in units]}


@router.get("/my/course-units")
async def my_course_units_endpoint(
    current: TokenPayload | None = Depends(require_auth),
) -> dict[str, Any]:
    """Any authenticated account's own view: admins see everything,
    instructors see the units they teach, students see the units they're
    enrolled in."""
    if current is None or current.role == "admin":
        units = list_course_units()
    elif current.role == "instructor":
        units = list_course_units_for_instructor(current.user_id)
    else:
        units = list_course_units_for_student(current.user_id)
    return {"course_units": [_with_instructor_names(u) for u in units]}


@router.get("/course-units/{course_unit_id}")
async def get_course_unit_endpoint(
    course_unit_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    unit = _require_course_unit_access(current, course_unit_id)
    return {"course_unit": _with_instructor_names(unit)}


@router.put("/course-units/{course_unit_id}")
async def update_course_unit_endpoint(
    course_unit_id: str,
    payload: CourseUnitUpdate,
    _: TokenPayload = Depends(require_admin),
) -> dict[str, Any]:
    record = update_course_unit(
        course_unit_id,
        name=payload.name,
        term=payload.term,
        instructor_ids=payload.instructor_ids,
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
    removed = delete_course_unit(course_unit_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Course unit not found")
    log_admin_action("course_unit_delete", summary={"course_unit_id": course_unit_id})
    return {"ok": True}


@router.post("/course-units/{course_unit_id}/enrollments")
async def enroll_student_endpoint(
    course_unit_id: str,
    payload: EnrollmentPayload,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    _require_course_unit_access(current, course_unit_id)
    if get_user_by_id(payload.user_id) is None:
        raise HTTPException(status_code=404, detail="User not found")
    record = enroll_student(course_unit_id, payload.user_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Course unit not found")
    return {"enrollment": record}


@router.delete("/course-units/{course_unit_id}/enrollments/{user_id}")
async def unenroll_student_endpoint(
    course_unit_id: str,
    user_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    _require_course_unit_access(current, course_unit_id)
    removed = unenroll_student(course_unit_id, user_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    return {"ok": True}


@router.get("/course-units/{course_unit_id}/roster")
async def course_unit_roster_endpoint(
    course_unit_id: str,
    current: TokenPayload = Depends(require_instructor_or_admin),
) -> dict[str, Any]:
    _require_course_unit_access(current, course_unit_id)
    roster: list[dict[str, Any]] = []
    for enrollment in list_enrollments_for_course(course_unit_id):
        user_record = get_user_by_id(enrollment["user_id"])
        if user_record is None:
            continue
        username, record = user_record
        roster.append(
            {
                "user_id": enrollment["user_id"],
                "username": username,
                "role": record.get("role", "user"),
                "full_name": str(record.get("full_name") or ""),
                "registration_number": str(record.get("registration_number") or ""),
                "enrolled_at": enrollment.get("created_at", ""),
            }
        )
    return {"roster": roster}


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
