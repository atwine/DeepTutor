"""
Authentication service for DeepTutor.

Disabled by default (auth.enabled=false) so localhost users are unaffected.
When enabled, guards all API routes with JWT bearer tokens.

Quick setup (single user via data/user/settings/auth.json):
    1. Set enabled=true
    2. Set username=<your username>
    3. Generate a password hash:
           python -c "from deeptutor.services.auth import hash_password; print(hash_password('yourpassword'))"
       Paste the output into password_hash=<hash>

Multi-user setup (recommended):
    Enable auth and leave username/password_hash empty.
    Navigate to /register in the browser. The first user to register is granted
    admin privileges and can manage other users from /admin/users.

    Users are stored in data/user/auth_users.json:
        {
            "alice": {"hash": "$2b$12$...", "role": "admin", "created_at": "2026-..."},
            "bob":   {"hash": "$2b$12$...", "role": "user",  "created_at": "2026-..."}
        }
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import logging
import threading
import time
from typing import Any

from deeptutor.services.config import load_auth_settings, load_integrations_settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration — read once at import time from runtime JSON settings
# ---------------------------------------------------------------------------

_AUTH_SETTINGS = load_auth_settings()
_INTEGRATIONS_SETTINGS = load_integrations_settings()

AUTH_ENABLED: bool = bool(_AUTH_SETTINGS["enabled"])
AUTH_USERNAME: str = str(_AUTH_SETTINGS["username"])
AUTH_PASSWORD_HASH: str = str(_AUTH_SETTINGS["password_hash"])
AUTH_SECRET: str = ""
TOKEN_EXPIRE_HOURS: int = int(_AUTH_SETTINGS["token_expire_hours"])

# PocketBase auth mode — active when integrations.pocketbase_url is set and auth is enabled.
# When enabled, login/register proxy to PocketBase and token validation uses
# PocketBase's auth-refresh endpoint (cached in memory — no static secret needed).
POCKETBASE_BASE_URL: str = str(_INTEGRATIONS_SETTINGS["pocketbase_url"]).rstrip("/")
POCKETBASE_ENABLED: bool = bool(POCKETBASE_BASE_URL) and AUTH_ENABLED

_ALGORITHM = "HS256"


if AUTH_ENABLED and not POCKETBASE_ENABLED and not AUTH_SECRET:
    from deeptutor.multi_user.identity import load_or_create_auth_secret

    AUTH_SECRET = load_or_create_auth_secret()


# ---------------------------------------------------------------------------
# Token payload
# ---------------------------------------------------------------------------


@dataclass
class TokenPayload:
    """Decoded JWT payload."""

    username: str
    role: str
    user_id: str = ""


# ---------------------------------------------------------------------------
# Password hashing — uses bcrypt directly (passlib is unmaintained for bcrypt 4+)
# ---------------------------------------------------------------------------


def hash_password(plain: str) -> str:
    """Hash a plaintext password. Use this to generate password hashes."""
    import bcrypt

    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plaintext password against a stored bcrypt hash."""
    import bcrypt

    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


# ---------------------------------------------------------------------------
# User store — multi-user JSON store plus optional auth.json bootstrap user
# ---------------------------------------------------------------------------


def _make_user_record(hashed: str, role: str = "user", created_at: str = "") -> dict[str, Any]:
    """Build a canonical user record dict for legacy callers/tests."""
    from deeptutor.multi_user.identity import new_user_id

    return {
        "id": new_user_id(),
        "hash": hashed,
        "role": role,
        "created_at": created_at or datetime.now(timezone.utc).isoformat(),
        "disabled": False,
        "avatar": "",
    }


def _load_users() -> dict[str, dict]:
    """
    Load the user store, migrating old flat format if needed.

    Priority:
      1. multi-user identity store
      2. auth.json username + password_hash — single-user bootstrap user

    Old format: {"alice": "$2b$12$..."}
    New format: {"alice": {"hash": "...", "role": "admin", "created_at": "..."}}
    """
    from deeptutor.multi_user.identity import load_users

    return load_users(AUTH_USERNAME, AUTH_PASSWORD_HASH)


def is_first_user() -> bool:
    """Return True when no users exist yet (first registration will become admin)."""
    return len(_load_users()) == 0


def add_user(username: str, plain_password: str, role: str = "user") -> None:
    """
    Add or update a user in data/user/auth_users.json.

    The role defaults to 'user'. Pass role='admin' to elevate. When the store
    is empty the first user is automatically promoted to 'admin' regardless of
    the role argument.

    Creates the file (and parent directories) if they don't exist.
    """
    from deeptutor.multi_user.identity import save_user

    record = save_user(username, hash_password(plain_password), role=role)  # type: ignore[arg-type]
    logger.info("User '%s' saved with role=%r", username, record.get("role", "user"))


def list_users() -> list[dict]:
    """Return a list of user info dicts (username, role, created_at) — no hashes."""
    from deeptutor.multi_user.identity import list_user_info

    return list_user_info(AUTH_USERNAME, AUTH_PASSWORD_HASH)


async def delete_user(username: str) -> bool:
    """
    Remove a user from the store. Returns True if the user existed.

    Now async because ``identity.delete_user`` sweeps Postgres rows
    (Enrollment/Submission) for the deleted user — see B5.
    """
    from deeptutor.multi_user.identity import delete_user as _delete_user

    if not await _delete_user(username):
        return False
    logger.info("User '%s' deleted", username)
    return True


def set_role(username: str, role: str) -> bool:
    """
    Change the role for an existing user. Returns True on success.

    Valid roles: 'admin', 'instructor', 'user'.
    """
    if role not in ("admin", "instructor", "user"):
        raise ValueError(f"Invalid role: {role!r}. Must be 'admin', 'instructor', or 'user'.")

    from deeptutor.multi_user.identity import set_role as _set_role

    if not _set_role(username, role):  # type: ignore[arg-type]
        return False
    logger.info(f"User '{username}' role updated to {role!r}")
    return True


def set_avatar(username: str, avatar: str) -> bool:
    """
    Update the avatar marker for an existing user. Returns True on success.

    The marker is either '' (deterministic fallback), 'icon:<name>:<color>',
    or 'img:<version>' (managed by the avatar upload endpoint).
    """
    from deeptutor.multi_user.identity import set_avatar as _set_avatar

    if not _set_avatar(username, avatar):
        return False
    logger.info("User '%s' avatar updated", username)
    return True


def get_user_info(username: str) -> dict[str, Any] | None:
    from deeptutor.multi_user.identity import get_user

    user = get_user(username)
    if user is None:
        return None

    return {
        "id": user.get("id", ""),
        "username": username,
        "role": user.get("role", "user"),
        "created_at": user.get("created_at", ""),
        "disabled": bool(user.get("disabled", False)),
        "avatar": str(user.get("avatar") or ""),
        "full_name": str(user.get("full_name") or ""),
        "registration_number": str(user.get("registration_number") or ""),
        "first_name": str(user.get("first_name") or ""),
        "surname": str(user.get("surname") or ""),
        "gender": str(user.get("gender") or ""),
        "course": str(user.get("course") or ""),
    }


def set_disabled(username: str, disabled: bool) -> bool:
    """Enable or disable a user account. Returns True on success.

    A disabled user cannot log in (checked in ``authenticate``). Admin-only
    by convention — the endpoint that calls this is admin-gated.
    """
    from deeptutor.multi_user.identity import set_disabled as _set_disabled

    if not _set_disabled(username, disabled):
        return False
    logger.info("User '%s' disabled=%s", username, disabled)
    return True


# ---------------------------------------------------------------------------
# JWT
# ---------------------------------------------------------------------------


def create_token(username: str, role: str = "user", user_id: str | None = None) -> str:
    """Create a signed JWT for the given username and role."""
    from jose import jwt

    if not user_id:
        record = _load_users().get(username) or {}
        user_id = str(record.get("id") or "")

    payload = {
        "sub": username,
        "role": role,
        "uid": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, AUTH_SECRET, algorithm=_ALGORITHM)


def decode_token(token: str) -> TokenPayload | None:
    """
    Validate a token and return a TokenPayload, or None if invalid.

    - PocketBase mode: calls PocketBase's auth-refresh endpoint (cached in
      memory for 60 s, so only the first request per token per minute makes
      a network call). No static JWT secret required.
    - Standard mode: local in-memory jwt.decode() using AUTH_SECRET — zero
      network calls, same as before.
    """
    if not token:
        return None

    if POCKETBASE_ENABLED:
        from deeptutor.services.pocketbase_client import validate_pb_token

        payload = validate_pb_token(token)
        if payload is None:
            return None
        return TokenPayload(
            username=payload["username"],
            role=payload.get("role", "user"),
            user_id=str(payload.get("id") or payload.get("uid") or payload.get("user_id") or ""),
        )

    # Standard JWT + bcrypt mode
    from jose import JWTError, jwt

    if not AUTH_SECRET:
        return None

    try:
        payload = jwt.decode(token, AUTH_SECRET, algorithms=[_ALGORITHM])
        username = payload.get("sub")
        if not username:
            return None
        user_id = str(payload.get("uid") or "")
        if not user_id:
            record = _load_users().get(str(username)) or {}
            user_id = str(record.get("id") or "")
        return TokenPayload(username=username, role=payload.get("role", "user"), user_id=user_id)
    except JWTError:
        return None


# ---------------------------------------------------------------------------
# PocketBase auth helpers
# ---------------------------------------------------------------------------


def authenticate_pb(username: str, password: str) -> tuple[TokenPayload, str] | None:
    """
    Authenticate against PocketBase and return (TokenPayload, raw_pb_token).

    Only called when POCKETBASE_ENABLED=True.
    Returns None on failure.
    The raw token is the PocketBase JWT string to be stored in the cookie.

    PocketBase requires an email address; plain usernames are mapped to
    <username>@deeptutor.local to match the email used at registration.
    """
    try:
        from deeptutor.services.pocketbase_client import get_pb_client

        pb = get_pb_client()
        result = pb.collection("users").auth_with_password(username, password)
        token: str = result.token
        record = result.record
        username = (
            getattr(record, "email", None)
            or getattr(record, "name", None)
            or getattr(record, "id", "unknown")
        )
        # PocketBase has no built-in "role" field by default; treat all as "user".
        # Admins authenticated via PocketBase admin panel use a separate endpoint.
        role = getattr(record, "role", "user") or "user"
        user_id = str(getattr(record, "id", "") or "")
        return TokenPayload(username=str(username), role=str(role), user_id=user_id), token
    except Exception as exc:
        logger.warning(f"PocketBase authentication failed: {exc}")
        return None


def register_pb(username: str, email: str, password: str) -> dict | None:
    """
    Create a new user in PocketBase.

    Returns the created user record dict or None on failure.
    """
    try:
        from deeptutor.services.pocketbase_client import get_pb_client

        pb = get_pb_client()
        record = pb.collection("users").create(
            {
                "username": username,
                "email": email,
                "password": password,
                "passwordConfirm": password,
            }
        )
        return {"id": record.id, "username": username, "email": email}
    except Exception as exc:
        logger.warning(f"PocketBase registration failed: {exc}")
        return None


# ---------------------------------------------------------------------------
# Login rate limiting — in-memory sliding-window lockout
# ---------------------------------------------------------------------------
# Safe as in-memory state because the app runs as a single uvicorn worker (see
# start-backend.sh: `uvicorn ... ` with no `--workers` flag) — no cross-process
# sync needed. If a future deployment adds multiple workers/instances, this
# needs to move to a shared store (e.g. Redis) instead.
#
# Keyed by (username, client_ip) per the repo owner's decision: protects a
# specific account from a specific source without locking out an entire
# shared/NAT'd network (e.g. a school lab) that happens to share one student's
# bad password attempts.

_LOGIN_LOCKOUT_MAX_ATTEMPTS = 3
_LOGIN_LOCKOUT_WINDOW_SECONDS = 15 * 60  # 15 minutes

_login_failures_lock = threading.Lock()
_login_failures: dict[tuple[str, str], list[float]] = {}

# A real (but never-used-for-an-actual-account) bcrypt hash, checked when the
# username lookup misses. Keeps authenticate()'s response time similar for
# unknown vs. known usernames — without this, an unknown username returns
# immediately (skips bcrypt entirely) while a known one always pays bcrypt's
# ~100ms cost, letting an attacker distinguish valid usernames by timing.
_DUMMY_HASH_FOR_TIMING_PARITY = (
    "$2b$12$RLr85RrjMzLqhIACrSHeC.ncaHIN4id/nvS1SkSwZfwM9.GXnLBoS"
)


def _prune_failures(timestamps: list[float], now: float) -> list[float]:
    cutoff = now - _LOGIN_LOCKOUT_WINDOW_SECONDS
    return [t for t in timestamps if t > cutoff]


def login_lockout_remaining(username: str, client_ip: str) -> float:
    """Seconds until (username, client_ip) may attempt to log in again, or 0 if not locked out."""
    if not username:
        return 0.0
    key = (username, client_ip or "")
    now = time.monotonic()
    with _login_failures_lock:
        timestamps = _prune_failures(_login_failures.get(key, []), now)
        _login_failures[key] = timestamps
        if len(timestamps) < _LOGIN_LOCKOUT_MAX_ATTEMPTS:
            return 0.0
        oldest = min(timestamps)
        return max(_LOGIN_LOCKOUT_WINDOW_SECONDS - (now - oldest), 0.0)


def record_login_failure(username: str, client_ip: str) -> None:
    if not username:
        return
    key = (username, client_ip or "")
    now = time.monotonic()
    with _login_failures_lock:
        timestamps = _prune_failures(_login_failures.get(key, []), now)
        timestamps.append(now)
        _login_failures[key] = timestamps


def record_login_success(username: str, client_ip: str) -> None:
    key = (username, client_ip or "")
    with _login_failures_lock:
        _login_failures.pop(key, None)


# ---------------------------------------------------------------------------
# Main auth entry point
# ---------------------------------------------------------------------------


def authenticate(username: str, password: str) -> TokenPayload | None:
    """
    Validate credentials. Returns a TokenPayload on success, None on failure.

    When auth is disabled, always returns a dummy admin payload so that
    callers don't need to special-case the disabled state.
    """
    if not AUTH_ENABLED:
        return TokenPayload(username=username or "local", role="admin", user_id="local-admin")

    users = _load_users()
    if not users:
        logger.warning(
            "No users configured — login will always fail. "
            "Navigate to /register to create your first account."
        )
        return None

    record = users.get(username)
    if not record:
        # Unknown username: still pay bcrypt's cost so response timing matches
        # the known-username path below (see _DUMMY_HASH_FOR_TIMING_PARITY).
        verify_password(password, _DUMMY_HASH_FOR_TIMING_PARITY)
        return None

    # A disabled account cannot log in, even with correct credentials.
    if isinstance(record, dict) and record.get("disabled"):
        logger.info("Login blocked for disabled user '%s'", username)
        return None

    hashed = record.get("hash", "") if isinstance(record, dict) else record
    if not verify_password(password, hashed):
        return None

    role = record.get("role", "user") if isinstance(record, dict) else "user"
    user_id = str(record.get("id") or "") if isinstance(record, dict) else ""
    return TokenPayload(username=username, role=role, user_id=user_id)
