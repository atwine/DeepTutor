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

---

## Decision, post-audit (2026-08-02): Postgres confirmed, work split into 3 tracks

Both audits below are real and both hold up under independent spot-checking — Cascade's
Postgres-vs-SQLite argument was explicitly conditional on this being a self-hosted
`docker compose` deployment; the repo owner has now confirmed the actual target is **Railway**
(local `docker compose` is dev/test only, not the production home) — so **Postgres is
confirmed**, resolving that disagreement. Devin's async/await gap and advisory-lock findings
apply regardless of DB choice and are both accepted as corrections to the plan below.

**Accepted corrections from both audits** (superseding the relevant sections above — implementers
should follow this section, not re-derive from the original draft):

- Storage functions become `async def`; every call site in the three routers gains `await`.
  The "routers don't change at all" framing earlier in this doc is corrected to **"routers gain
  `await`, no logic changes."**
- The K1 replacement is `pg_advisory_xact_lock(hashtext(assignment_id || user_id))`, **not**
  `SELECT ... FOR UPDATE` — the latter doesn't block a concurrent `INSERT` under Postgres's
  default READ COMMITTED isolation and would silently reintroduce the double-submission bug.
- The submit endpoint's shape is genuinely restructured, not mechanically ported: short
  transaction (advisory lock + count check) → **release** → `await grade_submission(...)` with
  no DB resources held → short transaction (re-count + insert). `_submit_locks` is deleted
  entirely, not left in place.
- Phase D scope is `assignments.py` only. `grading.py` and `gradebook.py` need zero changes —
  don't touch them; if a change turns out to be needed, that's a scope surprise worth flagging,
  not something to do preemptively.
- `delete_course_unit()`'s current manual sweep (importing `_load_assignments`/
  `_load_submissions`/`_load_course_books` from sibling modules) is **deleted in its entirety**,
  not ported — `ON DELETE CASCADE` on the foreign keys replaces it declaratively, and this is
  what removes the one cross-module coupling Cascade's audit flagged.
- `course_books.py`'s re-assignment upsert must explicitly preserve `created_at`/`status` on
  conflict (only set `course_unit_id`/`updated_at`) — matching current behavior where
  re-assigning a book doesn't silently unpublish it.
- `due_at` stays `TEXT` — a deliberate non-fix, not an oversight; don't migrate it to
  `TIMESTAMPTZ` mid-effort.

### Work split — 3 tracks, chosen to have zero file overlap

**Track 1 — Claude: foundation (must land and be frozen before Tracks 2 and 3 start)**
- Phase A: `sqlalchemy`+`asyncpg` in `pyproject.toml`; a `postgres` service added to
  `docker-compose.yml` (mirrors the existing `pocketbase` sidecar); connection/session setup
  module.
- Phase B: the ORM models for every table in the draft schema — this is the shared contract.
  Once merged, treat these models as frozen; Tracks 2 and 3 build against them, they don't
  modify them.
- Phase F (one-time JSON→DB import, if wanted for any dev data worth keeping) and Phase H
  (update `ARCHITECTURE_AND_COMPLETED_WORK.md`'s storage-pattern guidance).
- **Files**: new files only (`pyproject.toml` dependency addition, `docker-compose.yml` service
  addition, a new DB session module, new ORM model module(s)) — doesn't touch
  `course_units.py`, `assignments.py`, or `course_books.py` at all.

**Track 2 — Cascade: `course_units.py` + `course_books.py`**
- Rewrite both modules' public functions against Track 1's frozen models, keeping names/
  signatures unchanged (parameters and return shapes — not the sync/async nature, which
  changes per the accepted correction above).
- Add `await` at every call site in `router.py` and `book_access_router.py`.
- `delete_course_unit()` becomes one `DELETE FROM course_units WHERE id = ...` — the cascade
  sweep is deleted, not preserved.
- Re-verify the `course_books.py` re-assignment upsert preserves `created_at`/`status` (see
  accepted corrections above).
- **Files**: `deeptutor/multi_user/course_units.py`, `deeptutor/multi_user/course_books.py`,
  `deeptutor/multi_user/router.py`, `deeptutor/multi_user/book_access_router.py`.

**Track 3 — Devin: `assignments.py`**
- Rewrite its public functions against Track 1's frozen models, same signature-preservation
  rule as Track 2.
- Implement the advisory-lock-based submit flow exactly as specified in Devin's own audit
  finding #2/#4 above — this is the track's hardest piece and the one place where behavior
  genuinely changes shape, not just storage engine.
- Add `await` at every call site in `assignments_router.py`.
- Do **not** touch `grading.py` or `gradebook.py`.
- **Files**: `deeptutor/multi_user/assignments.py`, `deeptutor/multi_user/assignments_router.py`.

### How this avoids collisions

1. **One-way dependency, not mutual**: Tracks 2 and 3 both depend on Track 1's models; they
   don't depend on each other. Track 1 must merge first.
2. **Disjoint file sets**: no filename appears in both Track 2's and Track 3's lists above —
   their diffs cannot conflict even if worked on at the same time, once Track 1 has landed.
3. **Separate branches**: each track works on its own branch cut from the commit where Track 1
   merged (e.g. `db-migration-course-units`, `db-migration-assignments`), not the same working
   directory — avoids the uncommitted-parallel-edits collision that happened earlier this
   session when two agents worked the same checkout at once.
4. **Claude does the integration + Phase G regression pass.** Since the branches don't overlap
   at the file level, merging should be mechanical, not conflict resolution. After merging both,
   re-run all 14 cases in `EDGE_CASE_TESTING.md` against the combined result before considering
   any of this done — same regression suite already used for the JSON-backed version, no new
   verification invented from scratch.

**Sequencing**: Track 1 lands and is announced "frozen" in `DEVIN_LOG.md` → Tracks 2 and 3 start
in parallel on their own branches → both report done in `DEVIN_LOG.md` with which branch to pull
→ Claude merges both, runs Phase G, reports final results.

---

## Devin audit — 2026-08-02

Read-only audit against the actual code in `deeptutor/multi_user/` and the routers that
call it. Every claim below was verified by reading the file/line cited, not assumed from
the plan's description. The plan is solid on the whole; the findings below are corrections,
gaps, and one near-blocker that should be resolved **before** Phase C starts, not during it.

### What the plan gets right (verified, no change needed)

- **Three modules, flat JSON, `threading.Lock`, full read/rewrite on every op** — confirmed
  in `course_units.py:26,56-58,61-68`, `assignments.py:29,65-67,70-77`,
  `course_books.py:28,49-51,54-56`. `_write_json` is `path.write_text(...)` with no
  temp-file-then-rename, so the non-atomic-write claim is accurate.
- **`delete_course_unit()` manually sweeps three files** — confirmed at
  `course_units.py:131-174` (imports `_load_assignments`/`_load_submissions`/`_load_course_books`
  privately and filters each dict in Python). The plan's claim that `ON DELETE CASCADE`
  replaces this is correct.
- **`count_submissions()` is O(all submissions system-wide)** — confirmed at
  `assignments.py:229-236` (linear scan of every submission to count one student's attempts
  on one assignment). The proposed `idx_submissions_assignment_user` index directly fixes this.
- **K1 race fix uses `asyncio.Lock` held across `await grade_submission(...)`** — confirmed at
  `assignments_router.py:285-305`, with the double-check (`count` before and after the awaited
  grade). The plan's note that this is correct today but not cross-process is accurate.
- **`gradebook.py` loads every assignment + every submission and joins in Python** — confirmed
  at `gradebook.py:26-88`. A SQL `JOIN` is a real improvement, not just cosmetic.
- **`pocketbase` sidecar exists in `docker-compose.yml`** — confirmed (lines 27-41). Mirroring
  it for `postgres` is a reasonable local-dev pattern.
- **Schema field coverage for `course_units`, `enrollments`, `assignments`, `submissions`,
  `course_book_entries`** — every field in the current record dicts is represented in the
  proposed tables. The `UNIQUE (course_unit_id, user_id)` on `enrollments` is a genuine
  improvement: today uniqueness is app-enforced via `_find_enrollment`'s linear scan
  (`course_units.py:219-228`), so the DB constraint closes a real class of duplicate-enrollment
  bugs for free, as the plan states.
- **Public function names/signatures listed in Phase C** (`create_course_unit`, `enroll_student`,
  `list_assignments_for_course`, `create_submission`, `delete_course_unit`, …) — all confirmed
  to exist with those exact names in the three modules.

### Gaps and corrections (ordered by impact)

#### 1. Near-blocker: the "routers don't change" constraint is incompatible with async DB I/O

This is the single most important finding and it is **not** addressed in the plan. Every
public function in the three storage modules is currently a **synchronous** `def`, called
**without `await`** from `async def` router handlers. Verified examples:

- `router.py:307` — `record = create_course_unit(...)` inside `async def create_course_unit_endpoint`
- `router.py:324` — `units = list_course_units()` inside `async def list_course_units_endpoint`
- `router.py:422` — `record = enroll_student(...)` inside `async def enroll_student_endpoint`
- `assignments_router.py:287` — `already = count_submissions(...)` inside `async def submit`
- `assignments_router.py:307` — `record = create_submission(...)` inside `async def submit`
- `assignments_router.py:175,183,211` — `list_assignments_for_course`, `count_submissions`
  called sync throughout

The plan's headline constraint (§"Target design") says: *"every public function in these
three modules keeps its exact existing name and signature… the routers… should not need to
change at all."* An async SQLAlchemy engine **requires** the storage functions to become
`async def` (you cannot `await session.execute(...)` inside a sync `def`). That forces an
`await` onto every call site in `router.py`, `assignments_router.py`, and
`book_access_router.py` — directly contradicting the constraint and expanding the blast
radius from "three files" to "three files + three routers + every endpoint in them."

The plan must explicitly pick one of three reconciliations **before** Phase C, because
discovering this mid-Phase-C forces a re-plan:

- **(a) Storage functions become `async def`; routers gain `await`.** Honest, idiomatic, but
  it breaks the stated constraint. Blast radius = the three routers too. This is probably the
  *right* answer for an async-first codebase, but the plan should say so and stop claiming the
  routers are untouched.
- **(b) Storage functions stay `def`; use a synchronous SQLAlchemy engine + `psycopg` (sync
  driver).** Preserves the constraint exactly. Cost: every DB query blocks the single event
  loop thread. In an LLM-heavy app where the loop is already a scarce resource (the K1 fix
  exists *because* an `await` during grading opened a race window), blocking the loop on DB
  I/O is a real regression for latency under load — though for the read/write volumes in this
  subsystem (small rows, low QPS) it may be acceptable in practice. Needs an explicit
  tradeoff acknowledgment, not a silent default.
- **(c) Storage functions stay `def` but bridge to async internally** (e.g.
  `asyncio.run_coroutine_threadsafe` against a dedicated executor). Keeps the routers untouched
  and the loop unblocked, but is the most complex and the easiest to get subtly wrong
  (deadlocks, session lifecycle across threads). Not recommended unless (a) and (b) are both
  ruled out for stated reasons.

**Recommendation**: pick (a), update the plan's constraint to "routers gain `await` but no
logic changes," and re-scope Phase C/D to include the mechanical `await`-addition pass across
the three routers. The signature-preservation guarantee still holds (names, parameters,
return shapes unchanged) — only call sites gain `await`. That is a much smaller change than
"rewrite the routers," and it's the honest scope.

#### 2. `SELECT ... FOR UPDATE` does not enforce the attempt limit in Postgres

The plan (§"What happens to the locking problem") says K1 becomes *"a `SELECT ... FOR UPDATE`
(lock just that student's submission rows for the duration of the check-and-insert) or a
unique constraint on `(assignment_id, user_id, attempt_number)`."* The `FOR UPDATE` option
does **not** do what the plan implies under Postgres's default READ COMMITTED isolation:
`SELECT ... FOR UPDATE` locks **existing** matching rows, but it does **not** prevent a
concurrent transaction from **INSERTing** a new row for the same `(assignment_id, user_id)`
— Postgres has no MySQL-style gap locking by default. Two concurrent transactions can both
`SELECT FOR UPDATE` the existing rows (both see the same count), both pass the
`count < attempt_limit` check, and both INSERT — reintroducing K1 under concurrent load, the
exact bug the migration is partly motivated by.

The options that actually work:

- **A partial unique index / constraint** is only clean if `attempt_limit` is fixed at 1
  (e.g. `UNIQUE (assignment_id, user_id) WHERE attempt_number = 1`) — it doesn't generalize
  to `attempt_limit = N > 1` without per-row attempt numbering and a constraint expression
  that references the assignment's `attempt_limit`, which a plain `UNIQUE` can't.
- **`pg_advisory_xact_lock(hashtext(assignment_id || user_id))`** at the top of the
  check-and-insert transaction — a per-(assignment,user) advisory lock held for the duration
  of the transaction. This is the closest direct replacement for the current
  `_submit_locks[(assignment_id, user_id)]` `asyncio.Lock` and works correctly across
  processes. **This is the recommended fix**, not `FOR UPDATE`.
- **SERIALIZABLE isolation + retry** — correct but heavier; requires retry-on-40001 logic in
  the submit endpoint, which the current code doesn't have.

The plan should be corrected to name `pg_advisory_xact_lock` as the primary mechanism, with
`FOR UPDATE` removed or demoted to "not sufficient on its own." This is a one-line fix to the
plan that prevents a real correctness regression.

#### 3. Phase D over-scopes `grading.py` and `gradebook.py` — they need zero changes

Phase D lists "Rewrite `assignments.py`, `grading.py`, `gradebook.py`." But:

- `grading.py` (`deeptutor/multi_user/grading.py`, 143 lines) does **no storage** — it's pure
  grading logic + an `await llm_complete(...)` call, importing only
  `QUESTION_TYPES_AUTO_GRADABLE` from `assignments.py`. If `assignments.py`'s public symbols
  are preserved (the plan's own constraint), `grading.py` needs **zero** changes.
- `gradebook.py` (`deeptutor/multi_user/gradebook.py`, 113 lines) is pure aggregation that
  calls `list_assignments_for_course`, `get_latest_submission`, `list_enrollments_for_course`,
  and `get_user_by_id`. Same story — preserved signatures ⇒ zero changes.

Listing them as Phase D rewrite targets is misleading and creates risk: an implementer might
unnarily rewrite `grading.py`'s LLM-coupled verdict-parsing logic (which has a deliberate
fail-closed-to-0 policy documented at `grading.py:28-40` — "a false 'correct' is a worse
failure mode than a false 'incorrect'") and silently change that policy. **Recommendation**:
Phase D = `assignments.py` only. Note explicitly that `grading.py` and `gradebook.py` are
downstream consumers protected by the signature-preservation constraint and are expected to
require no changes; if a change does turn out to be needed, flag it as a scope surprise.

#### 4. The attempt-limit transaction boundary must be restructured (forced design change)

Today (`assignments_router.py:285-313`) the `asyncio.Lock` is held across:
`count_submissions` → `await grade_submission` (an LLM call, 10-60s) → `count_submissions`
again → `create_submission`. Holding a **DB transaction** open across a 10-60s LLM call is an
anti-pattern: it holds a connection from the pool and any row locks for the full duration,
which under load exhausts the pool and blocks unrelated requests. The migration cannot
mechanically port this shape; it must be restructured to:

1. Acquire DB + `pg_advisory_xact_lock` + `count` check + **release** (commit) — short txn.
2. Run `await grade_submission(...)` with **no** DB resources held.
3. Re-acquire DB + `pg_advisory_xact_lock` + re-`count` + `INSERT` + release — short txn.

This preserves the current double-check semantics (the post-grade re-check at
`assignments_router.py:300-305` stays meaningful) without holding a connection across the
LLM call. The plan should call this out as a **required restructuring in Phase D**, not a
mechanical port. It also means the `_submit_locks` `asyncio.Lock` dict
(`assignments_router.py:59-66`) is **deleted entirely** — the advisory lock replaces it and
works cross-process, which is the win — but the router's submit endpoint structure changes
more than "add `await`": the lock context manager becomes a transaction context manager
around each of the two DB touches, with the LLM call between them.

#### 5. `delete_course_unit`'s private-import cascade code is deleted, not migrated

`course_units.py:148-149` imports `_load_assignments`, `_load_submissions`,
`_load_course_books` (private functions from sibling modules) to do its manual sweep. After
migration these private loaders no longer exist. The plan correctly says `delete_course_unit`
"becomes one `DELETE FROM course_units WHERE id = ...` and the cascades happen
automatically" — but it should state explicitly that **lines 138-173 of the current
`delete_course_unit` are deleted in their entirety**, not ported, so an implementer doesn't
try to preserve the sweep logic "just in case." The `ON DELETE CASCADE` foreign keys on
`enrollments`, `assignments` (→ `submissions`), and `course_book_entries` replace it
declaratively.

#### 6. `course_books.py` re-assignment preserves `created_at` + `status` — app must keep doing that

`course_books.py:69-76`'s `assign_book_to_course_unit` deliberately preserves `created_at`
and `status` across a re-assignment (moving a book between course units doesn't silently
unpublish it or reset its audit timestamp). The proposed `course_book_entries` schema has
`created_at`/`updated_at`/`status` columns with `DEFAULT now()`, but a naive `INSERT … ON
CONFLICT (book_id) DO UPDATE SET course_unit_id = …` would **not** preserve `created_at` and
`status` unless the `DO UPDATE` clause explicitly omits them (or copies them from the
existing row). The plan should add a one-line implementation note: the upsert must set only
`course_unit_id` and `updated_at` on conflict, leaving `created_at` and `status` untouched —
matching the current behavior. This is the kind of subtle behavior that's easy to lose in a
migration and hard to notice in testing (you'd have to re-assign an already-published book
and check it stayed published).

#### 7. Phase F and Phase G are coupled — you need a test-data seeding path either way

Phase F says production data is "likely a clean-start decision." That's reasonable for
production, but `EDGE_CASE_TESTING.md`'s 14 cases (Phase G's regression suite) **create
records during the test run** — course units, enrollments, assignments, submissions. On a
fresh DB those records are created by the tests themselves via the API, so Phase G doesn't
strictly need Phase F's JSON-import script. But the plan should state this explicitly so an
implementer knows Phase G can run on a clean DB without Phase F, **and** so they know that
if any pre-existing dev data in `data/system/courses/*.json` is worth preserving for manual
exploration, Phase F is the only chance to carry it over. As written, the coupling is
ambiguous.

#### 8. Minor: enumerate the `questions` JSONB canonical shape

The plan says `questions` stays JSONB with a gesture at "choice/short_answer/etc, options,
points." The actual canonical shape (from `assignments.py:80-93`'s `_normalize_question`) is:
`{question_id, question, question_type, options, correct_answer, explanation, points}`.
Worth enumerating in the plan so (a) the Phase F migration script knows the exact keys to
copy, and (b) any future decision to index into JSONB (the plan mentions this as a
possibility) knows what's queryable. `options` is `dict | None` (None for non-choice types),
`points` is `float`, the rest are `str`.

#### 9. Minor: `due_at` as `TEXT` is a deliberate non-fix, document it as such

The schema keeps `due_at TEXT NOT NULL DEFAULT ''`, matching the current code's loose
contract (often empty string, opaque format). This is the right call for a migration that
shouldn't expand scope, but a one-line note that this is a **deliberate** "don't fix date
handling in this migration" decision would stop a future reader from filing it as an
oversight and trying to migrate it to `TIMESTAMPTZ` mid-effort (which would ripple into the
frontend's assignment form).

#### 10. Minor: deleted-instructor dangling references are a pre-existing gap, not a regression

`course_unit_instructors.instructor_id` has no FK (users stay in `identity.py`'s JSON, out of
scope). If a user is deleted from `identity.py`, their id lingers in the join table — same as
today, where `instructor_ids` in the JSON record isn't cleaned on user deletion. The plan
should note this is a **pre-existing gap the migration does not close** (and shouldn't, given
the users-stay-JSON scope decision), so it isn't later mistaken for a migration-introduced
bug.

### Summary of recommended plan edits (before any Phase C work starts)

1. **Resolve finding #1**: pick an async strategy. Recommendation: storage functions become
   `async def`, routers gain `await` (mechanical), update the "routers don't change" claim to
   "routers gain `await` but no logic changes."
2. **Resolve finding #2**: replace "`SELECT ... FOR UPDATE`" with "`pg_advisory_xact_lock` on
   `hashtext(assignment_id || user_id)`" as the K1 replacement mechanism.
3. **Resolve finding #3**: Phase D = `assignments.py` only; `grading.py`/`gradebook.py`
   explicitly out of scope (protected by signature preservation).
4. **Resolve finding #4**: add a "required restructuring" note to Phase D for the
   submit-endpoint's transaction boundary (short txn → LLM call → short txn), and note that
   `_submit_locks` is deleted.
5. **Resolve finding #5**: state that `delete_course_unit`'s manual cascade
   (`course_units.py:138-173`) is deleted, not ported.
6. **Resolve findings #6-#10**: add the one-line implementation notes above.

Findings #1, #2, and #4 are the ones that can cause real correctness/latency regressions if
the plan is implemented as written; the rest are scope-clarity and behavior-preservation
notes. None of this changes the plan's overall shape (Postgres + SQLAlchemy 2.0 async +
phased rollout + edge-case regression matrix) — it sharpens the parts that were under-specified
in ways that would bite during implementation.
