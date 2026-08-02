# Feature round 2 — course-management gaps found during live UI testing

**How this round works, same discipline as the database migration** (see
`DATABASE_MIGRATION_PLAN.md` for the precedent): two disjoint tracks, cut from
`main` at commit `1cd9c7c`, zero file overlap by design, coordinate only
through `DEVIN_LOG.md` (append-only), **Claude does not implement any of this
round** — Claude's role this round is planning (this doc), then merging both
branches and running a full regression pass at the end, same as Phase G did
for the database migration.

**Branches** (create from `main`, cut from `1cd9c7c`):
- `feature-course-mgmt-cascade` — Track A
- `feature-course-mgmt-devin` — Track B

**Source**: a full live UI walkthrough (2 instructors, 6 students, 4 courses)
surfaced 17 product notes/questions from the repo owner. A read-only code
audit (cited inline below, `file:line`) sorted them into: already works,
confirmed gap, or explicitly out of scope for this round. Don't re-derive
current behavior — the citations below are current as of `1cd9c7c`.

---

## Already works — no action needed this round

Confirmed by the audit, listed here only so nobody re-implements them:

- **Retake limits already support "twice for minor, once for major."**
  `Assignment.attempt_limit` is a free integer per assignment
  (`deeptutor/services/db/models.py`, `Assignment` class). An instructor can
  already set `1` for a major exam and `2`+ for a minor quiz today — this is
  an instructor-awareness gap, not a code gap. (If Track A wants to add a
  short inline hint in the assignment-creation form explaining this, fine,
  but it's optional polish, not required.)
- **Notes curation already works.** `course_books.py` + `book_access_router.py`
  already support assign/publish/unpublish of an instructor's own Book as a
  course unit's notes.
- **Grades are already read-only to students at the API level.** No
  PUT/PATCH exists on `Submission` anywhere in `assignments_router.py`.
- **Students never see "+ New assignment."** Confirmed: that button only
  exists in the separate admin/instructor page component; the student-facing
  assignments page contains no such element, even in the code. (What was
  observed during testing was an *unauthorized instructor* hitting it during
  a deliberate security test — different account type. See Track A's item
  below for the one real, smaller bug this surfaced.)
- **Instructor access revocation already works.** The moment an instructor is
  removed from `instructor_ids`, their very next request is denied —
  `is_instructor_of()` queries live, no stale caching. (There's just no
  *transfer/handoff* affordance — see Track B.)

---

## Explicitly out of scope this round (bigger, separate efforts)

Flagging these so they aren't silently dropped, but they don't belong in a
quick two-track round:

- **AI-assisted question generation scoped to an instructor's actual taught
  content, and a final exam curated the same way.** Confirmed: Assignment
  question generation doesn't exist at all yet — 100% instructor-typed
  (`ARCHITECTURE_AND_COMPLETED_WORK.md` §2.3 confirms this was deliberately
  deferred, still true). Building this well means designing how it pulls
  from a course's knowledge base/notes, which is a real scoping
  conversation on its own — worth its own round once this one lands.
- **Knowledge Base / Book upload quotas and retention policy.** Confirmed:
  the only upload limits that exist (`system.json`'s attachment limits) are
  scoped to chat-message attachments, not KB/Book documents at all. This
  touches upstream DeepTutor's document-extraction/knowledge subsystem, a
  different surface than the multi-user course layer — separate round.

---

## Track A (Cascade) — Assignment lifecycle & integrity

**Files owned**: `deeptutor/multi_user/assignments.py`,
`deeptutor/multi_user/assignments_router.py`,
`web/app/(admin)/admin/course-units/[courseUnitId]/assignments/page.tsx`,
`web/app/(utility)/courses/[courseUnitId]/assignments/page.tsx`.

**Shared file** — `deeptutor/services/db/models.py`: only add new columns to
the existing `Assignment` class, and (if needed for per-student overrides) a
new small table. Don't touch the `CourseUnit` class — that's Track B's.
Keep additions purely additive (new nullable columns/new table) so a merge
with Track B's own additions to the same file has the best chance of
resolving cleanly; if it doesn't, Claude resolves it at merge time the same
way the `DEVIN_LOG.md` conflict was resolved last round — not your problem
to avoid perfectly, just to minimize.

### A1. Un-publish an assignment
**Gap confirmed**: `publish_assignment()` (`assignments.py`) is one-way —
there's no reverse function, no `/unpublish` route. Compare to
`course_books.py`'s book publish/unpublish, which already has both
directions — mirror that pattern.
**Build**: a `POST /assignments/{id}/unpublish` endpoint reverting
`status` to `draft`, symmetric access control to `publish`. Decide (and
document your decision in the log) what happens to existing submissions
when an already-published, already-submitted-to assignment gets
unpublished — the two reasonable options are (a) submissions stay, just no
new ones allowed while in draft, or (b) block unpublishing entirely once
≥1 real submission exists. Pick one, don't leave it undefined.

### A2. `due_at` enforcement
**Gap confirmed**: `Assignment.due_at` is `Mapped[str]`, explicitly comment-
marked as loose TEXT with **zero enforcement anywhere** — the submit
endpoint never compares it to current time.
**Build**: make `submit_assignment_endpoint` actually reject a submission
past `due_at` (400, clear message), *unless* a per-student override grants
extended access (see A3). Keep `due_at` as the existing free-ish string
field if that's simplest, or tighten it to a real parseable timestamp if
that's cleaner — your call, just be consistent between what the instructor
enters and what gets compared.

### A3. Per-student exception / emergency access
**Gap confirmed**: no override mechanism exists — `attempt_limit`/`due_at`
apply identically to every student, no per-student table.
**Build**: a small new table (e.g. `AssignmentAccessGrant`: `assignment_id`,
`user_id`, `extra_attempts` nullable int, `extended_due_at` nullable
timestamp, granted_by, granted_at) an instructor can create for one student
at a time from the assignment's management view — this is what answers the
repo owner's "what if a student has an emergency" question. Submit-flow
checks this grant in addition to the assignment's own limits.

### A4. Pre-assignment briefing screen + optional timer
**New feature, confirmed nothing like it exists.**
**Build**: before a student's answer form loads, show a screen with the
assignment's title/description, estimated time, weight/contribution to
the grade, and an explicit "Start assignment" button — nothing loads until
clicked. For "major" assignments (add a boolean `is_timed` +
`time_limit_minutes` on `Assignment`), start a countdown on click; when it
hits zero, auto-submit whatever's currently filled in exactly like a
manual submit (reuse the same submit path, don't fork it). Non-timed
assignments just get the briefing screen with no clock.

### A5. Submission confirmation / receipt
**Gap confirmed**: submit → "Submitting…" → the graded result renders
inline, no separate "your submission was recorded" receipt state before
that. Small: insert an explicit brief confirmation (even just a toast or a
one-line "Submitted." moment) so a student isn't left wondering whether it
"took" during the grading wait, especially for AI-Judge questions where
grading can take a few seconds.

### A6. Small polish (bundle into this track, low effort)
- Fix the "1 questions" pluralization bug on assignment list rows.
- Hide the "New assignment" create button (and block the dialog opening)
  for an instructor viewing a course they don't manage — right now the
  page-level guard blocks the *page*, but the button/dialog inside it
  isn't gated the same way, confirmed via a live security test (the actual
  `POST` is still correctly rejected server-side, so this is UI polish, not
  a real privilege gap — but it's a confusing dead-end worth closing).
- Unify the error copy: `assignments_router.py`'s blocked-instructor case
  currently says "You are not enrolled in this course unit" (copy written
  for the student case) — match the gradebook page's "You do not manage
  this course unit" instead.

---

## Track B (Devin) — Course lifecycle, enrollment & reporting

**Files owned**: `deeptutor/multi_user/course_units.py`,
`deeptutor/multi_user/router.py`, `deeptutor/multi_user/gradebook.py`,
`deeptutor/multi_user/identity.py` (only the `delete_user()` function),
`web/app/(admin)/admin/course-units/page.tsx`,
`web/app/(utility)/courses/page.tsx`.

**Shared file** — `deeptutor/services/db/models.py`: only add new columns to
the existing `CourseUnit` class. Don't touch the `Assignment` class — that's
Track A's.

### B1. Course start/end dates, visible to students, access blocked after end
**Gap confirmed**: `CourseUnit` has no date fields beyond a free-text
`term` and `created_at` — nothing blocks access after any notion of
"semester end" because that notion doesn't exist in the schema at all.
**Build**: add nullable `start_date`/`end_date` to `CourseUnit`. Show both
on the student catalog/my-courses views. Decide and implement a grace
period after `end_date` (the repo owner suggested ~1 week) rather than an
instant hard cutoff — make the grace period a named constant, not a magic
number buried in an if-statement, so it's easy to tune later. After the
grace period, block assignment-taking/notes-reading for students but let
the instructor and admin keep viewing everything (gradebook, roster) —
archival access should never disappear for the people who need the record.

### B2. Student-initiated leave/unenroll
**Gap confirmed**: only `DELETE .../enrollments/{user_id}`
(`require_instructor_or_admin`-gated) exists — no student-callable path at
all, only join-requests exist in that direction.
**Build**: mirror the existing enrollment-*request* pattern but for
leaving — a student calls something like
`POST .../enrollments/leave-requests`, the instructor sees it alongside
their existing pending-requests UI and confirms it (don't auto-remove on
request alone — the repo owner's note was explicit that the instructor
confirms). On confirmation: remove the `Enrollment` row (they stop
appearing on the active roster and can't see/take new assignments), but do
**not** delete their existing `Submission` rows — those stay for grading
history/audit integrity. Log this decision explicitly in `DEVIN_LOG.md`
since "how much history survives a leave" is a judgment call, not
something to silently decide.

### B3. Cross-course / per-instructor compiled report
**Gap confirmed**: `build_gradebook()` takes exactly one `course_unit_id`,
no aggregation across units exists anywhere.
**Build**: a new function (e.g. `build_instructor_report(instructor_id,
term=None)`) that compiles gradebook data across every course unit that
instructor teaches, optionally filtered by `term`. Reuse `build_gradebook`
internally per unit rather than re-deriving the aggregation logic — don't
duplicate the weighted-average math. New endpoint + a simple report view
alongside the existing gradebook page. This directly answers the repo
owner's "final report per module or compiled across a term" ask.

### B4. Instructor self-service course creation
**Gap confirmed**: `POST /course-units` is admin-only
(`router.py`) — an instructor cannot create their own course today.
**Build**: allow `require_instructor_or_admin` on that endpoint instead of
admin-only, with the creating instructor automatically included in
`instructor_ids` (an instructor shouldn't be able to create a course and
assign it to someone *else* without also being on it themselves — admin
keeps the ability to create for/assign anyone). Frontend: give instructors
a "New course unit" entry point on their own Course Units page (currently
absent by design, per the audit — now intentionally being added).

### B5. User-deletion cascade cleanup
**Gap confirmed**: `delete_user()` in `identity.py` only removes the
account from the flat JSON user store — `Enrollment`/`Submission` rows in
Postgres have **no FK to any user table on purpose** (this is documented
in `models.py` as a known, deliberate gap from the migration, not new).
Deleting a user today leaves those rows pointing at a now-nonexistent
`user_id` forever.
**Build**: when `delete_user()` runs, also explicitly sweep that user's
`Enrollment` and `Submission` rows (call into `course_units.py`/
`assignments.py`'s existing delete-by-user-id logic if any exists, or add
narrowly-scoped delete queries — don't add a new FK/cascade at the DB
level, this stays an application-level sweep to match how the rest of this
subsystem already works). This is the one item here closest to a real bug
rather than a feature gap — prioritize it if time is short.

### B6. Small polish (bundle into this track, low effort)
- Fix the delete-course-unit confirmation dialog's copy — it currently
  says deleting "removes '<name>' and its enrollments," but it actually
  also cascades assignments/submissions/course-book links. Update the copy
  to say so, so nobody's surprised by the actual scope of a delete.
- Instructor-reassignment UX: revocation itself already works (see "Already
  works" above) — this is just adding a small "previously taught by" note
  or similar so an admin reassigning a course isn't flying blind about who
  used to own it. Optional, low priority, skip if time is tight.

---

## Coordination rules (same as last round)

- Log start and completion in `DEVIN_LOG.md`, same entry format as before —
  what changed, how you verified it live (real accounts, not just unit-level
  reasoning), what you're handing back unfinished and why.
- Don't touch the other track's owned files. If you think you need to, stop
  and log the conflict instead of guessing — Claude will resolve it.
- Any judgment call flagged above ("decide and document," "your call") needs
  an explicit sentence in your log entry saying what you chose and why —
  don't leave it implicit in the diff.
- When both tracks report done, Claude merges both branches into an
  integration branch, runs a full regression pass (existing
  `EDGE_CASE_TESTING.md` cases plus new cases for everything built this
  round), reports results, and — per standing instruction — does not push
  to origin until the repo owner explicitly says so.
