"""Per-course notification/activity feed endpoints.

Kept as its own router (not added to `router.py`, which another agent owns
this round) so it can be mounted independently. Registered in
`deeptutor/api/main.py` alongside `multi_user_router` / `assignments_router`
/ `book_access_router`.

Both endpoints are available to any authenticated user — an instructor or
admin with no enrollments of their own simply gets an empty feed, which is
fine (they see their own course units' activity via the instructor-facing
pages, not this feed).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from deeptutor.api.routers.auth import TokenPayload, require_auth
from deeptutor.multi_user.models import LOCAL_ADMIN_ID

from .notifications import list_notifications_for_user, mark_notification_read

router = APIRouter()


@router.get("/notifications")
async def list_notifications_endpoint(
    current: TokenPayload | None = Depends(require_auth),
) -> dict[str, Any]:
    """Current user's activity feed: one entry per notification created for
    any course unit they're approved-enrolled in, newest first.

    ``require_auth`` returns ``None`` when ``AUTH_ENABLED=false`` (the
    default, solo/local deployment mode) — falling back to
    ``LOCAL_ADMIN_ID`` here matches the pattern every other multi-user
    endpoint that can be reached in that mode already uses (e.g.
    ``request_enrollment_endpoint`` in ``router.py``). Without this, the
    sidebar's always-mounted ``NotificationBell`` component 500'd on every
    page load in the default deployment mode (security review finding,
    2026-08-03 — see DEVIN_LOG.md).
    """
    user_id = current.user_id if current else LOCAL_ADMIN_ID
    notifications = await list_notifications_for_user(user_id)
    return {"notifications": notifications}


@router.post("/notifications/{notification_id}/read")
async def mark_notification_read_endpoint(
    notification_id: str,
    current: TokenPayload | None = Depends(require_auth),
) -> dict[str, Any]:
    """See ``list_notifications_endpoint`` above for the ``current is None``
    (AUTH_ENABLED=false) fallback rationale."""
    user_id = current.user_id if current else LOCAL_ADMIN_ID
    ok = await mark_notification_read(notification_id, user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}
