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

from .notifications import list_notifications_for_user, mark_notification_read

router = APIRouter()


@router.get("/notifications")
async def list_notifications_endpoint(
    current: TokenPayload = Depends(require_auth),
) -> dict[str, Any]:
    """Current user's activity feed: one entry per notification created for
    any course unit they're approved-enrolled in, newest first."""
    notifications = await list_notifications_for_user(current.user_id)
    return {"notifications": notifications}


@router.post("/notifications/{notification_id}/read")
async def mark_notification_read_endpoint(
    notification_id: str,
    current: TokenPayload = Depends(require_auth),
) -> dict[str, Any]:
    ok = await mark_notification_read(notification_id, current.user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}
