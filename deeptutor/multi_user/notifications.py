"""Lightweight, polling-based per-course activity feed.

Backed by Postgres via SQLAlchemy async, matching this subsystem's
established pattern (see `course_units.py` / `course_books.py`). A student
sees a notification for every course unit they are *approved*-enrolled in —
the same enrollment check (`is_approved_student_of`) used everywhere else in
this subsystem, imported directly rather than re-derived.

This is deliberately NOT real-time (no websocket push) — the frontend polls
`GET /notifications` on an interval. That's a scoping decision already made,
not something to second-guess here.

All public functions are ``async def`` — callers must ``await`` them.
"""

from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Any

from sqlalchemy import select

from deeptutor.services.db import session_scope
from deeptutor.services.db.models import Enrollment, Notification, NotificationRead

from .course_units import is_approved_student_of

logger = logging.getLogger(__name__)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _notification_to_dict(notification: Notification, *, is_read: bool) -> dict[str, Any]:
    return {
        "id": notification.id,
        "course_unit_id": notification.course_unit_id,
        "kind": notification.kind,
        "title": notification.title,
        "created_at": notification.created_at.isoformat() if notification.created_at else "",
        "is_read": is_read,
    }


async def create_notification(course_unit_id: str, kind: str, title: str) -> dict[str, Any]:
    """Create a new activity-feed entry for a course unit. Call this from a
    trigger point right after an instructor publishes something new
    (assignment, course notes, etc.) — every approved-enrolled student in
    `course_unit_id` will see it on their next poll of `GET /notifications`."""
    now = datetime.now(timezone.utc)
    async with session_scope() as session:
        notification = Notification(
            course_unit_id=course_unit_id,
            kind=kind,
            title=title,
            created_at=now,
        )
        session.add(notification)
        await session.flush()
        return _notification_to_dict(notification, is_read=False)


async def list_notifications_for_user(user_id: str) -> list[dict[str, Any]]:
    """Every notification for every course unit `user_id` is approved-enrolled
    in, newest first, with `is_read` computed per-row via a join against
    `NotificationRead` (no read-tracking column on `Notification` itself —
    see the model docstring for why)."""
    async with session_scope() as session:
        enrolled_result = await session.execute(
            select(Enrollment.course_unit_id).where(
                Enrollment.user_id == str(user_id),
                Enrollment.status == "approved",
            )
        )
        candidate_unit_ids = [row[0] for row in enrolled_result.all()]

    # Re-check each candidate through the shared `is_approved_student_of`
    # predicate (not re-derived) so course-unit end-date expiry (B1) is
    # respected the same way it is for assignments/notes — a student whose
    # access has lapsed shouldn't keep seeing new activity for that unit.
    course_unit_ids = [
        cu_id
        for cu_id in candidate_unit_ids
        if await is_approved_student_of(user_id, cu_id)
    ]
    if not course_unit_ids:
        return []

    async with session_scope() as session:
        notif_result = await session.execute(
            select(Notification)
            .where(Notification.course_unit_id.in_(course_unit_ids))
            .order_by(Notification.created_at.desc())
        )
        notifications = notif_result.scalars().all()
        if not notifications:
            return []

        notif_ids = [n.id for n in notifications]
        read_result = await session.execute(
            select(NotificationRead.notification_id).where(
                NotificationRead.user_id == str(user_id),
                NotificationRead.notification_id.in_(notif_ids),
            )
        )
        read_ids = {row[0] for row in read_result.all()}

        return [
            _notification_to_dict(n, is_read=n.id in read_ids) for n in notifications
        ]


async def mark_notification_read(notification_id: str, user_id: str) -> bool:
    """Record that `user_id` has read `notification_id` — a plain insert, not
    a mutation on the notification row (so many students marking the same
    notification read concurrently can't race each other). Idempotent: a
    duplicate mark-read for the same user+notification just no-ops, since
    `NotificationRead` has a unique constraint on (notification_id, user_id).
    Returns False if the notification doesn't exist."""
    async with session_scope() as session:
        notification = await session.get(Notification, notification_id)
        if notification is None:
            return False

        existing_result = await session.execute(
            select(NotificationRead).where(
                NotificationRead.notification_id == notification_id,
                NotificationRead.user_id == str(user_id),
            )
        )
        if existing_result.scalar_one_or_none() is not None:
            return True  # already marked read — idempotent no-op

        session.add(
            NotificationRead(
                notification_id=notification_id,
                user_id=str(user_id),
                read_at=datetime.now(timezone.utc),
            )
        )
        return True
