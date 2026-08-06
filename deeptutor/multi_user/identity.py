"""Canonical identity store for the optional multi-user layer.

Issue #53: this used to be a single JSON file (``users.json``) read/rewritten
in full on every call — see git history for that implementation. It's now
backed by the ``users`` table in the same Postgres database the rest of the
app already uses (``deeptutor/services/db``), via indexed queries instead of
linear scans through an in-memory dict. Every public function below keeps its
old name and return shape (``get_user_by_id`` still returns
``(username, record_dict) | None``, etc.) so callers only needed ``await``
added, not restructuring — see devin-handoff/DEVIN_LOG.md for the full
call-site inventory this was checked against.

Avatars (image files) and the JWT signing secret stay on disk — they were
never part of the scalability problem this migration addresses.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import logging
from pathlib import Path
import secrets
from typing import Any
from uuid import uuid4

from sqlalchemy import delete, func, or_, select, update

from .models import Role
from .paths import PROJECT_ROOT, SYSTEM_ROOT, migrate_legacy_multi_user_tree

logger = logging.getLogger(__name__)

# First-user-becomes-admin must be race-free: two concurrent /register calls
# hitting an empty table must not both see "0 users" and both self-promote.
# An in-process asyncio.Lock is sufficient because (like the login-lockout
# state in services/auth.py) this app runs as a single uvicorn worker with
# no --workers flag — see that module's own note on the same assumption.
_FIRST_USER_LOCK = asyncio.Lock()

AUTH_DIR = SYSTEM_ROOT / "auth"
SECRET_FILE = AUTH_DIR / "auth_secret"
LEGACY_SECRET_FILE = PROJECT_ROOT / "data" / "user" / "auth_secret"

# Retained so the one-time migration script (scripts/migrate_users_to_postgres.py)
# and any still-present legacy JSON file can be located; identity.py itself no
# longer reads or writes this file.
USERS_FILE = AUTH_DIR / "users.json"
LEGACY_USERS_FILE = PROJECT_ROOT / "data" / "user" / "auth_users.json"


def new_user_id() -> str:
    return f"u_{uuid4().hex}"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _record_from_row(row: Any) -> dict[str, Any]:
    """Map a ``User`` ORM row to the JSON-era record shape callers expect
    (``hash`` for the password hash, ISO string timestamp, etc.)."""
    return {
        "id": row.id,
        "hash": row.password_hash,
        "role": row.role,
        "created_at": row.created_at.isoformat() if row.created_at else "",
        "disabled": bool(row.disabled),
        "avatar": row.avatar or "",
        "full_name": row.full_name or "",
        "registration_number": row.registration_number or "",
        "first_name": row.first_name or "",
        "surname": row.surname or "",
        "gender": row.gender or "",
        "course": row.course or "",
    }


async def load_users(  # nosec B107 - empty defaults mean "no env fallback supplied".
    env_username: str = "",
    env_password_hash: str = "",
) -> dict[str, dict[str, Any]]:
    """Load every user, keyed by username.

    Kept for callers that genuinely need the whole roster (``list_user_info``,
    ``is_first_user``); anything that wants a single user should call
    :func:`get_user` or :func:`get_user_by_id` instead, which hit an indexed
    query rather than loading everyone.
    """
    from deeptutor.services.db.engine import session_scope
    from deeptutor.services.db.models import User

    async with session_scope() as session:
        rows = (await session.execute(select(User))).scalars().all()

    if rows:
        return {row.username: _record_from_row(row) for row in rows}

    if env_username and env_password_hash:
        return {
            env_username: {
                "id": "env-admin",
                "hash": env_password_hash,
                "role": "admin",
                "created_at": "",
                "disabled": False,
                "avatar": "",
                "full_name": "",
                "registration_number": "",
                "first_name": "",
                "surname": "",
                "gender": "",
                "course": "",
            }
        }

    return {}


async def save_user(username: str, hashed_password: str, role: Role = "user") -> dict[str, Any]:
    from deeptutor.services.db.engine import session_scope
    from deeptutor.services.db.models import User

    async with _FIRST_USER_LOCK:
        async with session_scope() as session:
            existing = (
                await session.execute(select(User).where(User.username == username))
            ).scalar_one_or_none()
            count = (await session.execute(select(func.count()).select_from(User))).scalar_one()
            effective_role: Role = "admin" if count == 0 else role

            if existing is not None:
                existing.password_hash = hashed_password
                existing.role = effective_role
                row = existing
            else:
                row = User(
                    id=new_user_id(),
                    username=username,
                    password_hash=hashed_password,
                    role=effective_role,
                )
                session.add(row)
            await session.flush()
            record = _record_from_row(row)
    return record


async def list_user_info(  # nosec B107 - empty defaults mean "no env fallback supplied".
    env_username: str = "",
    env_password_hash: str = "",
) -> list[dict[str, Any]]:
    return [
        {
            "id": record.get("id", ""),
            "username": username,
            "role": record.get("role", "user"),
            "created_at": record.get("created_at", ""),
            "disabled": bool(record.get("disabled", False)),
            "avatar": str(record.get("avatar") or ""),
            "full_name": str(record.get("full_name") or ""),
            "registration_number": str(record.get("registration_number") or ""),
            "first_name": str(record.get("first_name") or ""),
            "surname": str(record.get("surname") or ""),
            "gender": str(record.get("gender") or ""),
            "course": str(record.get("course") or ""),
        }
        for username, record in (await load_users(env_username, env_password_hash)).items()
    ]


async def search_enrollable_users(query: str, *, limit: int = 20) -> list[dict[str, Any]]:
    """Find student accounts (role == "user") by username, full name, or
    registration number substring match, case-insensitive.

    Scoped to non-admin, non-instructor accounts and to a minimal field set:
    this backs the instructor-facing enrollment picker, and ``GET /users``
    (which returns the full roster with roles/timestamps) is admin-only, so
    an instructor has no other way to look up a student to enroll.

    Issue #53: this is now an indexed ``ILIKE`` query instead of loading
    every user into Python and scanning them.
    """
    needle = query.strip()
    if not needle:
        return []

    from deeptutor.services.db.engine import session_scope
    from deeptutor.services.db.models import User

    pattern = f"%{needle}%"
    async with session_scope() as session:
        rows = (
            await session.execute(
                select(User)
                .where(User.role == "user")
                .where(
                    or_(
                        User.username.ilike(pattern),
                        User.full_name.ilike(pattern),
                        User.first_name.ilike(pattern),
                        User.surname.ilike(pattern),
                        User.registration_number.ilike(pattern),
                    )
                )
                .limit(limit)
            )
        ).scalars().all()

    return [
        {
            "id": row.id,
            "username": row.username,
            "full_name": row.full_name or "",
            "registration_number": row.registration_number or "",
        }
        for row in rows
    ]


async def get_user(username: str) -> dict[str, Any] | None:
    from deeptutor.services.db.engine import session_scope
    from deeptutor.services.db.models import User

    async with session_scope() as session:
        row = (
            await session.execute(select(User).where(User.username == username))
        ).scalar_one_or_none()
    return _record_from_row(row) if row is not None else None


async def get_user_by_id(user_id: str) -> tuple[str, dict[str, Any]] | None:
    """Issue #44/#53: indexed primary-key lookup instead of scanning every
    user (this used to be O(N) even after the in-memory cache)."""
    from deeptutor.services.db.engine import session_scope
    from deeptutor.services.db.models import User

    async with session_scope() as session:
        row = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    return (row.username, _record_from_row(row)) if row is not None else None


async def get_users_by_ids(user_ids: list[str]) -> dict[str, tuple[str, dict[str, Any]]]:
    """Issue #31/#44/#53: Batched version of :func:`get_user_by_id` — one
    indexed ``WHERE id = ANY(...)`` query instead of one scan per id.

    Returns ``{user_id: (username, record)}`` for each ID that was found.
    Missing IDs are simply absent from the result.
    """
    if not user_ids:
        return {}

    from deeptutor.services.db.engine import session_scope
    from deeptutor.services.db.models import User

    async with session_scope() as session:
        rows = (
            await session.execute(select(User).where(User.id.in_(user_ids)))
        ).scalars().all()

    return {row.id: (row.username, _record_from_row(row)) for row in rows}


async def delete_user(username: str) -> bool:
    """Delete a user AND sweep their other Postgres rows.

    ``course_units.delete_user_data()`` removes orphaned ``Enrollment``/
    ``Submission`` rows — those tables have no FK to ``users`` on purpose
    (added well before accounts moved into Postgres), so without this sweep
    a deleted user's roster entries and submissions would linger forever,
    breaking gradebook/roster rendering. See B5 in FEATURE_ROUND2_PLAN.md.
    """
    from deeptutor.services.db.engine import session_scope
    from deeptutor.services.db.models import User

    async with session_scope() as session:
        row = (
            await session.execute(select(User).where(User.username == username))
        ).scalar_one_or_none()
        if row is None:
            return False
        user_id = row.id
        await session.execute(delete(User).where(User.username == username))

    from .course_units import delete_user_data

    await delete_user_data(user_id)
    return True


async def update_profile_details(
    username: str,
    *,
    full_name: str | None = None,
    registration_number: str | None = None,
    first_name: str | None = None,
    surname: str | None = None,
    gender: str | None = None,
    course: str | None = None,
) -> bool:
    """Update the current user's own demographics.

    These identify a real person for departmental reporting (rosters, grade
    exports) — distinct from ``username``, which is just the login handle.
    ``None`` leaves a field unchanged; pass ``""`` to clear it.
    """
    values: dict[str, Any] = {}
    if full_name is not None:
        values["full_name"] = full_name
    if registration_number is not None:
        values["registration_number"] = registration_number
    if first_name is not None:
        values["first_name"] = first_name
    if surname is not None:
        values["surname"] = surname
    if gender is not None:
        values["gender"] = gender
    if course is not None:
        values["course"] = course
    if not values:
        return await get_user(username) is not None

    from deeptutor.services.db.engine import session_scope
    from deeptutor.services.db.models import User

    async with session_scope() as session:
        result = await session.execute(
            update(User).where(User.username == username).values(**values)
        )
    return result.rowcount > 0


async def set_disabled(username: str, disabled: bool) -> bool:
    """Enable or disable a user account. A disabled user cannot log in.

    Admin-only — called from the user-management endpoint, not self-service.
    Returns True on success, False if the user was not found.
    """
    from deeptutor.services.db.engine import session_scope
    from deeptutor.services.db.models import User

    async with session_scope() as session:
        result = await session.execute(
            update(User).where(User.username == username).values(disabled=bool(disabled))
        )
    return result.rowcount > 0


async def set_avatar(username: str, avatar: str) -> bool:
    """Update the avatar marker for an existing user. Returns True on success."""
    from deeptutor.services.db.engine import session_scope
    from deeptutor.services.db.models import User

    async with session_scope() as session:
        result = await session.execute(
            update(User).where(User.username == username).values(avatar=avatar)
        )
    return result.rowcount > 0


async def set_role(username: str, role: Role) -> bool:
    if role not in {"admin", "instructor", "user"}:
        raise ValueError("role must be 'admin', 'instructor', or 'user'")

    from deeptutor.services.db.engine import session_scope
    from deeptutor.services.db.models import User

    async with session_scope() as session:
        result = await session.execute(
            update(User).where(User.username == username).values(role=role)
        )
    return result.rowcount > 0


# ---------------------------------------------------------------------------
# Avatar image files — stored next to the user store, keyed by user id
# ---------------------------------------------------------------------------

# Extensions are derived from server-side content sniffing, never from the
# uploaded filename, so this list is also the full set of files we may serve.
AVATAR_EXTENSIONS = ("png", "jpg", "webp")


def _avatar_dir() -> Path:
    # Resolved lazily so tests that monkeypatch AUTH_DIR keep avatars isolated.
    return AUTH_DIR / "avatars"


def get_avatar_file(user_id: str) -> Path | None:
    """Return the stored avatar image for ``user_id``, or None."""
    for ext in AVATAR_EXTENSIONS:
        candidate = _avatar_dir() / f"{user_id}.{ext}"
        if candidate.is_file():
            return candidate
    return None


def save_avatar_file(user_id: str, data: bytes, ext: str) -> Path:
    """Atomically persist an avatar image, replacing any previous one."""
    if ext not in AVATAR_EXTENSIONS:
        raise ValueError(f"Unsupported avatar extension: {ext!r}")
    directory = _avatar_dir()
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"{user_id}.{ext}"
    tmp = directory / f"{user_id}.{ext}.tmp"
    tmp.write_bytes(data)
    tmp.replace(target)
    # A re-upload may change the extension; drop stale siblings.
    for other in AVATAR_EXTENSIONS:
        if other != ext:
            (directory / f"{user_id}.{other}").unlink(missing_ok=True)
    return target


def delete_avatar_file(user_id: str) -> None:
    for ext in AVATAR_EXTENSIONS:
        (_avatar_dir() / f"{user_id}.{ext}").unlink(missing_ok=True)


def load_or_create_auth_secret() -> str:
    migrate_legacy_multi_user_tree()
    _migrate_secret()
    try:
        if SECRET_FILE.exists():
            existing = SECRET_FILE.read_text(encoding="utf-8").strip()
            if existing:
                return existing
        SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
        generated = secrets.token_hex(32)
        SECRET_FILE.write_text(generated, encoding="utf-8")
        try:
            SECRET_FILE.chmod(0o600)
        except OSError:
            pass
        logger.warning(
            "Auth is enabled and no auth_secret file exists. Generated a stable local secret at %s.",
            SECRET_FILE,
        )
        return generated
    except Exception as exc:
        logger.warning("Failed to load/create auth secret at %s: %s", SECRET_FILE, exc)
        return secrets.token_hex(32)


def _migrate_secret() -> None:
    if SECRET_FILE.exists() or not LEGACY_SECRET_FILE.exists():
        return
    try:
        secret = LEGACY_SECRET_FILE.read_text(encoding="utf-8").strip()
        if secret:
            SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
            SECRET_FILE.write_text(secret, encoding="utf-8")
            try:
                SECRET_FILE.chmod(0o600)
            except OSError:
                pass
            logger.info("Migrated auth secret from %s to %s", LEGACY_SECRET_FILE, SECRET_FILE)
    except Exception as exc:
        logger.warning("Failed to migrate legacy auth secret: %s", exc)
