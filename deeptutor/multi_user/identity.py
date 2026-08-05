"""Canonical identity store for the optional multi-user layer."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import secrets
import threading
import time
from typing import Any
from uuid import uuid4

from .models import Role
from .paths import PROJECT_ROOT, SYSTEM_ROOT, migrate_legacy_multi_user_tree

logger = logging.getLogger(__name__)

# Serialises writes to USERS_FILE so a concurrent burst of /register requests
# cannot all see ``not users`` and each promote themselves to admin. Single-
# process FastAPI deployments (the ``deeptutor start`` launcher) are fully covered;
# multi-worker deployments still race and must rely on an external user store
# (e.g. PocketBase), which is documented in the multi-user README.
_USERS_WRITE_LOCK = threading.Lock()

# Issue #45: In-memory TTL cache for load_users(). Without this, every call
# to load_users() reads and parses the entire users.json from disk — and
# load_users() is called by 19 functions including authenticate() (every
# login), get_user_by_id() (every user lookup), and list_user_info() (every
# admin dashboard load). The cache is invalidated by _write_users() so
# writes are immediately visible. The TTL is a safety net for external
# modifications to the file (rare, but possible via manual edits).
_USERS_CACHE_TTL = 5.0  # seconds
_users_cache: dict[str, dict[str, Any]] | None = None
_users_cache_ts: float = 0.0
_users_cache_lock = threading.Lock()

# Issue #44/#53: get_user_by_id() and get_users_by_ids() used to linear-scan
# every user on every call to find one by id (username is the dict key;
# id is not). The TTL cache above stops the disk read, but not the O(N)
# scan through the in-memory dict. This id-indexed lookup table is built
# once per cache generation (identified by the users dict's object
# identity, which changes exactly when load_users() actually refreshes),
# turning repeated by-id lookups into O(1) dict access.
_users_by_id_cache: dict[str, tuple[str, dict[str, Any]]] | None = None
_users_by_id_cache_source: int | None = None


def _users_by_id_index() -> dict[str, tuple[str, dict[str, Any]]]:
    global _users_by_id_cache, _users_by_id_cache_source
    users = load_users()
    if _users_by_id_cache is not None and _users_by_id_cache_source == id(users):
        return _users_by_id_cache
    index = {
        str(record.get("id") or ""): (username, record)
        for username, record in users.items()
        if record.get("id")
    }
    _users_by_id_cache = index
    _users_by_id_cache_source = id(users)
    return index

AUTH_DIR = SYSTEM_ROOT / "auth"
USERS_FILE = AUTH_DIR / "users.json"
SECRET_FILE = AUTH_DIR / "auth_secret"
LEGACY_USERS_FILE = PROJECT_ROOT / "data" / "user" / "auth_users.json"
LEGACY_SECRET_FILE = PROJECT_ROOT / "data" / "user" / "auth_secret"


def new_user_id() -> str:
    return f"u_{uuid4().hex}"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _canonical_record(
    username: str,
    value: Any,
    *,
    default_role: Role = "user",
) -> dict[str, Any] | None:
    if isinstance(value, str):
        return {
            "id": new_user_id(),
            "hash": value,
            "role": default_role,
            "created_at": utc_now(),
            "disabled": False,
            "avatar": "",
            "full_name": "",
            "registration_number": "",
            "first_name": "",
            "surname": "",
            "gender": "",
            "course": "",
        }
    if not isinstance(value, dict):
        return None
    hashed = str(value.get("hash") or value.get("password_hash") or "")
    if not hashed:
        return None
    role = str(value.get("role") or default_role)
    if role not in {"admin", "instructor", "user"}:
        role = default_role
    return {
        "id": str(value.get("id") or new_user_id()),
        "hash": hashed,
        "role": role,
        "created_at": str(value.get("created_at") or utc_now()),
        "disabled": bool(value.get("disabled", False)),
        "avatar": str(value.get("avatar") or ""),
        "full_name": str(value.get("full_name") or ""),
        "registration_number": str(value.get("registration_number") or ""),
        "first_name": str(value.get("first_name") or ""),
        "surname": str(value.get("surname") or ""),
        "gender": str(value.get("gender") or ""),
        "course": str(value.get("course") or ""),
    }


def _read_json(path: Path) -> dict[str, Any]:
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
        return loaded if isinstance(loaded, dict) else {}
    except Exception as exc:
        logger.warning("Failed to read %s: %s", path, exc)
        return {}


def _write_users(users: dict[str, dict[str, Any]]) -> None:
    global _users_cache
    USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    USERS_FILE.write_text(json.dumps(users, indent=2, ensure_ascii=False), encoding="utf-8")
    # Issue #45: Invalidate the cache so the next load_users() call re-reads
    # from disk and picks up the changes. This covers all write paths
    # (save_user, delete_user, update_profile_details, set_disabled,
    # set_avatar, set_role, and the canonicalization write-back in
    # load_users() itself).
    _users_cache = None


def _migrate_legacy_users() -> dict[str, dict[str, Any]] | None:
    if USERS_FILE.exists() or not LEGACY_USERS_FILE.exists():
        return None
    legacy = _read_json(LEGACY_USERS_FILE)
    users: dict[str, dict[str, Any]] = {}
    for username, value in legacy.items():
        role: Role = "admin" if not users else "user"
        if isinstance(value, dict) and str(value.get("role") or "") in {"admin", "instructor", "user"}:
            role = str(value.get("role"))  # type: ignore[assignment]
        record = _canonical_record(username, value, default_role=role)
        if record is not None:
            users[str(username)] = record
    if users:
        _write_users(users)
        logger.info("Migrated auth users from %s to %s", LEGACY_USERS_FILE, USERS_FILE)
        return users
    return None


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


def _load_users_from_disk(
    env_username: str = "",
    env_password_hash: str = "",
) -> dict[str, dict[str, Any]]:
    """Read users.json from disk, canonicalize records, and write back if
    any records were upgraded. This is the cache-miss path of
    :func:`load_users`."""
    migrate_legacy_multi_user_tree()
    users: dict[str, dict[str, Any]] | None = None
    if USERS_FILE.exists():
        users = _read_json(USERS_FILE)
    else:
        users = _migrate_legacy_users()

    if users is None:
        users = {}

    canonical: dict[str, dict[str, Any]] = {}
    changed = False
    for index, (username, value) in enumerate(users.items()):
        role: Role = "admin" if index == 0 else "user"
        if isinstance(value, dict) and str(value.get("role") or "") in {"admin", "instructor", "user"}:
            role = str(value.get("role"))  # type: ignore[assignment]
        record = _canonical_record(str(username), value, default_role=role)
        if record is None:
            changed = True
            continue
        canonical[str(username)] = record
        changed = changed or record != value

    if USERS_FILE.exists() and changed:
        _write_users(canonical)

    if canonical:
        return canonical

    if env_username and env_password_hash:
        return {
            env_username: {
                "id": "env-admin",
                "hash": env_password_hash,
                "role": "admin",
                "created_at": "",
                "disabled": False,
            }
        }

    return {}


def load_users(  # nosec B107 - empty defaults mean "no env fallback supplied".
    env_username: str = "",
    env_password_hash: str = "",
) -> dict[str, dict[str, Any]]:
    """Load canonical users, migrating legacy records and env fallback in memory.

    Issue #45: Results are cached with a short TTL (5 seconds) to avoid
    re-reading users.json from disk on every call. The cache is
    invalidated immediately by :func:`_write_users` so writes are always
    visible. When ``env_username``/``env_password_hash`` are provided
    (bootstrap fallback), the cache is bypassed since the result depends
    on the caller's env params.
    """
    # Env-fallback path: don't cache — the result depends on caller params.
    if env_username or env_password_hash:
        return _load_users_from_disk(env_username, env_password_hash)

    # Issue #45: Check the TTL cache first. This is the hot path — every
    # authenticate(), get_user_by_id(), list_user_info(), etc. hits this.
    global _users_cache, _users_cache_ts
    now = time.monotonic()
    cached = _users_cache
    if cached is not None and (now - _users_cache_ts) < _USERS_CACHE_TTL:
        return cached

    # Cache miss — acquire lock to avoid thundering herd under concurrent
    # load (multiple requests all seeing an expired cache and each reading
    # the file simultaneously).
    with _users_cache_lock:
        # Double-check after acquiring the lock — another thread may have
        # already refreshed the cache while we were waiting.
        now = time.monotonic()
        cached = _users_cache
        if cached is not None and (now - _users_cache_ts) < _USERS_CACHE_TTL:
            return cached

        # Read from disk. Note: _load_users_from_disk may call
        # _write_users() (for canonicalization), which sets
        # _users_cache = None. We set the cache AFTER this call returns,
        # so the final cache value is correct regardless.
        result = _load_users_from_disk()
        _users_cache = result
        _users_cache_ts = time.monotonic()
        return result


def save_user(username: str, hashed_password: str, role: Role = "user") -> dict[str, Any]:
    USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    # Read-modify-write must be atomic so concurrent first-time registrations
    # cannot each see an empty store and each promote themselves to admin.
    with _USERS_WRITE_LOCK:
        users = load_users()
        effective_role: Role = "admin" if not users else role
        existing = users.get(username) or {}
        record = {
            "id": str(existing.get("id") or new_user_id()),
            "hash": hashed_password,
            "role": effective_role,
            "created_at": str(existing.get("created_at") or utc_now()),
            "disabled": bool(existing.get("disabled", False)),
            "avatar": str(existing.get("avatar") or ""),
            "full_name": str(existing.get("full_name") or ""),
            "registration_number": str(existing.get("registration_number") or ""),
            "first_name": str(existing.get("first_name") or ""),
            "surname": str(existing.get("surname") or ""),
            "gender": str(existing.get("gender") or ""),
            "course": str(existing.get("course") or ""),
        }
        users[username] = record
        _write_users(users)
    return record


def list_user_info(  # nosec B107 - empty defaults mean "no env fallback supplied".
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
        for username, record in load_users(env_username, env_password_hash).items()
    ]


def search_enrollable_users(query: str, *, limit: int = 20) -> list[dict[str, Any]]:
    """Find student accounts (role == "user") by username, full name, or
    registration number substring match, case-insensitive.

    Scoped to non-admin, non-instructor accounts and to a minimal field set:
    this backs the instructor-facing enrollment picker, and ``GET /users``
    (which returns the full roster with roles/timestamps) is admin-only, so
    an instructor has no other way to look up a student to enroll.
    """
    needle = query.strip().lower()
    if not needle:
        return []
    matches: list[dict[str, Any]] = []
    for username, record in load_users().items():
        if str(record.get("role") or "user") != "user":
            continue
        full_name = str(record.get("full_name") or "")
        reg_number = str(record.get("registration_number") or "")
        first_name = str(record.get("first_name") or "")
        surname = str(record.get("surname") or "")
        haystack = f"{username} {full_name} {first_name} {surname} {reg_number}".lower()
        if needle in haystack:
            matches.append(
                {
                    "id": str(record.get("id") or ""),
                    "username": username,
                    "full_name": full_name,
                    "registration_number": reg_number,
                }
            )
            if len(matches) >= limit:
                break
    return matches


def get_user(username: str) -> dict[str, Any] | None:
    return load_users().get(username)


def get_user_by_id(user_id: str) -> tuple[str, dict[str, Any]] | None:
    """Issue #44: O(1) via the id-indexed cache, instead of scanning every
    user (username is the dict key; id is not, so this used to be O(N))."""
    return _users_by_id_index().get(user_id)


def get_users_by_ids(user_ids: list[str]) -> dict[str, tuple[str, dict[str, Any]]]:
    """Issue #31/#44: Batched version of :func:`get_user_by_id` — O(len(user_ids))
    via the id-indexed cache, instead of scanning all users once per call.

    Returns ``{user_id: (username, record)}`` for each ID that was found.
    Missing IDs are simply absent from the result.
    """
    if not user_ids:
        return {}
    index = _users_by_id_index()
    return {uid: index[uid] for uid in user_ids if uid in index}


async def delete_user(username: str) -> bool:
    """Delete a user from the JSON store AND sweep their Postgres rows.

    Now async because it calls ``course_units.delete_user_data()`` to remove
    orphaned ``Enrollment``/``Submission`` rows — those tables have no FK to
    a users table on purpose (identity stays in JSON), so without this sweep
    a deleted user's roster entries and submissions linger forever, breaking
    gradebook/roster rendering. See B5 in FEATURE_ROUND2_PLAN.md.
    """
    if not USERS_FILE.exists():
        return False
    users = load_users()
    if username not in users:
        return False
    # Capture user_id before the record disappears so the DB sweep can run.
    user_id = str(users[username].get("id") or "")
    users.pop(username, None)
    _write_users(users)
    if user_id:
        from .course_units import delete_user_data

        await delete_user_data(user_id)
    return True


def update_profile_details(
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
    if not USERS_FILE.exists():
        return False
    with _USERS_WRITE_LOCK:
        users = load_users()
        if username not in users:
            return False
        if full_name is not None:
            users[username]["full_name"] = full_name
        if registration_number is not None:
            users[username]["registration_number"] = registration_number
        if first_name is not None:
            users[username]["first_name"] = first_name
        if surname is not None:
            users[username]["surname"] = surname
        if gender is not None:
            users[username]["gender"] = gender
        if course is not None:
            users[username]["course"] = course
        _write_users(users)
    return True


def set_disabled(username: str, disabled: bool) -> bool:
    """Enable or disable a user account. A disabled user cannot log in.

    Admin-only — called from the user-management endpoint, not self-service.
    Returns True on success, False if the user was not found.
    """
    if not USERS_FILE.exists():
        return False
    with _USERS_WRITE_LOCK:
        users = load_users()
        if username not in users:
            return False
        users[username]["disabled"] = bool(disabled)
        _write_users(users)
    return True


def set_avatar(username: str, avatar: str) -> bool:
    """Update the avatar marker for an existing user. Returns True on success."""
    if not USERS_FILE.exists():
        return False
    with _USERS_WRITE_LOCK:
        users = load_users()
        if username not in users:
            return False
        users[username]["avatar"] = avatar
        _write_users(users)
    return True


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


def set_role(username: str, role: Role) -> bool:
    if role not in {"admin", "instructor", "user"}:
        raise ValueError("role must be 'admin', 'instructor', or 'user'")
    if not USERS_FILE.exists():
        return False
    users = load_users()
    if username not in users:
        return False
    users[username]["role"] = role
    _write_users(users)
    return True


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
