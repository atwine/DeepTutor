"""One-time migration: copy accounts from the legacy users.json file into
the Postgres `users` table (Issue #53).

Usage:
    python scripts/init_db.py                       # 1. create the users table
    python scripts/migrate_users_to_postgres.py      # 2. copy the data over

Safe to re-run: existing rows (matched by username) are left untouched, not
overwritten, so running this twice — or running it after some users have
already registered directly against Postgres — cannot lose data or clobber a
newer password hash with a stale JSON one.

After this has been run once against a given environment's database, the
users.json file is no longer read by the app (deeptutor/multi_user/identity.py
talks to Postgres exclusively) and can be archived/deleted once you've
confirmed logins work.
"""

from __future__ import annotations

import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from deeptutor.multi_user.identity import LEGACY_USERS_FILE, USERS_FILE  # noqa: E402
from deeptutor.services.db.engine import session_scope  # noqa: E402
from deeptutor.services.db.models import User  # noqa: E402
from sqlalchemy import select  # noqa: E402


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
        return loaded if isinstance(loaded, dict) else {}
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️  Failed to read {path}: {exc}")
        return {}


def _canonicalize(username: str, value: Any, *, default_role: str) -> dict[str, Any] | None:
    """Mirrors the old identity.py's _canonical_record — normalizes both the
    legacy flat format ({"alice": "$2b$..."}) and the dict format."""
    from uuid import uuid4

    if isinstance(value, str):
        return {
            "id": f"u_{uuid4().hex}",
            "hash": value,
            "role": default_role,
            "created_at": datetime.now(timezone.utc).isoformat(),
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
        "id": str(value.get("id") or f"u_{__import__('uuid').uuid4().hex}"),
        "hash": hashed,
        "role": role,
        "created_at": str(value.get("created_at") or datetime.now(timezone.utc).isoformat()),
        "disabled": bool(value.get("disabled", False)),
        "avatar": str(value.get("avatar") or ""),
        "full_name": str(value.get("full_name") or ""),
        "registration_number": str(value.get("registration_number") or ""),
        "first_name": str(value.get("first_name") or ""),
        "surname": str(value.get("surname") or ""),
        "gender": str(value.get("gender") or ""),
        "course": str(value.get("course") or ""),
    }


def _load_legacy_records() -> dict[str, dict[str, Any]]:
    source = USERS_FILE if USERS_FILE.exists() else LEGACY_USERS_FILE
    raw = _read_json(source)
    if not raw:
        print(f"No users.json found at {USERS_FILE} or {LEGACY_USERS_FILE} — nothing to migrate.")
        return {}
    print(f"Reading legacy accounts from {source} ({len(raw)} entries)...")
    records: dict[str, dict[str, Any]] = {}
    for index, (username, value) in enumerate(raw.items()):
        default_role = "admin" if index == 0 else "user"
        record = _canonicalize(str(username), value, default_role=default_role)
        if record is not None:
            records[str(username)] = record
    return records


def _parse_created_at(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return datetime.now(timezone.utc)


async def main() -> None:
    records = _load_legacy_records()
    if not records:
        return

    async with session_scope() as session:
        existing_usernames = set(
            (await session.execute(select(User.username))).scalars().all()
        )
        created = 0
        skipped = 0
        for username, record in records.items():
            if username in existing_usernames:
                skipped += 1
                continue
            session.add(
                User(
                    id=record["id"],
                    username=username,
                    password_hash=record["hash"],
                    role=record["role"],
                    full_name=record["full_name"],
                    registration_number=record["registration_number"],
                    first_name=record["first_name"],
                    surname=record["surname"],
                    gender=record["gender"],
                    course=record["course"],
                    disabled=record["disabled"],
                    avatar=record["avatar"],
                    created_at=_parse_created_at(record["created_at"]),
                )
            )
            created += 1

    print(f"Migrated {created} account(s) into Postgres; skipped {skipped} already present.")
    if created:
        print("Verify logins work, then the old users.json can be archived/deleted.")


if __name__ == "__main__":
    asyncio.run(main())
