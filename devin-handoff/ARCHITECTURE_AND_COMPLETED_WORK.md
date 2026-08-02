# Architecture and Completed Work

Audience: a senior engineer picking up this fork cold. Assumes you can read Python/TypeScript
and will go read the actual files — this document tells you *where* to look and *why* things
are shaped the way they are, not what every line does.

## 0. What this deployment is

A fork of [HKUDS/DeepTutor](https://github.com/HKUDS/DeepTutor) (upstream: an "agent-native"
AI tutoring platform — FastAPI backend, Next.js 16 frontend, a shared agentic tool-calling
loop underneath every chat-like capability) repurposed into a multi-teacher research/teaching
platform for Data Science and Bioinformatics courses at ACE (BigDataClass-ACE). Self-hosted,
backed by a local vLLM server (`Meta-Llama-3.3-70B-Instruct-AWQ-INT4`) over the institution's
VPN, `docker compose` deployment (`docker-compose.yml`, production target — NOT
`docker-compose.dev.yml`, see the README in this folder).

Everything upstream provides (Chat, Partners, My Agents, Co-Writer, Book, Knowledge Center,
Learning Space, Memory, Settings, multi-engine RAG, CLI) is intact and unmodified except where
noted below. Original repo-root `README.md` is still the untouched upstream README — **it does
not describe any of the work in this document and is scheduled for a rewrite** (see `TODO.md`).
`COURSE_INTEGRATION_BRIEF.md` at repo root is the original scoping brief this fork of work
started from; it predates most of what's actually built and is now stale in places (kept for
historical context, not as a current source of truth).

## 1. Role model

Upstream DeepTutor has a binary role: `admin` / `user`. This deployment needed a middle tier —
~10 instructors across different subjects, each managing their own students and materials
without seeing anyone else's.

- `Role` widened to a 3-value literal (`admin` / `instructor` / `user`) —
  `deeptutor/multi_user/models.py`, propagated through all validation sets in
  `deeptutor/multi_user/identity.py` and `SetRoleRequest` in `deeptutor/api/routers/auth.py`.
- `deeptutor/multi_user/context.py` exposes `get_current_user()` — a ContextVar-backed
  accessor resolving `CurrentUser.role` from the JWT payload. This is available at every layer
  down to prompt assembly (`deeptutor/services/session/turn_runtime.py` reads it at the same
  point personas get resolved) — if you need role-aware behavior anywhere in a request's
  lifecycle, this is already in scope, don't thread a new parameter through.
- New `require_instructor_or_admin` auth dependency alongside the existing `require_admin`.
- **Frontend gating** (`web/components/sidebar/SidebarShell.tsx`): `NavEntry.roles?:
  ("admin"|"instructor"|"user")[]`. Omit the field → visible to everyone (including
  auth-disabled solo deployments and the brief pre-resolve loading window — both fail open to
  "show everything," matching pre-existing `AdminLink`/`CoursesLink` behavior). Filtered via
  `useAuthStatus()` before either the collapsed or expanded render path maps over
  `PRIMARY_NAV`/`SECONDARY_NAV`.
- **Route-level enforcement**: `web/components/auth/RoleGuard.tsx` — generic wrapper,
  `<RoleGuard allow={["admin"]}>{children}</RoleGuard>`, redirects away if the resolved role
  isn't in `allow` (fails open the same way as the nav filter while role is unresolved). Used
  on Settings' layout, Knowledge Center, and My Agents pages — so hiding the nav link isn't the
  only thing standing between a curious user and a direct URL hit.

**Current permission matrix** (deliberately confirmed with the product owner, not guessed):

| Surface | Admin | Instructor | Student |
|---|---|---|---|
| Chat / Mastery Path / Quiz / Book / Co-Writer | ✅ | ✅ | ✅ |
| Memory | ✅ | ✅ | ✅ |
| My Agents (`/agents`) | ✅ | ✅ | ❌ |
| Knowledge Center | ✅ | ❌ | ❌ |
| Settings | ✅ | ❌ | ❌ |
| Course Units management | all units | own units only | — |
| `/admin/users` (role changes, full roster) | ✅ | ❌ | ❌ |
| `/admin/feedback` (response-rating review) | ✅ | ❌ | ❌ |

**Known gap, not yet closed**: Knowledge Center's mutating endpoints
(`deeptutor/api/routers/knowledge.py` — create/delete KB, reindex, connect-LightRAG) have **no
confirmed server-side role check**. The frontend hides the UI; a technically-inclined
non-admin hitting the API directly is not currently blocked. Left alone deliberately — these
endpoints appear to be shared with legitimate per-user KB creation (`source: "admin"` vs
`"user"` ownership tagging exists), and a blind `require_admin` risked breaking that without
investigating the ownership model first. **If you pick this up, start by reading how
`source` is set and checked in `knowledge.py` before adding any gate.**

## 2. Course Units, Enrollment, Assignments, Gradebook — the core new subsystem

### 2.1 Data model and storage pattern

New JSON-file storage under `data/system/` (**not** SQLite — matches the existing pattern in
`deeptutor/multi_user/identity.py` / `grants.py`, one JSON file per record collection, no ORM
in this codebase for system-level multi-user data):

- **`deeptutor/multi_user/course_units.py`** — `CourseUnit` (many-to-many instructor ids —
  modeled as a list from day one even though v1 mostly has one instructor per unit, because
  co-instructors/TAs was a known near-term ask) and `Enrollment` (many-to-many student↔unit,
  `status: "pending"|"approved"`, defaulting existing records to `"approved"` when the field
  was added so nothing already-enrolled silently lost access).
- **`deeptutor/multi_user/assignments.py`** — `Assignment` (belongs to a `CourseUnit`, fixed
  question set locked at publish time, `weight` for gradebook aggregation, optional attempt
  limit) and `Submission` (one per student×assignment, stores answers + per-question score +
  final result). Questions use the **exact same field shape as `QuizPair`** (the existing
  Quiz/`deep_question` capability's question type) deliberately — see §2.3.
- **`deeptutor/multi_user/course_books.py`** — the odd one out, see §2.4 for why it can't
  follow the simple pattern above.

### 2.2 Access control pattern (reused everywhere in this subsystem)

Every new router (`deeptutor/multi_user/router.py`, `assignments_router.py`,
`book_access_router.py`) follows the same shape:

- `is_instructor_of(user_id, course_unit_id)` / `_manages_course_unit(...)` — instructor owns
  the unit (or admin, unconditionally).
- `is_approved_student_of(user_id, course_unit_id)` — enrollment exists with
  `status == "approved"`.
- Every mutating/read endpoint is gated by one of these two checks, called explicitly per
  endpoint (no middleware/decorator magic) — this is intentional in this codebase's style;
  follow it rather than introducing a decorator-based auth layer.
- **This is the single most important pattern to reuse** if you add anything new that's
  course-unit-scoped. Don't reinvent a permission check; import and call the existing
  predicate.

### 2.3 Assignments reuse Quiz's grading machinery, don't duplicate it

`deeptutor/multi_user/grading.py` imports `_JUDGE_SYSTEM_PROMPTS` and
`_build_judge_user_prompt` directly from `deeptutor/api/routers/quiz_judge.py` (previously
private to that module — investigate before assuming these are stable public API if the
upstream Quiz code changes) and calls them via `llm_complete()` (a headless, non-streaming
completion — the original AI Judge is normally invoked over a live WebSocket, which doesn't
fit a background/batch grading call). The judge's documented ✅/⚠️/❌ opening marker is parsed
into a numeric score fraction.

**This is why Assignment grading correctly catches a stated misconception in a free-text
answer** (verified live: a student who wrote "dropna and fillna are basically the same thing"
alongside an otherwise-plausible answer was scored 0.0 by the AI Judge) — it's reusing the
*already-good* Quiz verdict prompt, not a separately-written, weaker prompt. **This is directly
relevant to TODO item "Improve `mastery_grade`"** — Mastery Path's own grading path does NOT
reuse this judge; it has its own (weaker) grading prompt in the Mastery capability. Porting
Mastery's grading to reuse the same judge prompt (or explicitly teaching its own prompt to
watch for stated misconceptions) is the fix — see `TODO.md`.

Deliberately **not** built: LLM-assisted question *generation* for Assignments (the
`QuestionPipeline.run()` pipeline is callable headlessly but wiring it in means building a full
`UnifiedContext` and touching live agent-loop machinery — real integration risk for what the
original brief flagged as an optional convenience). Assignments v1 is instructor-authored
questions only, matching `QuizPair`'s field shape exactly so generation can slot in later
without a schema migration.

### 2.4 Course Notes — why it needed a side-index instead of a model field

This is the trickiest architectural finding in the whole project and worth understanding before
touching Book-related code. A Book's files live **physically inside its owning instructor's own
per-user workspace**, resolved fresh from *the current request's own identity* on every call:
`get_path_service()` → `get_current_path_service()`, keyed off a ContextVar. **There is no
book-level owner field and no shared index** — a student's request has no code path that can
reach an instructor's book at all. "Just add `course_unit_id` to the Book model" does not work,
because the Book model itself is never loaded in a context where the *student's* request could
resolve to the *instructor's* file path.

Fix, without touching the Book model, compiler, or any existing Book endpoint:

- `deeptutor/multi_user/course_books.py` — a system-level index (`SYSTEM_ROOT`-scoped JSON,
  same shape as `course_units.py`) mapping `book_id → {owner_id, course_unit_id, status}`.
  Draft/published state lives **here**, not on the Book record itself.
- `deeptutor/multi_user/book_access_router.py` — assign/publish/unpublish/list/read, gated by
  the same `_manages_course_unit`/`is_approved_student_of` predicates imported directly from
  the course-units module (not re-derived).
- The actual cross-workspace read uses `deeptutor/multi_user/paths.py`'s existing
  `user_context()` contextmanager (already used elsewhere for cron jobs and partner runtimes)
  to briefly resolve path-service calls against the **owner's** scope instead of the
  **requester's** scope — entered only *after* the authorization check passes, never before.
  **This is the pattern to reuse any time you need one user's request to legitimately read
  another user's per-workspace files** (chat history has the identical shape/limitation — see
  §3's feedback-aggregation gap).

Frontend: `PageReader` (the existing block-rendering component) takes only optional editing
callbacks — passing none produces a working read-only reader for free. New pages:
`web/app/(admin)/admin/course-units/[courseUnitId]/notes/page.tsx` (instructor: assign one of
their own books, publish/unpublish/remove) and
`web/app/(utility)/courses/[courseUnitId]/notes/page.tsx` (student: published-only list + reader).

### 2.5 Gradebook

`deeptutor/multi_user/gradebook.py` — pure aggregation, no new storage. For each
approved-enrolled student, each published assignment's *latest* submission score → percentage
→ weighted average using each assignment's `weight` (not a simple sum — a 2×-weighted
assignment counts twice). Two endpoints on the assignments router:
`GET .../gradebook` (JSON) and `GET .../gradebook/export` (`text/csv`,
`Content-Disposition: attachment`). The export endpoint needed **no** frontend blob-handling —
auth here is a same-origin cookie, so a plain `<a href=...>` triggers the download directly.

### 2.6 Enrollment: two paths, one state machine

Both instructor-direct-enroll (search a known student, click Enroll) and student-initiated
request-to-enroll write to the same `Enrollment` record with a `status` field, not two parallel
mechanisms. `enroll_student()` (instructor path) *upgrades* an existing pending request to
approved rather than no-opping — a first draft of the idempotency check would have made the
instructor's "Enroll" button silently do nothing for a student who'd already requested; caught
before it shipped. `request_enrollment()` (student path) never downgrades an approved student
back to pending. If you touch enrollment logic, preserve this asymmetric-idempotency property.

## 3. Response feedback (thumbs up/down)

**Storage**: `messages` table (SQLite, `deeptutor/services/session/sqlite_store.py`) gained a
`feedback_json TEXT DEFAULT ''` column via `ALTER TABLE` migration. Payload shape:
`{rating: "up"|"down"|null, comment: str, updated_at: float, question: str, answer: str}`. The
`question`/`answer` fields are a **snapshot taken at rating time** — `_set_message_feedback_sync`
looks up the nearest preceding `role='user'` message in the same session and stores its content
alongside the assistant message's own content, so the admin review page shows genuine context
even if the message is later edited or the branch changes.

**⚠️ Known SQL trap in this file**: the literal column-list substring
`attachments_json, metadata_json, created_at, parent_message_id` appears both in SELECT
statements (which needed `feedback_json` added) and in INSERT statements (`_add_message_sync`,
`_import_session_sync`) which must **never** get a column added without a matching `?`
placeholder. If you touch this file, grep for the full column list and check each occurrence
individually — do not use a blind `replace_all`.

**Endpoints** (`deeptutor/api/routers/sessions.py`): `PUT
/sessions/{id}/messages/{id}/feedback` (any signed-in user, assistant messages only — validated
by role check in the SQL `WHERE`) and `GET /sessions/admin/feedback` (admin-gated via
`require_admin`, registered *before* the `/{session_id}` route — see §5's route-shadowing note,
though in this specific case the segment counts differ so there was no actual collision risk;
placed defensively anyway).

**Known, deliberate v1 limitation**: `list_feedback` reads only the calling admin's own SQLite
workspace file — chat history is per-user-workspace with no shared index (same root limitation
as §2.4's Book problem). **This is not a true cross-instructor/cross-student aggregate.** If a
real cross-user feedback rollup becomes a real ask, the fix is the identical
`user_context()`-impersonation pattern from §2.4, iterated over every user's workspace and
merged — non-trivial but architecturally already solved once.

**Frontend UX iteration** (this went through two revisions, worth knowing which one is
correct): the first version showed an inline comment `<input>` in the message's action row once
a rating existed — this echoed the reviewer's private note back into the visible chat
transcript, which is wrong (defeats the purpose of a private review channel). Current version
(`FeedbackButtons` in `web/components/chat/home/ChatMessages.tsx`): clicking either thumb opens
a small popup (direction-specific question — "What was good..." / "What went wrong...") with an
optional textarea, Submit/Cancel; nothing from it is ever rendered back into the thread
afterward. Re-clicking an already-active rating clears it immediately with no popup.

A "Resend this prompt" button (re-send the paired user message as a new turn from any historical
assistant message, not just the last one) was built, then **deliberately reverted** as redundant
with the pre-existing "Regenerate" button (which pops-and-retries the last turn in place) — if
you're tempted to add a resend/rerun affordance, check `git log -p` for this revert first so you
understand why it was judged redundant rather than rebuilding it blind.

## 4. Chat deletion bug (root cause, for context if it recurs)

The actual bug was **not** a storage/backend defect — it was that the frontend delete path had
**zero error handling**: `SessionList.tsx`'s `void onDelete(...)` and both sidebars'
`handleDeleteSession` had no try/catch, so any backend failure (404/409/500, or a flaky
request) resulted in silent no-op UI. Fixed by wrapping both `handleDeleteSession`
implementations in try/catch → `notify(message, {tone:"error"})`, and by making
`session-api.ts`'s shared `expectJson` helper surface the backend's actual `detail` string
instead of a bare status code (this improved *every* session-API error message, not just
delete). Also added a genuinely missing backend guard: `DELETE /sessions/{id}` had no check for
"session is actively generating," unlike its sibling per-message delete endpoint — added,
returns 409. **If "can't delete X" reports recur, check for this same class of bug first**
(missing frontend error surfacing) before assuming a backend defect.

## 5. Quiz (`deep_question`) tool-calling reliability

Two separate rounds of work here; both are relevant if Quiz misbehaves again.

**Round 1 (commit `6f872f4`)**: `vllm` was hardcoded to `supports_tools: False` and listed in
`_NATIVE_TOOL_BLOCKED_BINDINGS` (`deeptutor/core/agentic/client.py`,
`deeptutor/services/llm/capabilities.py`) — so the agent loop never attached tool schemas to
requests for vLLM-backed models regardless of whether the backing server actually supports
OpenAI-style function calling (this vLLM instance runs with `--enable-auto-tool-choice` and
correctly returns structured `tool_calls` when given a schema — verified directly with a raw
API request). Fixed the capability flag and reordered `can_use_native_tool_calling()` so an
explicit `supports_tools` capability can override the local-provider fallback.

**Round 2 (this session, commit `fa2b56d`)**: even with tool schemas correctly attached, Quiz's
Explore phase (`deeptutor/agents/question/pipeline.py`) still sometimes produced a `THINK` reply
containing a **narrated fake tool call** — literal text like
`web_fetch call: {"name": "web_fetch", "parameters": {...}}` — instead of a real `tool_calls`
entry, then looped re-narrating the identical "plan" until the iteration budget ran out with no
usable output. **Important, previously-wrong assumption to not repeat**: an earlier hypothesis
guessed Quiz "runs through its own pipeline with its own tool-calling gate the patch never
touched" — this was investigated and is **false**. Quiz's Explore phase calls the exact same
shared `run_agentic_loop()` / `can_use_native_tool_calling()` as Chat and Mastery Path;
`web_fetch` is unconditionally auto-mounted (`deeptutor/agents/_shared/tool_composition.py`'s
`always_on` set) regardless of user toggles, so tool schemas are demonstrably attached. This is
a **model-behavior reliability gap**, not a wiring bug — the exact same class of issue as the
`mastery_build` argument-schema problem (see `TODO.md` item on `mastery_build`): this specific
quantized local model (Llama-3.3-70B-AWQ-INT4) does not reliably follow strict
multi-label/function-calling protocols, even when the system prompt explicitly forbids the
exact failure mode observed (`deeptutor/agents/question/prompts/en/pipeline.yaml`'s `explore.system`
literally says "Do not type the call as JSON text in the body").

Mitigation added: `_BaseLoopHost.on_intermediate()` in `pipeline.py` (a pre-existing extension
point in the shared loop, `deeptutor/core/agentic/loop.py` — designed for exactly this: "react
to an intermediate label, optionally inject feedback as the next user message," already used by
Research's `APPEND` handling). Detects a `THINK` reply matching a
`"name": "<known-tool>" ... "parameters":` pattern and injects a corrective repair message
telling the model to actually emit `TOOL` next. **This does not force the model to comply** —
verified live, the model sometimes still ignores the repair and keeps narrating — but it does
guarantee the loop terminates within its iteration budget via the existing force-finalize
fallback and produces a coherent, usable quiz instead of hanging or degrading. If you want a
*stronger* guarantee than "usually recovers," the next lever is forcing `tool_choice="required"`
on the first Explore iteration specifically (currently hardcoded to `"auto"` in
`deeptutor/core/agentic/labeled_step.py:159`, shared by every capability — changing it there
would affect Chat/Mastery too, so any change should be scoped to Quiz's Explore call site only).

## 6. `/docs` — in-app platform guide

`web/app/(utility)/docs/page.tsx` + `web/lib/docs-content.ts`. Deliberately **not** a chatbot
and not a single long Markdown page — content is a typed array
(`DOC_CATEGORIES: DocCategory[]`, each with `topics: DocTopic[]`) rendered as collapsible
accordion cards grouped under category headers, with quick-jump anchor pills at the top. This
shape was chosen after an explicit product decision to reject two other options: (a) a live
LLM-backed "Help Assistant" — investigated and scoped in `TODO.md`, rejected *for now* as
unnecessary complexity, and (b) one long scrolling Markdown page — rejected because "someone
should not have to read all these things" (verbatim ask): nothing expands until clicked. If you
add content, edit `docs-content.ts` only — the page component needs no changes for new topics.

Sidebar gained a `Docs` entry (`SidebarShell.tsx`, `SECONDARY_NAV`, unrestricted — visible to
every role) using `HelpCircle`. In the same pass, the sidebar's **footer links to the upstream
`deeptutor.info` docs site, the upstream GitHub repo, and the version badge were removed** — they
pointed at public sites unrelated to this deployment and were flagged by the product owner as
inappropriate to expose. If you're tempted to add an "About"/"Version" surface back, don't
resurrect those specific links.

## 7. Established patterns to reuse (don't reinvent)

- **Access control**: explicit predicate functions (`is_instructor_of`, `is_approved_student_of`,
  `require_admin`, `require_instructor_or_admin`) called per-endpoint. No decorator/middleware
  auth layer in this codebase's style.
- **Cross-user file access**: `deeptutor/multi_user/paths.py`'s `user_context()` contextmanager
  — enter only after authorization passes.
- **New system-level records** (not per-user workspace data): a JSON file under `data/system/`,
  following `identity.py`/`grants.py`/`course_units.py`'s shape — not a new SQLite table, not an
  ORM.
- **Role-gating a frontend surface**: `NavEntry.roles` (hide) + `RoleGuard` (block direct
  navigation) — always both together, never just one.
- **Reusing an existing LLM-graded verdict** instead of writing a new grading prompt — see
  §2.3. If a new surface needs "was this answer good," check whether the Quiz AI Judge's
  prompt-building functions can be imported before writing a new prompt.
- **Repair/self-correction loop hook**: `LoopHost.on_intermediate()` — see §5. This is the right
  place for "detect the model doing X wrong mid-loop, inject a corrective message," not a new
  bespoke retry mechanism.
- **Docker image discipline**: `docker-compose.yml` (production target) only, for anything
  meant to persist. See `README.md` in this folder.
- **Test-then-commit discipline**: create temp accounts/data → verify live (browser or direct
  API calls) → clean up → commit. See `README.md`.
- **Locking inside an `async def` endpoint**: use `asyncio.Lock`, never `threading.Lock`, for
  any critical section that has an `await` inside it (an LLM call, another async I/O call).
  This app runs one event loop on one thread; a second coroutine blocking on an already-held
  `threading.Lock.acquire()` freezes that thread entirely, including the first coroutine's own
  pending I/O completion — a guaranteed total deadlock, confirmed live (whole backend
  unresponsive, container flipped `unhealthy`) when `assignments_router.py`'s attempt-limit fix
  first shipped with a `threading.Lock` held across `await grade_submission(...)`; fixed to
  `asyncio.Lock`. The existing `_WRITE_LOCK = threading.Lock()` pattern in `assignments.py`/
  `course_units.py` is safe *only* because those critical sections are pure synchronous
  JSON read/write with no `await` inside — don't copy that pattern into a spot that also needs
  to `await` something inside the lock.

## 8. File map (most-relevant new/modified files, by area)

```
deeptutor/multi_user/
  models.py                 Role literal (admin/instructor/user)
  identity.py                role validation, full_name/registration_number fields
  course_units.py            CourseUnit, Enrollment (+ status field), catalog/request/approve
  assignments.py             Assignment, Submission storage
  assignments_router.py      create/publish/submit/gradebook/gradebook-export endpoints
  grading.py                 auto-grade (choice/fill-blank) + AI-Judge grade (reuses quiz_judge)
  gradebook.py                pure aggregation over course_units.py + assignments.py
  course_books.py            book_id -> {owner_id, course_unit_id, status} index
  book_access_router.py      assign/publish/unpublish/list/read, uses paths.py's user_context()
  context.py                  get_current_user() ContextVar accessor
  paths.py                    user_context() cross-workspace impersonation

deeptutor/api/routers/
  sessions.py                 feedback endpoints, delete-session 409 guard
  auth.py                     SetRoleRequest (3-role), require_instructor_or_admin

deeptutor/agents/question/
  pipeline.py                 Quiz Explore/Plan/Quiz phases; on_intermediate() repair hook

deeptutor/core/agentic/
  client.py, loop.py, labeled_step.py     shared agent loop; tool-calling gate; tool_choice

deeptutor/services/session/
  sqlite_store.py             feedback_json column + set/list_feedback methods

web/components/sidebar/
  SidebarShell.tsx             NavEntry.roles, Docs entry, removed external footer links

web/components/auth/
  RoleGuard.tsx                 generic route-level role gate

web/components/chat/home/
  ChatMessages.tsx              FeedbackButtons (popup UX), Regenerate button

web/app/(admin)/admin/
  users/page.tsx                 3-role management
  course-units/[...]/            assignments, gradebook, notes pages (instructor/admin)
  feedback/page.tsx               response-feedback review page

web/app/(utility)/
  courses/                        student catalog, assignments, notes pages
  docs/page.tsx                   platform guide (accordion cards)
  profile/page.tsx                 Details card (student-only — see below)

web/lib/
  docs-content.ts                  /docs page content (edit here, not the page component)
  session-api.ts                    feedback types/API, expectJson error surfacing
```

## 9. Small fixes worth knowing about (low-context, easy to miss in a diff)

- **`web/app/(utility)/profile/page.tsx`**: the "Details" card (full name + registration
  number) is gated to `!isAdmin && !isInstructor` — registration numbers are a student-only
  concept (it's what instructors search on to enroll someone); admins/instructors have no use
  for the field and it was confusing them.
- **Route registration order**: FastAPI/Starlette matches routes by registration order for a
  given path-segment count. A static route (`/course-units/catalog`) registered *after* a
  dynamic route with the same segment count (`/{course_unit_id}`) gets shadowed — this was a
  real, shipped-then-caught bug (`GET /course-units/catalog` briefly 403'd every student because
  it matched the instructor/admin-gated detail route instead). **Any new static route sharing a
  segment count with an existing dynamic route must be registered first.**
