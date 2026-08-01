# Edge-case testing — multi-user / course-unit subsystem

TODO.md item 17. Built from a read-only code inventory (routers: `course_units.py`,
`assignments_router.py`, `book_access_router.py`, `gradebook.py`) crossed against four angles —
cascade/lifecycle, concurrency, role×ownership boundaries, degenerate/empty state — rather than
an ad-hoc guess list, so coverage is traceable back to the actual endpoints rather than to
whatever came to mind.

**How to use this file**: one row per case. Fill in Actual/Status/Notes as each case is run.
Never delete a row — if a case turns out not to apply, mark it N/A with why, don't remove it.
This is the append-only record of what's actually been checked, for both Claude and Devin.

**Status legend**: ✅ pass · 🐛 bug (see Notes + link to fix if one lands) · ⚠️ known limitation
(deliberately not fixing, reasoned in Notes) · ⏳ not yet run · 🚫 N/A

---

## Cascade / lifecycle

| ID | Setup | Action | Expected | Actual | Status |
|---|---|---|---|---|---|
| C1 | Course unit with a published assignment + ≥1 submission | Delete the course unit (admin) | Either a clean cascade delete of assignments/submissions, or the delete is blocked with a clear error — not a silent orphan | | ⏳ |
| C2 | Course unit with a published Book assigned as notes | Delete the course unit | Same as C1 — no orphaned book-index entry left pointing at a dead unit | | ⏳ |
| C3 | Course unit with a pending enrollment request | Admin edits the unit's `instructor_ids` to remove all instructors | Determine who (if anyone) can still see/act on the pending request afterward | | ⏳ |
| C4 | Student's enrollment request rejected | Same student requests the same unit again | Clean second `pending` request, no leftover `rejected` artifact affecting state | | ⏳ |

## Concurrency

| ID | Setup | Action | Expected | Actual | Status |
|---|---|---|---|---|---|
| K1 | Published assignment, `attempt_limit=1` | Fire two submit requests for the same student at nearly the same time | Exactly one submission recorded, second rejected — not two | | ⏳ |
| K2 | Student has a pending enrollment request | Instructor clicks direct-enroll at the same time the student's request would be auto-processed | Ends in `approved`, not a broken intermediate state | | ⏳ |

## Role × ownership boundaries

| ID | Setup | Action | Expected | Actual | Status |
|---|---|---|---|---|---|
| R1 | Instructor A owns unit A; unrelated unit B exists | Instructor A calls unit B's assignments/gradebook/roster/notes endpoints directly (not just via UI) | 403 on every one | | ⏳ |
| R2 | Student not enrolled in unit X | Student calls unit X's assignment-detail, submit, and notes-content endpoints directly | 403 (not enrolled) on every one, even if the resource id is guessed correctly | | ⏳ |
| R3 | Student enrolled in unit X, assignment in unit X is still `draft` | Student requests the assignment detail directly by id | 404 (draft assignments invisible to students, not just filtered from the list) | | ⏳ |

## Degenerate / empty state

| ID | Setup | Action | Expected | Actual | Status |
|---|---|---|---|---|---|
| E1 | Freshly created student, zero enrollments | Load Browse Courses, then try any course-scoped page | Clean empty states, no crash, no leaked data from other units | | ⏳ |
| E2 | Course unit with zero assignments | Instructor opens gradebook, exports CSV | Empty table / empty CSV with correct headers, not an error | | ⏳ |
| E3 | Assignment submission where the AI-Judge call fails/times out | Submit a free-text answer while forcing a judge failure | Determine: does it consume an attempt with no usable result, or fail without consuming one? | | ⏳ |

## Confirm-not-break (defensive behavior already found in code, verify it holds live)

| ID | Setup | Action | Expected | Actual | Status |
|---|---|---|---|---|---|
| D1 | Published assignment | Instructor attempts to edit its questions | 400 "Cannot edit questions on a published assignment" | | ⏳ |
| D2 | Book assigned to a course unit's notes, then deleted from the instructor's own library | Student (or instructor) loads the notes list/content | Clean 404 / silent skip, not a 500 | | ⏳ |

---

## Findings log

(Narrative notes on anything surprising, plus fixes applied — newest first.)
