# Remaining work

Ordered roughly by size/independence, not strict priority. Each item has enough technical
framing to start without re-deriving context — read the referenced section of
`ARCHITECTURE_AND_COMPLETED_WORK.md` first regardless, and read `DEVIN_LOG.md`'s latest entry
(the 2026-08-03 "Round 4 complete — full handoff" one) for the fullest current-state picture.

Pick an item, work it, then **append an entry to `DEVIN_LOG.md`** — don't mark anything here as
done by editing this file; the log is the source of truth for status.

**Done, not re-listed here** (see `DEVIN_LOG.md` for full detail on each): `mastery_build`
error-message fix, `mastery_grade` AI-Judge reuse, the multi-user edge-case testing pass,
`README.md` rewrite, the Postgres migration (all phases), Round 2 (course lifecycle, dates,
archive precursor, notifications precursor), Round 3 (assignment timer/retake UX, notifications
system, archive feature, instructor leave-request UI), Round 4 (course-notes cascade verified,
course-unit permission decision, Alembic migration tooling). All of this is live on `main` as of
commit `cf84034`.

---

## A. Security review

**Small, high-value, do this before Railway deployment — this now handles real student
accounts and grades, not a single-user default deployment.**

Review `SECURITY.md` against the actual current state: auth is enabled, there are three roles
with real permission boundaries, Postgres holds grade/enrollment data, and a sandbox-runner
sidecar executes model-generated code. `SECURITY.md` was written against upstream's single-user
default posture and hasn't been revisited since this fork's multi-user work started. No
findings pre-supposed — go read the actual current auth/permission code
(`deeptutor/api/routers/auth.py`, the `require_admin`/`require_instructor_or_admin` patterns
throughout `deeptutor/multi_user/`) and compare against what the doc currently claims.

---

## B. Deploy to Railway

**The big one. Not started — everything so far has been tested in local Docker only.**

Needs its own scoping pass before starting (this file isn't the place to plan it in full) —
at minimum: Railway Postgres addon provisioning + `DATABASE_URL` injection (already
designed for — `deeptutor/services/db/engine.py`'s URL resolution already handles Railway's
injected format), confirming the SSL-disable workaround in `engine.py` correctly does NOT
apply outside the local-default branch (it shouldn't — verify this explicitly before going
live, since Railway's Postgres may have different SSL expectations than the local
`postgres:16-alpine` container), running `alembic upgrade head` as part of the deploy step
(not `scripts/init_db.py`'s old `create_all()` — that path is gone now, see Round 4), and
deciding what happens to `sandbox-runner` (currently a docker-compose sidecar — does Railway's
deployment model support a second service, or does this need rethinking for a single-service
platform).

---

## C. GPU / vLLM scaling decision

**Deferred by design — revisit once there's actual signal, not before.**

2 A100 GPUs are available. The explicit decision from earlier discussion: wait to see where
the *current* single-GPU vLLM setup actually strains under real load before deciding between
tensor-parallelism (bigger model, lower per-request latency) and data-parallel replicas (more
concurrent throughput) — don't guess ahead of the evidence. No action item here beyond
"watch for the strain signal," not a task to pick up cold.

---

## D. Smaller loose ends flagged across Rounds 2-4, still open

- **Instructor cross-course compiled report — no frontend page.** Backend (`GET
  /instructor/report` + CSV export, `deeptutor/multi_user/gradebook.py`'s
  `build_instructor_report`) and API client functions exist and are verified working
  (Round 2/Devin). No dedicated UI page surfaces them yet.
- **No CI step re-running `alembic upgrade head`** as a regression check against a fresh
  database. Flagged as a nice-to-have by the Alembic task (Round 4), not built — there was no
  existing CI config in this repo to extend without guessing at infra that may not exist.
- **Alembic workflow isn't documented anywhere for future schema-change authors** — the
  workflow itself (`alembic revision --autogenerate` after editing `models.py`, review, `alembic
  upgrade head`) is described in `scripts/init_db.py`'s docstring and the Round 4 Alembic log
  entry, but not in an onboarding doc a new contributor would actually read first.
- **A narrower "let a co-instructor remove themselves from a course" self-service idea** —
  raised as a lower-risk alternative to fully opening up `instructor_ids` editing (Round 4 Task
  2's decision explicitly kept `instructor_ids` reassignment admin-only). Not scoped or built,
  just noted as worth keeping in mind if the general question comes up again.

---

## E. Bigger features, deliberately deferred to their own scoping round (not started)

- **AI-assisted assignment/exam question generation, scoped to an instructor's actual taught
  content** (and, downstream of that, a final exam curated the same way rather than from
  arbitrary material). Confirmed zero AI generation exists for Assignments today — 100%
  instructor-typed. This needs a real design conversation (how does it pull from a course's
  knowledge base/notes, what's the review/approval step before a generated question goes live)
  before any code — don't start building without that conversation happening first.
- **Knowledge Base / Book upload quotas and retention policy.** Confirmed the only upload
  limits that exist (`system.json`'s attachment limits) are scoped to chat-message attachments
  only, not KB/Book documents. Touches upstream DeepTutor's document-extraction/knowledge
  subsystem, a different surface than the multi-user course layer — own scoping round.

---

## F. Explicitly blocked / parked — do not start without the repo owner re-opening these

- **ACE rebranding** — blocked, waiting on final logo/asset files from the repo owner. Do not
  touch `assets/figs/logo/*` or `web/components/sidebar/SidebarShell.tsx`'s branding until
  explicitly asked.
- **"Help Assistant" chatbot capability** — scoped, deliberately not built. The repo owner's
  own framing was "roadmap it, see later," not "build it." The `/docs` page (already shipped)
  was explicitly preferred over this for now. Do not build without re-confirming it's still
  wanted.
- The `eval` branch (internal LLM-judge/benchmarking tooling) — deferred backlog item, only
  worth mining if a formal quiz/tutoring-quality-checking harness becomes a real need.
