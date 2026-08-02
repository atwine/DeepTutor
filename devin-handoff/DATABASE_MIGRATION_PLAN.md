# Plan: move course/assignment/grading data off flat JSON onto a real database

Scoping only — nothing in this plan should be implemented until the repo owner says go on a
specific phase. Written the same way `EDGE_CASE_TESTING.md` was: grounded in the actual code,
not a generic migration checklist.

## Why this, why now

Confirmed directly in code (not assumed): `deeptutor/multi_user/course_units.py`,
`assignments.py`, and `course_books.py` all store their data as single JSON files under
`data/system/courses/`, read and rewritten **in full** on every operation
(`_read_json`/`_write_json` — no caching, no indexing, no partial reads). Concurrent writes are
serialized by a plain in-process `threading.Lock` per file. Confirmed problems this causes,
in order of how much they matter:

1. **Writes aren't atomic** (`path.write_text(...)`, no temp-file-then-rename) — a crash mid-write
   can corrupt the whole file, taking down every course unit or every assignment in the system
   at once, not just the one being written.
2. **The in-process locks silently stop working the moment this app runs as more than one
   process** — e.g. the first obvious move if a single server gets overloaded (two Railway
   replicas behind a load balancer). Two processes have two separate locks; neither knows about
   the other. This is a correctness time-bomb, not a performance one.
3. **Every read is O(total records system-wide)**, not O(what you actually asked for) — listing
   one course's 5 assignments still means reading and parsing every assignment in the entire
   system. This is confirmed to also apply to the course-unit-deletion cascade (§C1/C2 in
   `EDGE_CASE_TESTING.md`), which scans every assignment and submission in the system to find
   the handful belonging to one deleted unit.
4. **No pagination anywhere in this layer** — a large course's roster/gradebook returns
   everything in one response.

None of this was a mistake — flat JSON files match this codebase's existing style
(`identity.py`, `grants.py` do the same thing) and were a reasonable choice for a
single-instructor-testing scale. It stops being reasonable once real multi-course, real-student
load shows up, which is exactly the growth this platform is aiming for.

## What's in scope, what's explicitly not

**In scope** (the three modules with the real correctness problems, and the ones whose data
volume actually grows with usage over time — more students × more assignments × more attempts):

- `course_units.py` — `CourseUnit`, `Enrollment`
- `assignments.py` — `Assignment`, `Submission`
- `course_books.py` — the book-to-course-unit index (`book_id → {owner_id, course_unit_id, status}`)

**Explicitly out of scope for this migration** (own tradeoffs, lower urgency, don't block on
these — call them out as separate future decisions if they ever become real bottlenecks):

- **`identity.py` (users) and `grants.py` (per-user access grants)** — `grants.py` is already
  sharded per-user (`grant_path(user_id)` — one small file per user, not one giant shared file),
  so it doesn't have the same "one lock serializes everyone" problem. `identity.py`'s
  `users.json` is a single shared file like the others, but its size scales with *number of
  user accounts*, not with ongoing activity (submissions, assignments) — orders of magnitude
  slower growth. Worth revisiting later, not now.
- **Chat/session storage** — already SQLite, already sharded one file per user
  (`get_chat_history_db()`). This is architecturally sound as-is; the only known gap is the
  admin feedback review only seeing the admin's own workspace (a separate, already-documented
  limitation, not a scaling problem with this storage choice itself).
- **Memory, Knowledge Base, notebook storage** — same per-user-workspace shape as chat, not
  touched by this plan.

## Target design

**Database**: PostgreSQL. Railway offers it as a one-click managed addon, which is the deciding
factor given the deployment target — no separate ops burden to stand one up. For local
development, run Postgres as an additional `docker-compose.yml` service (mirrors the existing
`pocketbase` sidecar pattern already in this file) rather than trying to keep a SQLite fallback
path alive — maintaining two DB backends doubles the testing surface for no real benefit here.

**Access layer**: SQLAlchemy (2.0-style, async engine — the rest of this codebase is
async-first, e.g. every router handler is `async def`, so the DB layer should be too;
`asyncpg` as the driver). Not an opinionated framework beyond that — no need for a full
"repository pattern" abstraction on top, since the existing module boundaries
(`course_units.py`, `assignments.py`, `course_books.py`) already are the right abstraction
boundary.

**The single most important design constraint for this migration**: every public function in
these three modules keeps its exact existing name and signature
(`create_course_unit`, `enroll_student`, `list_assignments_for_course`, `create_submission`,
`delete_course_unit`, etc.). The routers (`router.py`, `assignments_router.py`,
`book_access_router.py`) import and call these functions today and should not need to change
at all. This bounds the blast radius to "rewrite what's inside these three files," not "touch
every endpoint" — the same reasoning as why the K1/C1 fixes earlier only touched the storage
functions, not the router logic that calls them.

### Draft schema

```sql
-- course_units.py
CREATE TABLE course_units (
    id              TEXT PRIMARY KEY,          -- keep existing "cu_..." id format
    name            TEXT NOT NULL,
    term            TEXT NOT NULL DEFAULT '',
    description     TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE course_unit_instructors (       -- many-to-many, was a JSON list column
    course_unit_id  TEXT NOT NULL REFERENCES course_units(id) ON DELETE CASCADE,
    instructor_id   TEXT NOT NULL,             -- references users.json's user_id; users table
                                                -- itself stays out of scope for now, so no FK
    PRIMARY KEY (course_unit_id, instructor_id)
);

CREATE TABLE enrollments (
    id              TEXT PRIMARY KEY,
    course_unit_id  TEXT NOT NULL REFERENCES course_units(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'approved',  -- 'pending' | 'approved'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at     TIMESTAMPTZ,
    UNIQUE (course_unit_id, user_id)          -- was implicitly enforced by app code; now a
                                               -- real constraint, closes a whole class of
                                               -- possible duplicate-enrollment bugs for free
);

-- assignments.py
CREATE TABLE assignments (
    id              TEXT PRIMARY KEY,
    course_unit_id  TEXT NOT NULL REFERENCES course_units(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    questions       JSONB NOT NULL,             -- keep as JSONB: the question list's internal
                                                 -- shape (choice/short_answer/etc, options,
                                                 -- points) doesn't need its own relational
                                                 -- decomposition yet — Postgres can still index
                                                 -- into JSONB if that ever becomes necessary
    weight          REAL NOT NULL DEFAULT 1.0,
    attempt_limit   INTEGER NOT NULL DEFAULT 1,
    due_at          TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'published'
    created_by      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE submissions (
    id                TEXT PRIMARY KEY,
    assignment_id     TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    user_id           TEXT NOT NULL,
    answers           JSONB NOT NULL,
    question_results  JSONB NOT NULL,
    score             REAL NOT NULL,
    max_score         REAL NOT NULL,
    submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_submissions_assignment_user ON submissions(assignment_id, user_id);
-- ^ this index is what turns count_submissions() from an O(all submissions system-wide) scan
--   into an actual indexed lookup — directly fixes the K1 fix's performance shape, on top of
--   Postgres's own transaction isolation fixing the *correctness* shape (see below).

-- course_books.py
CREATE TABLE course_book_entries (
    book_id         TEXT PRIMARY KEY,
    owner_id        TEXT NOT NULL,
    course_unit_id  TEXT NOT NULL REFERENCES course_units(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'draft',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Every `ON DELETE CASCADE` above is doing, declaratively, exactly what the C1/C2 bug fix had to
do by hand (manually sweeping three separate JSON files in `delete_course_unit()`). This is
the biggest single win of this migration in plain terms: **a whole category of "did we
remember to clean this up" bugs becomes structurally impossible**, enforced by the database
itself instead of by an engineer remembering to update every function that deletes something.

### What happens to the locking problem

`_WRITE_LOCK = threading.Lock()` disappears entirely from both `assignments.py` and
`course_units.py`. Postgres transactions handle concurrent writes correctly on their own — and
correctly *across multiple app processes*, which is the exact case the current in-memory locks
cannot handle at all. The attempt-limit race condition (K1) becomes a `SELECT ... FOR UPDATE`
(lock just that student's submission rows for the duration of the check-and-insert) or a unique
constraint on `(assignment_id, user_id, attempt_number)` if attempts ever need numbering — either
way, correct under real concurrency, and correct even if this app is later split across multiple
replicas, which the current `asyncio.Lock` fix (correct today) still would not be.

## Phased plan

**Phase A — Infrastructure, no behavior change yet.**
Add `sqlalchemy`+`asyncpg` to `pyproject.toml`. Add a `postgres` service to `docker-compose.yml`
(mirroring the existing `pocketbase` service's shape). Add connection/session setup (likely
`deeptutor/services/db.py` or similar, following this codebase's `services/` convention). No
existing code path touches it yet — this phase is purely "can the app start up with a Postgres
connection available."

**Phase B — ORM models.**
Define the SQLAlchemy models for the schema above. Write the migration (Alembic, the standard
companion to SQLAlchemy, or a single hand-written `CREATE TABLE` bootstrap script if Alembic
feels like overkill for this project's size — worth a quick judgment call at the time, not
pre-decided here).

**Phase C — Rewrite `course_units.py`.**
Every function (`create_course_unit`, `list_course_units`, `get_course_unit`,
`update_course_unit`, `delete_course_unit`, `enroll_student`, `unenroll_student`,
`request_enrollment`, `approve_enrollment`, `list_enrollments_for_course`,
`list_enrollments_for_student`, `is_instructor_of`, `is_approved_student_of`, ...) gets
rewritten to issue SQL instead of reading/writing JSON, keeping its name and signature
unchanged. `delete_course_unit` gets *simpler*, not more complex — it becomes one `DELETE FROM
course_units WHERE id = ...` and the cascades happen automatically.

**Phase D — Rewrite `assignments.py`, `grading.py`, `gradebook.py`.**
Same approach. `gradebook.py`'s aggregation (currently: load every assignment, load every
submission, join them in Python) becomes a real SQL `JOIN` — meaningfully faster at any real
scale, not just "still works."

**Phase E — Rewrite `course_books.py`.**
Smallest of the three — one table, no complex relationships.

**Phase F — One-time data migration script.**
Read whatever's currently in the JSON files under `data/system/courses/` and insert it into the
new tables. Given `data/` is gitignored local runtime state and this deployment isn't yet
carrying real production student data, this is likely a clean-start decision rather than a
carefully-preserved migration — confirm with the repo owner at the time rather than assuming.

**Phase G — Regression pass using the existing edge-case matrix.**
`EDGE_CASE_TESTING.md` already has 14 documented, verified-correct behaviors for exactly this
subsystem (cross-instructor isolation, enrollment lifecycle, cascade deletes, the attempt-limit
race, empty states...). Re-run that same matrix against the DB-backed implementation before
calling this migration done — this is the regression suite, already written, no need to invent
a new one.

**Phase H — Docs.**
Update `ARCHITECTURE_AND_COMPLETED_WORK.md`'s storage-pattern section (currently says "a JSON
file under `data/system/`... not a new SQLite table, not an ORM" — that guidance flips for
these three modules once this lands) and this folder's `README.md` conventions section if the
test-data cleanup story changes (temp-account JSON cleanup becomes `DELETE` statements or a
test-database reset instead).

## Honest sizing

This is a real, multi-session engineering effort — not a weekend task. Rough shape: Phase A/B
(infrastructure + schema) is the smallest and most mechanical. Phase C/D (rewriting
`course_units.py` and `assignments.py`/`grading.py`/`gradebook.py`) is the bulk of the actual
work, both because those files are the biggest and because they're the ones with the trickiest
existing logic (the enrollment request/approve state machine, the weighted-gradebook
aggregation, the attempt-limit checking) that needs to come out the other side behaving
identically. Phase G (regression testing) is not optional given how much of this session went
into finding and fixing subtle bugs in the *current* version of this exact logic — skipping
verification here risks silently reintroducing bugs already fixed once.

## Suggested next step

Don't start with Phase C or D. Start with **Phase A** — get a Postgres container running
locally alongside the existing stack and confirm the app can connect to it — as a small,
low-risk, easily-reversible first step that de-risks the "does this fit into the existing
docker-compose setup cleanly" question before committing to rewriting any real logic.
