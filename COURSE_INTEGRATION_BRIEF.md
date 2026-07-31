# DeepTutor for BigDataClass-ACE — Scoped Brief

Status as of 2026-07-31. Written for handoff to Devin and advising developers.
This fork: https://github.com/atwine/DeepTutor (upstream: https://github.com/HKUDS/DeepTutor)

## 1. Goal

An instructor teaches a semester-long "Big (Bio)Data" class (undergrad → master's/PhD students,
zero prior data science background → deploying simple ML models) essentially solo, every
semester, with heavy repetition (NumPy, Pandas, visualization, basic ML) and limited time
(also writing grants, supervising others). Two A100 GPUs (80GB each) are available on an
institutional network, reachable via VPN, already running vLLM.

The goal is an LLM-assisted tutoring layer that:
- Curates notes (instructor + LLM collaboratively), not fully autonomous content
- Tutors students adaptively (different pacing/difficulty per student) without just handing
  over answers — should prompt students to think before helping
- Generates non-deterministic quizzes per student
- Runs fully self-hosted against the lab's own A100s (no data leaves the institution)
- Reduces the instructor's repetitive-teaching load, freeing time for grant writing etc.

## 2. Why DeepTutor (vs. the alternatives evaluated)

Compared candidates: OpenTutor (zijinz456), Open-TutorAI CE, OATutor, socratic-llm/SocraticLM,
DeepTutor (HKUDS). Full comparison in conversation history; summary of the deciding factors:

| | OpenTutor | DeepTutor | OATutor |
|---|---|---|---|
| Multi-user/classroom | ❌ explicitly single-user beta | ✅ built + tested | ✅ (LTI/Canvas) |
| Self-hosted LLM (vLLM etc.) | ✅ | ✅ | ❌ no chat-tutor LLM layer |
| Real-world evidence | papers cited, no deployment study | self-reported growth (verify) | **peer-reviewed (CHI 2023), real classroom pilots** |
| Repo health | 57 stars, 3 contributors, recent commits are auto-generated marketing content | 31k stars, 30 contributors, real PR-driven commits | small, low-maintenance |

DeepTutor won on: multi-user already built (not a roadmap item), largest and most
verifiably-active community, self-hosted LLM support matching our infrastructure, and the
broadest already-built feature set (RAG knowledge bases, quiz generation with auto-grading,
Mastery Path, notes/"Book" workspace, memory system, custom personas/subagents).

OATutor is worth a second look **specifically** for its peer-reviewed classroom-deployment
evidence and lightweight BKT-based adaptive practice, if the "adaptive quiz difficulty" half
ever needs a more evidence-backed engine than DeepTutor's current one.

## 3. Branch audit — don't rebuild what's already done

Checked every branch on `HKUDS/DeepTutor` against `main` (via GitHub compare API):

| Branch | vs main | Verdict |
|---|---|---|
| `multi-user` | 0 ahead, 511 behind | **Stale — fully merged into main already.** The `deeptutor/multi_user/` module (grants, RBAC, resource isolation, audit log, all with test coverage in `tests/multi_user/`) is live in main. Not a build item. |
| `dev` | identical | mirror of main |
| `guide2.0` | 0 ahead, 615 behind | stale, superseded |
| `Deeptutor-v0.6.0-archive` | 0 ahead, 837 behind | frozen old-version snapshot |
| `eval` | 130 ahead, 833 behind | Only branch with real unmerged work — internal LLM-judge/benchmarking tooling, not a user-facing feature. Worth mining later only if we build a formal quiz/tutoring quality eval harness (see §6.6). |

**Conclusion: multi-user is not something to build. It needs to be *configured* and *rolled out*, not implemented.**

## 4. What's already confirmed working (as of this session)

- Local Docker deployment against the lab's vLLM endpoint (`http://10.35.50.41:8000/v1`,
  model `ibnzterrell/Meta-Llama-3.3-70B-Instruct-AWQ-INT4`, 49,152 token context) — verified
  reachable and responsive over VPN (~250-280ms RTT).
- RAG-grounded chat, Quiz mode (auto-generated questions + reference answers + AI-Judge
  grading), Mastery Path mode (probe-before-teach pattern), Book/notes workspace, multi-provider
  LLM settings UI (dedicated "vLLM/Local" provider option) — all present and reachable.
- Multi-user backend: real, tested (`deeptutor/multi_user/`: `grants.py`, `audit.py`,
  `knowledge_access.py`, `model_access.py`, `tool_access.py`, admin→user grant model,
  deny-by-default for MCP/CLI tools, credential-injection scanning).

## 5. Fixed and shipped this session

**Bug:** DeepTutor hardcoded local LLM providers (`vllm`, `ollama`, `lm_studio`, `llama_cpp`) to
never receive native OpenAI-style tool schemas, regardless of whether the actual server behind
them supports function calling. Two separate gates enforced this:

1. `deeptutor/services/llm/capabilities.py` — `"vllm": {"supports_tools": False, ...}`
2. `deeptutor/core/agentic/client.py` — `vllm` listed in `_NATIVE_TOOL_BLOCKED_BINDINGS`, plus
   a second `spec.is_local` short-circuit that would have re-blocked it even after fixing (1)

**Effect:** every agent loop (Chat, Quiz, Mastery Path) degraded to the model narrating fake
`tool_calls` JSON as plain text instead of executing anything — quiz generation and mastery
tracking silently did nothing, sometimes looping indefinitely without ever producing output.

**Verification before fixing:** raw `curl` request to the vLLM endpoint with a `tools` schema
correctly returned a structured `tool_calls` response (`finish_reason: "tool_calls"`) — proof
the *server* was never the problem, only DeepTutor's client-side gating.

**Fix:** committed as [`6f872f4`](https://github.com/atwine/DeepTutor/commit/6f872f4) on
`atwine/DeepTutor` main — flips the `vllm` capability flag to `True` and reorders
`can_use_native_tool_calling()` so an explicit `supports_tools=True` can override the
local-provider fallback, without changing behavior for `ollama`/`lm_studio`/`llama_cpp`.

**Verified fixed**, three ways:
- Quiz mode: 1 call (broken) → 13 calls (fixed), real interactive quiz UI rendered,
  reference answers + AI-Judge grading worked end to end.
- Plain Chat mode: real tool ledger (`ask_user`, `read_skill`, `brainstorm` with structured
  JSON arguments), confirmed via DeepTutor's own Activity panel.
- Mastery Path mode: real tool ledger (`Mastery Status`, `Mastery Build`), confirmed via
  DeepTutor's session API (`tool_steps` went from 0 to nonzero).

## 6. Open items for Devin / advising devs

### 6.1 Roll out multi-user for the class (config, not code)
Set `DEPLOYMENT_MODE=multi_user`, `AUTH_ENABLED=true`, `JWT_SECRET_KEY`; provision one account
per student via the admin grants system; decide per-student vs. shared knowledge-base access.
Read `docs/local-single-user.md` in the repo first — current default is explicitly single-user.

### 6.2 Fix Mastery Path loop convergence
With tool-calling now working, Mastery Path still called `mastery_build` **8 times** in a row
(default `mode="replace"`, so each call likely just re-overwrote the same 3 knowledge points)
before terminating with a broken, out-of-character closing line ("The final answer is: isna")
that looks like it's bleeding in from the neighboring "Solve" capability's response format, not
Mastery Path's own. Needs investigation into `deeptutor/capabilities/mastery/loop.py`,
`prompts/en/system.md`, and the agent loop's stop conditions. Cost/latency was also high for a
simple assess-then-probe exchange: 9 calls, 88.9k tokens, ~$0.07, well over a minute.

### 6.3 Fix the mode-picker UI flyout
The chat input's "More Capabilities → Mastery Path/Solve" submenu is CSS-hover-driven
(`invisible opacity-0` → `visible opacity-100` on a `group/more` hover) and did not reliably
open via normal mouse hover or click during testing — had to be forced open via direct DOM
event dispatch. This is a real usability risk for actual users, not just a testing artifact.

### 6.4 Decide: is DeepTutor's "test-then-teach" pedagogy sufficient, or do we need stricter Socratic gating?
DeepTutor's Mastery Path checks prior knowledge before teaching, then gates advancement on
demonstrated understanding ("active recall with gating") — different from strict
answer-withholding Socratic dialogue. OpenTutor's `socratic_engine.py` is a smaller, cleaner
reference implementation of that stricter pattern (a real finite-state machine:
`PROBE → CLARIFY → CONFRONT → SCAFFOLD → CONFIRM`, hint-capped before falling back to a direct
explanation) if we decide DeepTutor's current approach doesn't withhold answers firmly enough
for this course's students.

### 6.5 Decide: do we need a dedicated curated-notes authoring workflow?
Right now notes/paths/quizzes are all generated live, per conversation, from a chat prompt.
There's no separate flow where the instructor and the LLM co-author *fixed* course notes ahead
of the semester (the original ask: "the notes... curated by the LLM in conjunction with the
person who is tutoring"). Worth scoping as a real feature if that separation matters, rather
than relying on students triggering generation live each time.

### 6.6 Production deployment hygiene
- Switch from `docker-compose.ghcr.yml` (prebuilt image) to building from this fork
  (`docker-compose.yml`, `Dockerfile`, target `production`) so what's deployed always matches
  what's committed — right now the only running instance has the tool-calling fix patched
  directly into a container's writable layer, not built from the image.
- If exposed beyond localhost, review `SECURITY.md` — auth is off by default.
- Consider whether the `eval` branch's LLM-judge/benchmarking tooling is worth adapting into a
  lightweight internal harness for periodically checking quiz/tutoring quality against this
  specific course's material, given the model-quality caveats below.

## 7. Constraints from the research (keep these in mind when scoping UX/pedagogy)

- AI-assisted learning measurably risks "metacognitive laziness" — short-term task performance
  improves more than durable, transferable competence (Fan et al. 2024; Xu et al. 2026
  meta-analysis: AI's effect on behavioral performance is roughly double its effect on
  self-reported/durable competence). Reinforces §6.4 — err toward gating, not answering.
- RAG grounding is the accepted fix for hallucination in ed-tech, but narrows what the tutor
  can usefully answer to what's in the knowledge base — a real tension for open-ended student
  questions (Thesen et al. 2025).
- ITS/adaptive-tutoring effect sizes in the literature are positive but modest, often smaller
  than well-designed non-AI tutoring baselines (Létourneau et al. 2025, K-12 systematic review).
  Set expectations accordingly — this is an efficiency/scale play for the instructor, not a
  guaranteed large learning-outcomes win.

## 8. Infrastructure summary

- vLLM server: `10.35.50.41:8000`, reachable via VPN, serving
  `ibnzterrell/Meta-Llama-3.3-70B-Instruct-AWQ-INT4` (quantized, 49,152 token context). vLLM
  itself already supports real tool-calling (`--enable-auto-tool-choice` equivalent behavior
  confirmed via raw API test) — no server-side changes needed.
- DeepTutor app needs no GPU — single Docker container (FastAPI :8001 + Next.js :3782 under
  supervisord), connects to the vLLM endpoint over the network.
- Response latency: ~250-280ms network RTT plus real inference time — simple one-shot Q&A took
  ~29s; multi-tool-call flows (Quiz, Mastery Path) took 30s-90s+. Worth benchmarking against a
  smaller/faster model for latency-sensitive interactive tutoring, even if the 70B stays for
  higher-stakes content generation.
