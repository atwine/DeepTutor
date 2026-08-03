-- SUPERSEDED (Round 4 Task 3): this raw SQL file was never run by any
-- script/CI step — it was applied by hand at merge time and is kept here
-- only as a historical record. Its effect (is_timed/time_limit_minutes on
-- assignments, the assignment_access_grants table) is already captured in
-- the Alembic baseline migration (alembic/versions/*_baseline_current_schema.py),
-- generated from and verified against the live schema this file produced.
-- Do NOT run this file again; use `alembic upgrade head` (scripts/init_db.py)
-- instead. Kept for history, not deleted, since it documents *why* those
-- columns/table exist (see devin-handoff/DEVIN_LOG.md's Round 4 Task 3 entry).
--
-- Track A (Feature Round 2) — Assignment lifecycle & integrity
-- Adds:
--   1. is_timed + time_limit_minutes columns to assignments (A4)
--   2. assignment_access_grants table (A3)
--
-- Run after 001_initial_schema.sql (Phase F of DATABASE_MIGRATION_PLAN.md)
-- Idempotent: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS where possible.

-- A4: timed assignment columns
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS is_timed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS time_limit_minutes INTEGER;

-- A3: per-student exception/emergency access
CREATE TABLE IF NOT EXISTS assignment_access_grants (
    id TEXT PRIMARY KEY,
    assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    extra_attempts INTEGER,
    extended_due_at TEXT,
    granted_by TEXT NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_access_grant_assignment_user UNIQUE (assignment_id, user_id)
);

-- Index for fast lookup by assignment
CREATE INDEX IF NOT EXISTS idx_access_grants_assignment_id
    ON assignment_access_grants(assignment_id);
