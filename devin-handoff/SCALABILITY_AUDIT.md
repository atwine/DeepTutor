# DeepTutor — Full-Codebase Scalability Audit

**Date**: 2026-08-04
**Trigger**: Issue #31 (gradebook N+1 query fix) prompted the question:
"where else would the system break if data grew 100x?"
**Method**: 5 parallel subagents audited the entire codebase — DB/ORM layer,
identity/JSON store, API routers, frontend, and capabilities/KB layer.
**Scope**: What breaks at 100x scale (10,000 students, 1,000 courses,
100,000 submissions, 10,000 users, 1,000 documents per KB, 100,000 chat
messages).

---

## Executive Summary

| Severity | Count | Meaning |
|----------|-------|---------|
| CRITICAL | 26    | Would break or make the system unusable at 100x |
| HIGH     | 15    | Would be very slow (seconds → minutes) at 100x |
| MEDIUM   | 12    | Noticeable degradation at 100x |
| LOW      | 12    | Minor impact, worth noting |

**Root causes** (3 themes account for ~80% of CRITICAL findings):

1. **JSON file-based identity store** — `load_users()` reads the entire
   `users.json` from disk on every call. `get_user_by_id()` does a linear
   scan through all users. Both are called inside loops in 7+ places.
   At 10,000 users, a single roster endpoint does 10,000 file reads ×
   10,000 linear scans = 100M operations.

2. **Missing database indexes** — Enrollment, Notification, and
   NotificationRead tables have no indexes on their foreign key columns.
   The submissions table has single-column indexes but is missing the
   composite `(assignment_id, user_id)` index that the code comments
   claim exists. At 100x, every roster/notification query does a full
   table scan.

3. **No pagination anywhere** — Every list endpoint and every frontend
   table returns/renders all rows. No endpoint has `limit`/`offset`
   params (except sessions and memory trace, which already have limits).
   At 100x, the gradebook renders 10,000 × 50 = 500,000 DOM cells.

---

## Tier 1 — CRITICAL (Fix First)

These would make the system unusable at 100x. Many are quick wins (the
batched lookup function `get_users_by_ids()` already exists from issue #31).

### T1.1 — `get_user_by_id()` called in loops (7 locations)

The function reads the entire `users.json` from disk and linear-scans all
users. Called per-item in:

| # | File | Lines | Function | Loop over |
|---|------|-------|----------|-----------|
| 1 | `multi_user/router.py` | 605-618 | `_enrollment_with_student_info()` | enrollments (roster) |
| 2 | `multi_user/router.py` | 342-344 | `_attach_instructor_usernames()` | instructors per course |
| 3 | `multi_user/assignments_router.py` | 408-414 | `list_submissions_endpoint()` | submissions |
| 4 | `multi_user/router.py` | 584 | `enroll_student_endpoint()` | per enrollment |
| 5 | `multi_user/grants.py` | 100-112 | `save_grant()` | per grant |
| 6 | `multi_user/router.py` | 167 | `_require_assignable_user()` | per assignment |
| 7 | `multi_user/assignments_router.py` | 503 | `create_access_grant_endpoint()` | per grant |

**Fix**: Replace each with `get_users_by_ids()` (already exists in
`identity.py` line 280). Batch all user_ids, do one file read, look up
from the returned dict.

**Impact at 100x**: Roster endpoint: 10,000 file reads → 1. Submission
list: 1,000 file reads → 1.

### T1.2 — `list_notifications_for_user()` — N+1 access check

**File**: `multi_user/notifications.py` lines 83-87
```python
course_unit_ids = [
    cu_id for cu_id in candidate_unit_ids
    if await is_approved_student_of(user_id, cu_id)  # 1 DB query per course
]
```
**At 100x**: 100 courses per student → 100 DB queries per notification fetch.
**Fix**: Batch-fetch all enrollments for the user in one query, filter
`candidate_unit_ids` against the result set in memory.

### T1.3 — Missing composite index on submissions

**File**: `services/db/models.py` lines 217-220
**Issue**: Code comments claim a composite `(assignment_id, user_id)` index
exists, but the migration only creates two separate single-column indexes.
Queries like `get_latest_submission` and `count_submissions` filter by both
columns.
**At 100x**: 1M submissions → Postgres can only use one index, does a
partial scan for the other column.
**Fix**: Add migration: `CREATE INDEX ix_submissions_assignment_user ON
submissions (assignment_id, user_id);`

### T1.4 — Missing indexes on Enrollment table

**File**: `services/db/models.py` lines 132-135
**Issue**: Neither `course_unit_id` nor `user_id` has an index. Both are
filtered on in every roster, enrollment, and completion check query.
**At 100x**: 1M enrollments → full table scan for every roster lookup.
**Fix**: Add `index=True` to both columns + migration.

### T1.5 — Missing indexes on Notification tables

**File**: `services/db/models.py` lines 297-299, 326-329
**Issue**: `Notification.course_unit_id` and `NotificationRead.(notification_id, user_id)`
have no indexes. Both are filtered on in `list_notifications_for_user()`.
**Fix**: Add indexes + migration.

### T1.6 — `session.refresh()` in loops (3 locations)

**File**: `multi_user/course_units.py` lines 193-194, 377-378, 396-397
```python
for u in units:
    await session.refresh(u, ["instructors"])  # 1 query per course unit
```
**At 100x**: 1,000 course units → 1,001 queries (1 + 1,000 for instructors).
**Fix**: Use `selectinload(CourseUnit.instructors)` on the initial query —
SQLAlchemy fetches all instructors in one additional query.

### T1.7 — `load_users()` full file read on every call (19 call sites)

**File**: `multi_user/identity.py` lines 136-181
**Issue**: Every call reads + parses the entire `users.json`. Called by 19
functions including `authenticate()` (every login), `list_user_info()`
(every admin page), `search_enrollable_users()` (every enrollment search).
**At 100x**: 10,000 users → 2-5 MB file read per call. 19 call sites ×
concurrent requests = massive disk I/O.
**Fix**: In-memory cache with TTL (e.g., `@lru_cache` with 5-second TTL),
or migrate to SQLite/Postgres. The code comments already acknowledge this
and recommend PocketBase for multi-worker deployments.

### T1.8 — `_write_users()` full file write on every update (7 call sites)

**File**: `multi_user/identity.py` lines 95-97
**Issue**: Every user update (registration, profile, role, disable, avatar)
writes the entire users dict back to disk.
**At 100x**: 10,000 users → 2-5 MB write per update. Concurrent updates
risk corruption (partially mitigated by threading lock).
**Fix**: Migrate to database, or implement append-only log with periodic
compaction.

### T1.9 — Unbounded list endpoints (no pagination)

| Endpoint | File | Lines | What's unbounded |
|----------|------|-------|------------------|
| `GET /course-units` | `course_units.py` | 186-195 | All course units + N+1 refresh |
| `GET /course-units/catalog` | `router.py` | 389-439 | All units + per-unit completion check |
| `GET /course-units/{id}/roster` | `router.py` | 629-634 | All enrollments + per-student user lookup |
| `GET /assignments/{id}/submissions` | `assignments_router.py` | 400-423 | All submissions + per-submission user lookup |
| `GET /users` | `router.py` | 289 | All users (admin) |
| `GET /knowledge/list` | `knowledge.py` | 1741-1864 | All KBs + per-KB filesystem metadata |
| `GET /notebook/list` | `notebook.py` | 140-152 | All notebooks |
| `GET /instructor/report` | `gradebook.py` | 160-196 | Sequential gradebook build per course |

**Fix**: Add `limit`/`offset` query params to each. For the ones with
per-item async calls, batch or parallelize with `asyncio.gather()`.

### T1.10 — Frontend tables without pagination/virtualization

| Component | File | Lines | What renders |
|-----------|------|-------|--------------|
| StudentDashboard | `components/admin/StudentDashboard.tsx` | 581-715 | All students in one table |
| Gradebook | `admin/.../gradebook/page.tsx` | 122-180 | All students × all assignments |
| ChatMessages | `components/chat/home/ChatMessages.tsx` | 1511-1650 | All messages in session |
| AdminUsers | `admin/users/page.tsx` | 89 | All users |

**At 100x**: 10,000 students → browser freezes rendering 10,000+ DOM nodes.
Gradebook: 10,000 × 50 = 500,000 cells → browser crashes.
**Fix**: Server-side pagination + `react-window` or `@tanstack/virtual`
for virtualized rendering.

### T1.11 — Memory/AI layer sequential processing

| Function | File | Lines | Issue |
|----------|------|-------|-------|
| `process_new_documents()` | `knowledge/add_documents.py` | 268-293 | Sequential per-doc RAG call |
| `_run_update_inner()` | `memory/consolidator/modes/update.py` | 219-264 | Sequential LLM call per chunk |
| `_run_dedup_inner()` | `memory/consolidator/modes/dedup.py` | 114-169 | Full doc sent to LLM per iteration |
| `iter_since()` | `services/memory/trace.py` | 89-112 | Unbounded glob of all trace files |

**Fix**: Batch/parallelize with `asyncio.gather()` + concurrency limits.
For dedup, implement windowed processing. For trace files, add date-based
glob filtering.

---

## Tier 2 — HIGH (Fix Second)

### T2.1 — `list_user_info()` loads all users, no pagination
**File**: `identity.py` lines 211-231. Called by admin dashboard, instructor
dashboard, auth. At 100x: loads 10,000 users every dashboard load.

### T2.2 — `search_enrollable_users()` linear scan with string concat
**File**: `identity.py` lines 234-266. Scans all users, builds search string
per user. At 100x: 10,000 users × 5 fields = 50,000 string ops per search.

### T2.3 — `get_user_info()` anti-pattern
**File**: `services/auth.py` lines 211-216. Calls `list_users()` (loads all)
to find one user by username. Should be O(1) dict lookup.

### T2.4 — `authenticate()` loads all users on every login
**File**: `services/auth.py` lines 434-470. At 100x: 2-5 MB file read per
login attempt.

### T2.5 — SQLite session list with correlated subqueries
**File**: `services/session/sqlite_store.py` lines 1432-1469. 4 correlated
subqueries per session row + LEFT JOIN on messages. At 100x: 100,000
sessions → very slow list endpoint.
**Fix**: Denormalize turn status into sessions table, use window functions.

### T2.6 — KB manifest full directory walk
**File**: `knowledge/manifest.py` lines 111-139, 191-199. `os.walk()` on
every manifest request. At 100x: 100,000 files → slow.
**Fix**: Cache manifest with TTL, or incremental updates.

### T2.7 — Context exploration source processing
**File**: `capabilities/explore_context/explorer.py` lines 441-454. Iterates
all sources even when most will be truncated.
**Fix**: Sort by relevance first, early exit.

### T2.8 — Chat history list (frontend)
**File**: `components/space/ChatHistorySection.tsx` line 49. Hardcoded
limit=200, renders all without pagination UI. Fragile if limit increases.

### T2.9 — Admin users list (frontend)
**File**: `admin/users/page.tsx` line 89. Fetches all users, filters
client-side. At 100x: 10,000 users fetched to find 50.

### T2.10 — Partner list/sessions (no pagination)
**File**: `api/routers/partners.py` lines 409-411, 743-748.

### T2.11 — Missing index on `Submission.submitted_at`
**File**: `models.py` line 230. Used in ORDER BY for latest-submission
queries. At 100x: sort on 10,000+ rows per query.

### T2.12 — Missing index on `CourseBookEntry.course_unit_id`
**File**: `models.py` lines 344-346.

### T2.13 — Missing indexes on `AssignmentAccessGrant` columns
**File**: `models.py` lines 256-259. Unique constraint helps but explicit
indexes are clearer.

---

## Tier 3 — MEDIUM (Fix When Capacity Allows)

| # | Issue | File | Lines |
|---|-------|------|-------|
| M1 | RAG retrieval no top-k enforcement | `services/rag/.../retrievers.py` | 119-151 |
| M2 | Web search no hard result cap | `services/search/__init__.py` | 135 |
| M3 | SQLite migration per-session message processing | `services/session/sqlite_store.py` | 259-272 |
| M4 | Course catalog no pagination (frontend) | `courses/page.tsx` | 30, 150 |
| M5 | Book library no pagination (frontend) | `BookLibrary.tsx` | 112, 275 |
| M6 | Roster editor no pagination (frontend) | `RosterEditor.tsx` | 38, 367 |
| M7 | Admin students overview loads all users | `router.py` | 1179-1330 |
| M8 | Instructor students overview loads all users | `router.py` | 1338-1490 |
| M9 | `save_grant()` linear user lookup | `grants.py` | 100-112 |
| M10 | All relationships use default lazy loading | `models.py` | multiple |
| M11 | Read memory concatenates all L3 docs | `tools/builtin/__init__.py` | 761-768 |
| M12 | Paper search fetch multiplier | `tools/paper_search_tool.py` | 17-18 |

---

## Tier 4 — LOW (Note for Future)

| # | Issue | File |
|---|-------|------|
| L1 | Grant storage: 10,000+ files in single dir | `grants.py` |
| L2 | Avatar storage: 30,000+ files in single dir | `identity.py` |
| L3 | Assignment lists no pagination (typically <100) | admin/student pages |
| L4 | Course units list no pagination (typically <100) | admin page |
| L5 | Course materials list no pagination (typically <100) | admin page |
| L6 | Feedback list (has limit=200) | admin page |
| L7 | Knowledge bases list (typically <50) | lib/knowledge-api.ts |
| L8 | Skills list (typically <100) | lib/skills-api.ts |
| L9 | Notebooks list (typically <100) | lib/notebook-api.ts |
| L10 | Default lazy loading on all relationships | models.py |
| L11 | Paper search fetch multiplier (capped at 30) | paper_search_tool.py |
| L12 | Chat history limit=200 (mitigated but fragile) | ChatHistorySection.tsx |

---

## Recommended Fix Order

### Phase 1 — Quick wins (1-2 days, highest impact/effort ratio)

1. **Replace `get_user_by_id()` loops with `get_users_by_ids()`** — 7
   locations, the batch function already exists. Each is a 5-line change.
   Eliminates 7 of the CRITICAL findings.

2. **Add missing DB indexes** — One migration adding 6 indexes:
   - `submissions (assignment_id, user_id)` composite
   - `enrollments (course_unit_id)` 
   - `enrollments (user_id)`
   - `notifications (course_unit_id)`
   - `notification_reads (notification_id)`
   - `notification_reads (user_id)`
   - `submissions (submitted_at)`

3. **Fix `list_notifications_for_user()` N+1** — Batch the enrollment check
   into one query.

### Phase 2 — Medium effort (3-5 days)

4. **Replace `session.refresh()` loops with `selectinload()`** — 3
   locations in `course_units.py`.

5. **Add pagination to the 8 unbounded list endpoints** — `limit`/`offset`
   params + frontend pagination controls.

6. **Add `asyncio.gather()` to instructor report** — Parallelize the
   sequential gradebook builds.

7. **Fix `get_user_info()` anti-pattern** — Direct dict lookup instead of
   loading all users.

### Phase 3 — Larger effort (1-2 weeks)

8. **Add in-memory cache for `load_users()`** — TTL-based cache to avoid
   re-reading the file on every call. Or migrate to SQLite/Postgres.

9. **Add frontend virtualization** — `react-window` or `@tanstack/virtual`
   for StudentDashboard, Gradebook, ChatMessages tables.

10. **Batch/parallelize memory consolidation** — `asyncio.gather()` with
    concurrency limits for chunk processing.

### Phase 4 — Architectural (longer term)

11. **Migrate identity store from JSON to database** — Eliminates the root
    cause of ~10 CRITICAL findings. The code comments already recommend
    PocketBase for this.

12. **Add directory sharding for grants/avatars** — Shard by user_id prefix
    to avoid 10,000+ files in one directory.

13. **Implement KB manifest caching** — Cache with TTL or incremental
    updates instead of full `os.walk()`.

---

## What's Already Well-Optimized

These were checked and found to have proper limits/batching:

- `GET /admin/students/overview` — batched SQL queries (issue #33)
- `GET /instructor/students/overview` — batched SQL queries (issue #34)
- `GET /sessions` — has pagination (limit=50, max=200)
- `GET /memory/trace/{surface}` — has pagination (limit=200, max=1000)
- `GET /memory/snapshot/{surface}/changes` — has pagination
- `GET /partners/recent` — has limit parameter
- `GET /partners/{partner_id}/history` — has limit parameter
- `build_gradebook()` — batched queries (issue #31, just fixed)
- `check_and_mark_completion_batch()` — batched (issue #31, just fixed)
- `get_users_by_ids()` — batched (issue #31, just added)
- `get_latest_submissions_batch()` — batched (issue #31, just added)
