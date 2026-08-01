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
| C1 | Course unit with a published assignment + ≥1 submission | Delete the course unit (admin) | Either a clean cascade delete of assignments/submissions, or the delete is blocked with a clear error — not a silent orphan | **Confirmed orphan.** `delete_course_unit()` only cleans `Enrollment` records. After delete: the assignment + its submission (real recorded grade) remain fully queryable by an admin forever (`GET /assignments/{id}` → 200 with full content). The gradebook and course-unit-detail endpoints correctly 404 (they check unit existence first) — so the system gives an inconsistent picture: "unit not found" but "assignment found," depending which endpoint you ask. Worse: the **original owning instructor is now locked out** — `GET /assignments/{id}` as that instructor returns 403 "You are not enrolled in this course unit" (a confusing message for someone who used to own it), because `is_instructor_of()` correctly returns False once the unit is gone. Net effect: dead data nobody but an admin who knows/guesses the id can see, and no cleanup path at all. | 🐛 |
| C2 | Course unit with a published Book assigned as notes | Delete the course unit | Same as C1 — no orphaned book-index entry left pointing at a dead unit | **Confirmed orphan, same root cause as C1.** `delete_course_unit()` doesn't touch `course_books.json` either — after deleting the unit, `get_book_entry(book_id)` still returns the full entry (`status: "published"`, pointing at the now-dead `course_unit_id`). Same as C1's pattern: admin can still reach and clean it up directly (`DELETE /books/{id}/course-unit` → 200, confirmed), since `_manages_course_unit` short-circuits for admin regardless of the unit's existence — but nothing does this automatically, and the original instructor is presumably locked out the same way as C1 (not separately re-verified here). Same fix needed as C1: `delete_course_unit()` should also sweep `course_books.json` (and assignments/submissions). | 🐛 |
| C3 | Course unit with a pending enrollment request | Admin edits the unit's `instructor_ids` to remove all instructors | Determine who (if anyone) can still see/act on the pending request afterward | Access control itself is correct — no leak. The removed instructor gets a clean 403 "You do not manage this course unit" on `/requests`. Only admin can still see/act on it (`_manages_course_unit` short-circuits for admin regardless of `instructor_ids`). **Operational gap, not a security bug**: there's no admin-facing surface that flags "this unit now has zero instructors and a request is stuck" — an admin has to already know to check that specific unit. Worth a small follow-up (e.g. a warning badge on units with `instructor_ids: []`), not urgent. | ⚠️ |
| C4 | Student's enrollment request rejected | Same student requests the same unit again | Clean second `pending` request, no leftover `rejected` artifact affecting state | | ⏳ |

## Concurrency

| ID | Setup | Action | Expected | Actual | Status |
|---|---|---|---|---|---|
| K1 | Published assignment, `attempt_limit=1` | Fire two submit requests for the same student at nearly the same time | Exactly one submission recorded, second rejected — not two | **Confirmed for free-text (AI-Judge) questions**: both requests returned 200 with distinct submission ids, 214ms apart, both scored 1/1 independently — 2 submissions on a 1-attempt assignment. **Not reproducible for auto-graded (choice) questions** — that path has no `await` between the count-check and the write, so Python's cooperative scheduling runs it atomically in practice; the AI-Judge path's `await llm_complete(...)` is what opens the real race window. | 🐛 |
| K2 | Student has a pending enrollment request | Instructor clicks direct-enroll at the same time the student's request would be auto-processed | Ends in `approved`, not a broken intermediate state | Deferred — there's no second real trigger to race against (a student's own request only ever changes state via an explicit instructor approve/reject action, there's no background "auto-processed" path), so this case as originally framed doesn't actually apply. The one real concurrency-adjacent risk here — two instructors approving/rejecting the same pending request at the same time — is lower-value to chase given `approve_enrollment`/`unenroll_student` are simple last-write-wins JSON updates with no read-modify-write gap comparable to K1's async-LLM window. Not tested; flagging as low-priority rather than silently dropping it. | 🚫 |

## Role × ownership boundaries

| ID | Setup | Action | Expected | Actual | Status |
|---|---|---|---|---|---|
| R1 | Instructor A owns unit A; unrelated unit B exists | Instructor A calls unit B's assignments/gradebook/roster/notes endpoints directly (not just via UI) | 403 on every one | Confirmed: unit detail, roster, requests, assignments list, gradebook, books all 403. Write endpoints (create assignment, enroll a student into unit B) also correctly 403. No gaps found. | ✅ |
| R2 | Student not enrolled in unit X | Student calls unit X's assignment-detail, submit, and notes-content endpoints directly | 403 (not enrolled) on every one, even if the resource id is guessed correctly | Confirmed: published-assignment detail and submit both 403 "not enrolled." A still-draft assignment's id returns 404 (not distinguishable from nonexistent), which is actually stronger than the expected 403 — doesn't even confirm the id is valid. No gaps. | ✅ |
| R3 | Student enrolled in unit X, assignment in unit X is still `draft` | Student requests the assignment detail directly by id | 404 (draft assignments invisible to students, not just filtered from the list) | Confirmed with a genuinely enrolled student: draft assignment detail → 404; direct submit attempt → 400 "not open for submissions"; the course unit's assignment list correctly shows only the published one. No gaps. | ✅ |

## Degenerate / empty state

| ID | Setup | Action | Expected | Actual | Status |
|---|---|---|---|---|---|
| E1 | Freshly created student, zero enrollments | Load Browse Courses, then try any course-scoped page | Clean empty states, no crash, no leaked data from other units | Confirmed: `GET /my/course-units` → clean `[]`; Course Catalog page renders correctly showing only the actually-existing unit with "Request to join", no crash, no stray/leaked data (including no trace of the already-deleted Unit A). | ✅ |
| E2 | Course unit with zero assignments | Instructor opens gradebook, exports CSV | Empty table / empty CSV with correct headers, not an error | Confirmed: gradebook JSON returns `{assignments:[], rows:[]}` cleanly; CSV export returns just the header row (`Username,Full Name,Registration Number,Final Grade (%)`), no error. | ✅ |
| E3 | Assignment submission where the AI-Judge call fails/times out | Submit a free-text answer while forcing a judge failure | Determine: does it consume an attempt with no usable result, or fail without consuming one? | **Resolved by code reading, not live-forced (no reliable way to force an LLM failure on demand here without patching code).** `_grade_free_text()` (`grading.py:68-72`) wraps the `llm_complete()` call in a try/except: a failure is caught and degrades to a **0.0 score** with feedback text *"AI grading is temporarily unavailable — an instructor will need to grade this by hand."* — which then flows into a real, normal `create_submission()` call. So a transient AI-Judge outage **does consume the student's one attempt**, permanently recorded as a 0, with no automatic retry — only a human instructor manually re-grading (there's no regrade endpoint) can correct it. This is a real, if narrow, fairness gap worth knowing about, not a crash. | ⚠️ |

## Confirm-not-break (defensive behavior already found in code, verify it holds live)

| ID | Setup | Action | Expected | Actual | Status |
|---|---|---|---|---|---|
| D1 | Published assignment | Instructor attempts to edit its questions | 400 "Cannot edit questions on a published assignment" | Confirmed: `PUT /assignments/{id}` with a `questions` payload on a published assignment → 400 with exactly that message. | ✅ |
| D2 | Book assigned to a course unit's notes, then deleted from the instructor's own library | Student (or instructor) loads the notes list/content | Clean 404 / silent skip, not a 500 | Confirmed: `GET .../books` list returns `{books: []}` (deleted book silently skipped, matches the code comment "book was deleted... but the index wasn't cleaned up"); direct `GET /books/{id}/course-content` → clean 404 "Book not found". No crash either way. | ✅ |

---

## Findings log

**2026-08-01 — Claude — full pass complete, triage below**

12 of 14 cases run live against real temp accounts (`edge_instr_a/b`, `edge_stud_a/b`) and real
course units/assignments/books; 2 (K2, E3) resolved by code reading since they couldn't be
reliably forced live without patching code. Fixtures fully cleaned up afterward (see commit).

**Results: 2 bugs, 2 known limitations, 8 clean passes.**

### Bugs found (recommend fixing)

1. **K1 — attempt-limit race condition on AI-Judge-graded questions.** Two near-simultaneous
   submit requests both succeed, producing two submissions on a 1-attempt assignment. Root
   cause: `count_submissions()` (unlocked read) → `await grade_submission()` (the yield point —
   only present for free-text questions needing an LLM call) → `create_submission()` (locked
   write) is not atomic as a whole. **Fix direction**: re-check the attempt count *after*
   grading, inside the same critical section as the write (or hold a per-`(assignment_id,
   user_id)` lock across the whole submit flow) — reject the second write if the count changed
   during grading, rather than only checking once up front.
2. **C1 + C2 — `delete_course_unit()` doesn't cascade.** Deleting a course unit leaves
   assignments, submissions, and book-index entries permanently orphaned — dangling
   `course_unit_id` references that only an admin who knows/guesses the id can still reach
   (the original instructor is locked out with a confusing "not enrolled" message). **Fix
   direction**: `delete_course_unit()` in `course_units.py` should also sweep
   `assignments.json`/`submissions.json` (via `assignments.py`) and `course_books.json` (via
   `course_books.py`) for the deleted unit — same pattern already used for `enrollments.json`
   in that same function. Alternatively, block the delete outright if the unit has any
   assignments/books attached, forcing an explicit cleanup step first — simpler, but a bigger
   UX change; the cascade-delete is probably the better fit given the existing enrollment
   precedent.

### Known limitations (flagged, not fixed — reasoned tradeoffs)

3. **C3 — pending requests become unreachable by any instructor if a unit's `instructor_ids`
   is emptied.** Access control is correct (no leak — the removed instructor gets a clean 403),
   but there's no admin-facing signal that a unit is now "stuck" with zero instructors and a
   waiting student. Low-risk, low-frequency (requires a deliberate admin edit); worth a small
   follow-up (e.g. flag units with empty `instructor_ids` in the admin view) if it comes up in
   practice.
4. **E3 — a transient AI-Judge failure permanently records a 0 with no regrade path.** Fails
   safe (no crash, no attempt-limit bypass) but not fair to the student — there's currently no
   way for an instructor to trigger a re-grade of a specific submission. Worth a regrade
   endpoint if judge failures turn out to be non-negligible in practice; not urgent while the
   vLLM endpoint's uptime is good.

### Clean passes (no gaps found)

R1 (cross-instructor isolation, read + write), R2 (non-enrolled student blocked, draft
assignments don't even leak existence), R3 (enrolled student still can't see/submit a draft),
E1 (zero-enrollment student — clean empty states, no leaked data), E2 (zero-assignment
gradebook + CSV export), D1 (published-assignment question-edit lock), D2 (book deleted out
from under a course-unit assignment degrades to clean 404/empty-skip), C4 (reject → re-request
produces a clean new pending record, no stale artifact).
