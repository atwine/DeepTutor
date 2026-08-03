# Security

This document reflects the actual current state of DeepTutor's authentication,
authorization, and deployment security posture as of **2026-08-03** (`main`
at commit `2778a71`, post-Round-4). It replaces an implied-but-never-actually-
committed `SECURITY.md` — see "Note on this document's history" at the bottom.

This is a living document. If you change auth/permission code, update this
file in the same PR — don't let it drift the way its absence did.

## Deployment modes

DeepTutor runs in one of two auth postures, controlled by
`auth.enabled` (`data/user/settings/auth.json`, or `AUTH_ENABLED` env var):

- **`AUTH_ENABLED=false` (default)** — solo/local use. Every request is
  treated as the local admin identity (`local-admin`). No login, no
  multi-user isolation. CORS is permissive (`allow_origin_regex=r"https?://.*"`)
  to support LAN/remote-Docker access out of the box, matching upstream's
  pre-fork behavior.
- **`AUTH_ENABLED=true`** — the mode this fork's multi-user work (course
  units, assignments, grades, real student accounts) is built for. JWT
  cookie/bearer auth, three roles (`admin`/`instructor`/`user`), and CORS
  becomes an explicit allowlist (`system.cors_origin(s)`) — no wildcard.

**Before any real deployment with real student data: confirm `auth.enabled`
is actually `true`.** Multi-user features (course units, assignments,
grading) are reachable regardless of this setting, but with auth disabled
every request is the local admin — there is no real per-student isolation.

## Authentication

- **Password hashing**: bcrypt (`deeptutor/services/auth.py:hash_password`/
  `verify_password`), via the `bcrypt` package directly (not `passlib`,
  which is unmaintained for bcrypt 4+ — see that module's own comment).
- **Sessions**: JWT (HS256), delivered as an `httponly` cookie
  (`dt_token`) or `Authorization: Bearer` header. Expiry is configurable
  (`auth.token_expire_hours`, default 24h). `AUTH_SECRET` is generated once
  via `secrets.token_hex(32)` and persisted to `data/system/auth/auth_secret`
  with `chmod 0o600` (`identity.py:load_or_create_auth_secret`) — not a
  hardcoded or checked-in value. `data/` is gitignored.
- **Cookie attributes**: `httponly=True` always; `secure`/`samesite`
  derived from `auth.cookie_secure` (`SameSite=None` when `cookie_secure`
  is true, `SameSite=Lax` otherwise — see `api/routers/auth.py`'s
  `_cookie_attrs()` for the cross-origin-cookie rationale). **`cookie_secure`
  must be `true` for any deployment served over HTTPS with a separate
  frontend/backend origin** (Railway will be exactly this shape) — verify
  this explicitly as part of the Railway deployment work (`TODO.md` §B), it
  is not automatically inferred from the request scheme.
- **Registration**: `/register` is open only until the first account exists
  (that account becomes admin); closed afterward. Further accounts are
  admin-created only (`POST /api/v1/auth/users`), always as role=`user` —
  no client-supplied role at creation, so there's no self-elevation path
  through registration.
- **Alternate backend**: PocketBase mode (`integrations.pocketbase_url`
  set) delegates login/registration/token-validation to PocketBase itself;
  documented (in `services/auth.py`'s own docstring) as single-user-oriented
  and not the path multi-user course features were built/tested against.

## Authorization

Three roles: `admin`, `instructor`, `user` (student). Enforced via FastAPI
dependencies in `deeptutor/api/routers/auth.py`:

- `require_auth` — any authenticated identity (or `None` if auth disabled).
- `require_admin` — admin only.
- `require_instructor_or_admin` — admin or instructor; per-endpoint code
  then checks *which* course unit(s) that instructor actually owns
  (`is_instructor_of` / `_manages_course_unit` / `_require_course_unit_access`
  — the same ownership-check pattern is reused consistently across
  `deeptutor/multi_user/router.py`, `assignments_router.py`, and
  `book_access_router.py`; verified by reading every `@router.*` endpoint
  in all three files as part of this review, not just spot-checked).

**Course-unit permission matrix** (current, as of Round 4 Task 2 — see
`DEVIN_LOG.md` for the full reasoning behind the split):

| Action | Admin | Instructor (own unit) | Instructor (other's unit) | Student |
|---|---|---|---|---|
| Create course unit | yes | yes (self-added as instructor) | — | no |
| Edit metadata (name/term/dates/description) | yes | yes | no (403) | no |
| Reassign `instructor_ids` | yes | **no** (silently dropped, not erased/errored) | no | no |
| Delete course unit | yes | **no** (403 — deliberate, irreversible cascade) | no | no |
| Archive/unarchive | yes | yes | no | no |
| Enroll/unenroll a student | yes | yes | no | no |
| View gradebook / submissions | yes | yes | no | no |

Every user-scoped resource lookup (submissions, notifications, profile)
derives the acting user id from the verified token
(`current.user_id`/`payload.user_id`), never from a client-supplied
parameter — confirmed by reading `assignments_router.py`'s submission and
gradebook endpoints and `notifications_router.py` specifically for this
during this review, since that's the classic IDOR shape (a client passing
someone else's id in the URL/body and the server trusting it).

Admins cannot delete their own account or change their own role
(`api/routers/auth.py`'s `remove_user`/`update_user_role`) — prevents an
admin from accidentally locking themselves out or a compromised admin
session from being used to strip other admins while keeping itself
un-auditable.

## Findings from this review (2026-08-03)

**Fixed as part of this pass:**

- **`notifications_router.py` crashed with `AttributeError` on every request
  when `AUTH_ENABLED=false`.** Both endpoints (`GET /notifications`,
  `POST /notifications/{id}/read`) called `current.user_id` unconditionally,
  but `require_auth` returns `None` in that mode. Since the sidebar's
  `NotificationBell` component is mounted unconditionally and polls every
  30s, **this fired on every page load in the default (auth-disabled)
  deployment** — silently swallowed by the frontend's `.catch()`, but
  spamming 500s server-side. Fixed by falling back to `LOCAL_ADMIN_ID`,
  matching the pattern every other multi-user endpoint reachable in that
  mode already uses (e.g. `router.py`'s `request_enrollment_endpoint`).
  Verified live by calling both endpoint functions directly with
  `current=None`.

**Flagged, not fixed here — need a decision, not a quick patch:**

- **No brute-force/rate-limiting protection on `/login` — now fixed.** The
  app runs a single uvicorn worker (`start-backend.sh` has no `--workers`
  flag), so an in-memory lockout is safe without an infra dependency.
  `/login` now locks out after 3 failed attempts within 15 minutes, keyed
  by (username, client IP) — returns 429 with a `Retry-After` header,
  including for a correct password submitted during the lockout window.
  Also fixed the timing side-channel in the same pass: `authenticate()`
  now runs a dummy bcrypt check for unknown usernames so response timing
  no longer reveals whether an account exists. See
  `deeptutor/services/auth.py`'s "Login rate limiting" section.
- **The `disabled` field on user records is now functional.** Previously
  half-built (the field existed but no endpoint set it and `authenticate()`
  never checked it). Fixed in the same pass as this review: `authenticate()`
  now rejects disabled users, and `PUT /users/{username}/disabled` (admin-
  only, with self-disable guard) toggles the flag. Admins can disable/enable
  accounts from the user management table.
- **`sandbox-runner`'s cross-user filesystem visibility.** Already
  explicitly documented in `docker-compose.yml`'s own comments as an
  accepted risk: every `code_execution` invocation in that container shares
  one filesystem view, and for non-admin accounts the mount is a whole user
  root (`data/users/<uid>/`), not a narrower workspace subtree — so one
  account's sandboxed code can read another account's `chat_history.db`,
  knowledge bases, and settings. The existing comment scopes this as
  acceptable "for the invite-only trust posture." **This needs
  re-evaluation before a real multi-student deployment** — an invite-only
  trust posture is a materially different threat model than a classroom of
  students who don't necessarily trust each other. Not changed in this
  pass (this is an architecture decision, not a bug fix — flagging per the
  standing rule to raise product/infra calls rather than guess).

**Confirmed fine, no action needed:**

- JWT decode always pins `algorithms=[_ALGORITHM]` (`HS256`) explicitly —
  no algorithm-confusion / `alg=none` acceptance.
- CORS is properly gated: wildcard-ish origin regex only applies when auth
  is disabled (local/solo mode); an enabled-auth deployment requires an
  explicit origin allowlist.
- No `pickle.loads`, no `eval`, no string-formatted SQL anywhere in the
  reviewed code paths (multi-user storage is 100% SQLAlchemy ORM with
  parameterized queries). The one `shell=True` subprocess call
  (`services/sandbox/runner/server.py`) is the sandbox-runner's entire
  purpose (executing user-authored shell commands), isolated in its own
  unprivileged container with no app secrets mounted — not a bug, that's
  the intended contract, addressed separately above under the sandbox
  cross-user-visibility finding.
- User-supplied ids (avatar file paths, etc.) are validated against a strict
  allowlist regex (`_USER_ID_RE`) before touching the filesystem — no path
  traversal via a crafted user id.
- Uploaded avatar images are sniffed by magic bytes, not trusted
  extension/Content-Type; SVG is explicitly rejected (stored-XSS vector).
- No hardcoded secrets/API keys found in the reviewed source tree (grepped
  for common key patterns); `data/` and all `.env` variants are gitignored.
  `docker-compose.yml`'s `POSTGRES_PASSWORD=deeptutor` is local-dev-only —
  Railway's managed Postgres injects its own `DATABASE_URL` with a real
  generated credential (see that file's own comments).

## Note on this document's history

No `SECURITY.md` existed anywhere in this repository's git history before
this review, despite `devin-handoff/TODO.md` and `DEVIN_LOG.md` both
referring to one as something to "review against actual current state."
This file is that review's actual output — created, not edited, since there
was nothing to edit. Flagging this explicitly rather than silently
authoring the file as if it had always existed, per this project's
documented practice of not quietly working around inconsistencies (see
`DEVIN_LOG.md`'s Round 4 Task 2 entry for the standard this is trying to
meet).
