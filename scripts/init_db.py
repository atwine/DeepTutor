"""Initialize/migrate the Postgres schema for the course-unit/assignment
store to the latest revision.

Usage:
    python scripts/init_db.py

Reads DATABASE_URL the same way deeptutor.services.db.engine does (Railway
injects it automatically; falls back to the local docker-compose postgres
service otherwise).

Round 4 Task 3: this used to call ``Base.metadata.create_all()`` directly —
fine for the initial rollout (brand-new schema, zero production rows to
migrate around), explicitly flagged in this script's own former docstring
as a stopgap until "this schema needs a real migration against live data."
That moment passed three times over (start_date/end_date on CourseUnit,
the assignment-lifecycle columns, the archive/notification tables — all
applied by hand against the live database, never scripted). This now
delegates to Alembic (``alembic/``, configured against this project's
``Base.metadata`` and async engine in ``alembic/env.py``) so schema state
is tracked and reproducible instead of hand-run SQL. See devin-handoff/
DEVIN_LOG.md's Round 4 Task 3 entry for how the initial baseline migration
was verified to produce an identical schema to the old create_all() path.

Going forward, schema changes should be authored as a new Alembic revision
(``alembic revision --autogenerate -m "..."`` after changing
``deeptutor/services/db/models.py``, review the generated file, then
``alembic upgrade head``) rather than another manual ALTER/drop-and-recreate.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

# Repo root: this script lives at <repo>/scripts/init_db.py, and alembic.ini
# lives at <repo>/alembic.ini — Alembic must be invoked with that as the
# working directory (or via -c/--config) for its relative script_location
# ("alembic") to resolve.
REPO_ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=str(REPO_ROOT),
    )
    if result.returncode != 0:
        sys.exit(result.returncode)
    print("Database schema is up to date (alembic upgrade head).")


if __name__ == "__main__":
    main()
