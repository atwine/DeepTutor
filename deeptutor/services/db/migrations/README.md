# This directory is historical only

Schema migrations now live in `alembic/` at the repo root and run via
`alembic upgrade head` (or `python scripts/init_db.py`, which just shells
out to that) — see Round 4 Task 3 in `devin-handoff/DEVIN_LOG.md` for the
full context on why and how.

The raw `.sql` file(s) in this directory predate that and were applied by
hand at merge time; they are kept only as a historical record of *why*
certain columns/tables exist. Do not run them again, and do not add new
`.sql` files here — author a new Alembic revision instead
(`alembic revision --autogenerate -m "..."` after changing
`deeptutor/services/db/models.py`).
