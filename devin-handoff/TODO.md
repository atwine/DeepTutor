# Remaining work

Ordered roughly by size/independence, not strict priority. Each item has enough technical
framing to start without re-deriving context — read the referenced section of
`ARCHITECTURE_AND_COMPLETED_WORK.md` first regardless.

Pick an item, work it, then **append an entry to `DEVIN_LOG.md`** — don't mark anything here as
done by editing this file; the log is the source of truth for status so both agents can trust
it without re-reading the whole diff.

---

## 1. Make `mastery_build`'s error message example-driven

**Small, contained, same root-cause family as the Quiz fix in §5 of the architecture doc.**

`deeptutor/capabilities/mastery/tools.py` — `MasteryBuildTool.execute()`'s `_parse_modules()`
rejects malformed/empty `modules` arguments with a plain-text error:
`"mastery_build needs a non-empty 'modules' array."` The model (same
Llama-3.3-70B-AWQ-INT4-via-vLLM reliability profile as the Quiz issue) doesn't reliably
self-correct from a prose error alone — it re-sends the same malformed call repeatedly, burning
the turn's round budget (`DEFAULT_MAX_ROUNDS = 8` in
`deeptutor/agents/chat/agentic_pipeline.py`) with zero forward progress. This was misdiagnosed
in an earlier round of work as a loop-convergence bug; the actual driver is that every
`mastery_build` call fails validation before ever reaching the (already-correctly-implemented)
idempotency gate (`last_build_turn_id` on `LearningProgress`).

**Fix**: make the error message inline a minimal valid example JSON shape, e.g.:

```
"mastery_build needs a non-empty 'modules' array, e.g.:
{\"modules\": [{\"title\": \"...\", \"topics\": [\"...\"]}]}"
```

giving the model something concrete to pattern-match against on retry, rather than an abstract
description of the requirement. This is the exact same class of fix as the Quiz repair message
(§5 of the architecture doc) — "give the model a concrete correction to retry against" — just
via a tool-error string instead of an injected loop message.

**Verification**: repro from the original investigation — fresh Mastery Path session, "Build a
mastery path for pandas missing value handling... check my mastery status first" — and confirm
`mastery_build` succeeds within 1-2 calls instead of repeating the malformed-args failure across
most of the round budget. Compare token/cost/latency against the historical baseline (9 calls,
~88.9k tokens, ~$0.07, 60-90s) noted in prior session logs.

---

## 2. Improve `mastery_grade` to catch stated misconceptions

**Medium. Directly informed by working code elsewhere in the repo — read §2.3 of the
architecture doc first, this is the whole point.**

A comparison spike (OpenTutor's Socratic FSM vs. this repo's Mastery Path, same
topic/misconception in both) found Mastery Path's grading rubber-stamps a student who picks the
correct multiple-choice answer even when their own free-text explanation states a clear,
confident misconception in the same message (e.g. "Isn't `fillna()` basically the same as
`dropna()`... they both just get rid of the missing values, right?" — MC answer correct, verdict
was "You demonstrated a good grasp of these concepts," misconception completely unaddressed).

**The fix already exists elsewhere and just needs porting/reusing.** Assignment grading
(`deeptutor/multi_user/grading.py`, §2.3 of the architecture doc) reuses the Quiz AI Judge's
verdict prompt (`_JUDGE_SYSTEM_PROMPTS`/`_build_judge_user_prompt` from
`deeptutor/api/routers/quiz_judge.py`) and was verified live to correctly catch this exact
failure mode — same misconception, same phrasing style, scored 0.0 with an accurate written
explanation of why. Mastery Path's own grading path does **not** go through this judge; find
where Mastery's grading prompt lives (search `deeptutor/capabilities/mastery/` for the grading
tool/prompt — likely a `mastery_grade` tool analogous to `MasteryBuildTool`) and either:

- (a) **Preferred, lowest-risk**: import and reuse the Quiz judge's prompt-building functions the
  same way `grading.py` does, replacing Mastery's own (weaker) grading prompt wholesale, or
- (b) if (a) doesn't fit Mastery's specific rubric/output shape, explicitly extend Mastery's
  existing grading prompt with an instruction to scan the free-text portion of an answer for
  stated misconceptions independent of the MC selection — modeled on what the Quiz judge prompt
  already does, not written from scratch.

Only fall back to porting OpenTutor's FSM's `CONFRONT`/`SCAFFOLD` state logic
(`deeptutor/capabilities/mastery/` doesn't currently have this) if the grading-prompt fix
doesn't close the gap on retest — that was explicitly scoped as the bigger, deferred option in
the original spike, not the first thing to try.

**Verification**: repeat the exact spike scenario — same student persona, same
dropna/fillna misconception stated alongside a correct MC pick — and confirm the turn now
flags/challenges the misconception instead of closing with unqualified praise.

---

## 3. Edge-case testing pass across multi-user/course-unit features

**Larger, exploratory. No fix implied — this is a testing/bug-hunting task.**

Every phase in §2 of the architecture doc was verified against its own happy path with temp
accounts, then cleaned up — no dedicated adversarial/edge-case pass has been done across the
whole subsystem together. Candidate cases (not exhaustive — use judgment, this list is a
starting point):

- A student enrolled in zero courses — does every course-scoped page degrade gracefully
  (empty states), or does anything assume at least one enrollment?
- An instructor removed from a course unit (role changed, or unassigned from the unit) while
  they still have pending enrollment requests queued for it — who can act on those requests
  afterward, if anyone?
- Deleting a course unit that has active assignments with submissions / recorded grades — does
  this cascade-delete, orphan records, or is it blocked? Check `course_units.py`'s delete path.
- A rejected enrollment request, then the same student re-requests the same unit — does the
  second request work cleanly, or does stale rejected-state linger?
- Concurrent instructor-direct-enroll and student-self-request-approval on the same student for
  the same unit (race condition, not just sequential ordering) — does the idempotency guard from
  §2.6 of the architecture doc actually hold under concurrent writes, or only sequential ones?
- An assignment's attempt limit interacting with a submission that errors mid-grade (AI Judge
  call fails/times out) — does that consume an attempt the student never got a real result for?
- A Book assigned to a course unit's notes, then the underlying Book is deleted/renamed by the
  instructor outside the course-unit context — does the notes index (`course_books.py`) end up
  pointing at a dead reference, and if so, how does the student-facing notes page handle that?

**Deliverable**: a list of what's found (bug vs. acceptable-for-now edge case, with reasoning),
plus fixes for anything that's a real user-facing break — not necessarily every single item
above needs a code change, some may be legitimately fine to leave as understood limitations.
Log findings in `DEVIN_LOG.md` either way so the decision is recorded.

---

## 4. Scope the onboarding walkthrough + Help Assistant idea properly

**Investigation/design task, explicitly not authorized to build yet — confirm with the repo
owner before writing implementation code, not just before shipping it.**

Already investigated once (read-only) and written up — the finding is that a "Help Assistant"
persona (the existing `deeptutor/services/persona/service.py` mechanism) **cannot** be scoped to
zero tool access; personas are pure system-prompt text swaps
(`deeptutor/agents/chat/prompt_blocks.py` treats the persona block as just another
`PromptBlock`, untouched by `tool_manifest`/`kb_note`). A real Help Assistant needs to be its
own **capability** (same tier as Mastery Path/Quiz — see `deeptutor/capabilities/protocol.py`'s
`KnowledgeCapability.exclusive_tools=True` pattern, which replaces rather than augments the tool
surface, but has never been pushed all the way to a genuinely empty `owned_tools = ()`), so it's
architecturally incapable of touching RAG/tutoring tools regardless of prompt instructions —
this is the actual guarantee the product owner wants (a way for students to ask "how do I use
this" without a side door to coursework answers).

Separately, a **plain-language `/docs` page already shipped** (§6 of the architecture doc) and
was explicitly preferred over building the chatbot right now, on a "don't add complexity we
don't need yet" basis. **Do not build the Help Assistant capability without re-confirming this
is still wanted** — the docs page may turn out to be sufficient, and the owner's own framing was
"add this to our roadmap... see how that would work out later," not "build it."

If/when authorized: also reuse `web/components/settings/SettingsTourOverlay.tsx` (a
hand-rolled, already-working spotlight-tour overlay currently scoped to the Settings page only)
as the base for a generalized, role-aware app-wide tour, rather than building tour mechanics
from scratch or pulling in a third-party tour library (none is currently a dependency).

---

## 5. Rewrite `README.md`

**Content task, not a code task — but non-trivial because the current file is large (850
lines) and entirely upstream-authored.**

The repo-root `README.md` is the unmodified upstream HKUDS/DeepTutor README: generic
open-source project marketing (release history, Discord/WeChat/EduHub links, trendshift
badges, upstream `deeptutor.info` docs links) with **zero mention** of anything in this
document — no course units, no instructor role, no assignments/gradebook/notes/feedback, no ACE
branding. It needs to describe what *this deployment* actually is and does.

Suggested shape (not prescriptive — use judgment): keep whatever upstream feature description
is still technically accurate (Chat/Partners/My Agents/Co-Writer/Book/Knowledge
Center/Learning Space/Memory/Settings — all unmodified upstream features, still real), but
replace the release-history/community/ecosystem sections with an accurate description of the
BigDataClass-ACE-specific layer: the 3-role model, course units, enrollment flow, assignments +
gradebook, curated notes, response feedback, and the `/docs` in-app guide. Point at
`ARCHITECTURE_AND_COMPLETED_WORK.md` in this folder (or fold relevant parts of it in) rather than
re-deriving the technical description from scratch.

**Do not do this at the same time as item 6 (rebranding)** — they're independent; don't block
one on the other.

---

## 6. Rebrand to ACE branding — DO NOT START YET

**Explicitly blocked. The repo owner said "later" and is waiting on final logo assets.** Do not
touch `assets/figs/logo/*` or any DeepTutor-branded UI chrome (the sidebar logo/wordmark in
`web/components/sidebar/SidebarShell.tsx`, any favicon/manifest branding) until the owner
explicitly provides assets and asks for this. Listed here only so it isn't forgotten, not as an
open task.

---

## 7. Phase 10 wrap-up

**Small, low-urgency, do last.**

- Review `SECURITY.md` for anything needed now that multi-user auth is enabled and this is a
  real deployment with real student data — was written against the upstream single-user
  default posture, hasn't been revisited since.
- The `eval` branch (an internal LLM-judge/benchmarking tooling branch in this repo's history)
  is a deliberately deferred backlog item — only worth mining if a formal
  quiz/tutoring-quality-checking harness becomes a real need. No action required now beyond
  being aware it exists if that need comes up.
