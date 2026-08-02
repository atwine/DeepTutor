<div align="center">

<p align="center"><img src="assets/figs/logo/logo.png" alt="DeepTutor logo" height="56" style="vertical-align: middle;">&nbsp;<img src="assets/figs/logo/banner.png" alt="DeepTutor" height="48" style="vertical-align: middle;"></p>

# BigDataClass-ACE — a DeepTutor deployment for Data Science & Bioinformatics

<p align="center">
  <em>Self-hosted AI tutoring, course management, and grading for ACE instructors and students.</em>
</p>

[![Python 3.11+](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/downloads/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org/)
[![PostgreSQL](https://img.shields.io/badge/Postgres-course%20data-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue?style=flat-square)](LICENSE)

[What this is](#-what-this-is) · [Roles & Course Units](#-roles--course-units) · [Get Started](#-get-started) · [Explore the Platform](#-explore-the-platform) · [Architecture](#-architecture--engineering-docs) · [Upstream Project](#-built-on-deeptutor)

</div>

---

> This repository is a fork of [**HKUDS/DeepTutor**](https://github.com/HKUDS/DeepTutor), an open-source "agent-native" AI tutoring platform, customized and self-hosted for **BigDataClass-ACE** — a multi-instructor teaching deployment covering Data Science and Bioinformatics coursework. Everything upstream DeepTutor provides (chat tutoring, knowledge bases, quizzes, research, memory) is still here; this fork adds a course-management layer on top: instructors, enrolled students, assignments, gradebooks, and curated course notes, all scoped so instructors only ever see their own courses.

## 🎓 What This Is

DeepTutor is upstream's general-purpose "agent-native" tutoring platform — one chat-style engine that can tutor, answer questions, generate quizzes, research topics, and remember what a learner has covered, all grounded in whatever knowledge bases you point it at.

This deployment turns that engine into a **teaching platform for a real class**: instead of one person using their own knowledge bases, it supports **~10 instructors, each running their own courses for their own enrolled students**, with the usual things a class needs — who's enrolled, what's assigned, what's been graded, and what's shared as required reading — layered on top, while everyone still gets the full underlying tutor to actually study with.

**How it's run:**

- **Self-hosted.** No data leaves the institution's own infrastructure — served over the institution's VPN.
- **Local LLM via vLLM**, currently `Meta-Llama-3.3-70B-Instruct-AWQ-INT4`, running on 2×A100 GPUs.
- **`docker compose`** deployment (`docker-compose.yml` is the production target — see [Architecture & Engineering Docs](#-architecture--engineering-docs) for the compose service breakdown).
- **PostgreSQL** backs course units, assignments, submissions, and course-book links — the parts of the system multiple instructors and students read and write concurrently. Everything else (chat history, per-user memory, knowledge bases) keeps DeepTutor's existing per-user file/SQLite storage, which is already isolated correctly per account.

## 👥 Roles & Course Units

Upstream DeepTutor has two roles, admin and user. This deployment adds a third, **instructor**, sitting between them:

| Surface | Admin | Instructor | Student |
|---|:---:|:---:|:---:|
| Chat, Quiz, Book, Co-Writer, Mastery Path | ✅ | ✅ | ✅ |
| Memory | ✅ | ✅ | ✅ |
| My Agents (subagents/CLI consult) | ✅ | ✅ | ❌ |
| Knowledge Center, Settings | ✅ | ❌ | ❌ |
| Course Units — create/manage | all units | **own units only** | — |
| Assignments — create, publish, grade | all units | **own units only** | take & view own results |
| Gradebook | all units | **own units only** | — |
| `/admin/users`, `/admin/feedback` | ✅ | ❌ | ❌ |

An **instructor** manages one or more **course units** — a course unit has a name, a term, a roster, assignments, and optionally a set of curated books used as course notes. Students **request to enroll** (or an instructor enrolls them directly); once approved, a student sees only their own enrolled courses, their own assignments, and their own grades — never another course's roster or another student's submissions. Everything is scoped per-course-unit at the API level, not just hidden in the UI.

**What a course unit actually gives you:**

- **Assignments** — instructor-authored question sets (same question format as the built-in Quiz capability), with a configurable attempt limit and per-assignment weight. Multiple-choice and fill-in-blank questions auto-grade; free-text answers are graded by the same AI-Judge verdict prompt the Quiz capability uses, so a student who states a plausible-sounding misconception gets caught, not rubber-stamped.
- **Gradebook** — a weighted-average view across every published assignment for every enrolled student, exportable as CSV.
- **Course notes** — an instructor can publish one of their own Books (DeepTutor's "living book" reading experience) as required notes for a course unit; students in that course get a read-only view of it.
- **Response feedback** — students and instructors can thumbs-up/down any tutor answer with an optional comment; admins get a review queue of what the tutor is actually getting wrong.

None of this replaces the underlying tutor — a student in an enrolled course still has the full Chat/Quiz/Mastery Path/Book/Memory experience available to them; the course layer just adds structure (who's here, what's due, what's graded) around it.

## 🚀 Get Started

This deployment runs via `docker compose`, not the PyPI/pip install paths upstream DeepTutor also supports (those are documented upstream at [deeptutor.info](https://deeptutor.info) if you ever need a single-user, non-course install instead).

**Prerequisites:** Docker + Docker Compose, and an LLM endpoint the app can reach — either the institution's vLLM server, or any OpenAI-compatible endpoint (Ollama, LM Studio, a cloud provider) for local development.

```bash
git clone https://github.com/atwine/DeepTutor.git
cd DeepTutor

python scripts/docker_compose.py up -d --build
```

This starts four containers: `deeptutor` (the FastAPI backend + Next.js frontend), `postgres` (course units/assignments/submissions/course-book index), `pocketbase` (optional auth sidecar, not required), and `sandbox-runner` (isolated code execution for office-file skills). See [`docker-compose.yml`](docker-compose.yml) for the full service breakdown and [Architecture & Engineering Docs](#-architecture--engineering-docs) for why Postgres sits next to the rest of DeepTutor's file-based storage instead of replacing it everywhere.

Open the frontend URL printed in the terminal (default [http://127.0.0.1:3782](http://127.0.0.1:3782)). On first boot:

1. **Register the first account** at `/register` — it automatically becomes admin.
2. Configure your LLM provider from **Settings → Models** (point it at the vLLM server, or any OpenAI-compatible endpoint for local dev).
3. From **`/admin/users`**, create instructor and student accounts and set their roles.
4. As an instructor, create a course unit from the admin course-units page, add assignments, and approve student enrollment requests as they come in.

<details>
<summary><b>Local development without Docker</b> — running the backend/frontend directly against a checkout</summary>

Follows upstream DeepTutor's source-install path. Needs **Python 3.11–3.13** and **Node.js 22 LTS**.

```bash
python3 -m venv .venv && source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e .
( cd web && npm ci --legacy-peer-deps )

deeptutor init
deeptutor start
```

You'll still need a Postgres instance reachable for the course-unit/assignment subsystem — either point `DATABASE_URL` at one, or run just the `postgres` service from `docker-compose.yml` (`docker compose up -d postgres`) and let `deeptutor/services/db/engine.py`'s local-dev default connect to it.

</details>

<details>
<summary><b>Configuration reference</b> — config files under <code>data/user/settings/</code> (JSON/YAML)</summary>

Everything under `data/user/settings/` is plain JSON/YAML; the **Settings** page in the browser is the recommended editor for most of it.

| File | Purpose |
|:---|:---|
| `model_catalog.json` | LLM, embedding, and search provider profiles; API keys; active models |
| `system.json` | Backend/frontend ports, public API base, CORS, SSL verification, attachment limits |
| `auth.json` | Auth toggle, username, password hash, token/cookie settings |
| `integrations.json` | Optional PocketBase and sidecar integration settings |
| `interface.json` | UI language / theme / sidebar preferences |
| `main.yaml` / `agents.yaml` | Runtime behavior defaults, per-capability tool/token settings |

Course-unit/assignment data does **not** live under `data/user/settings/` — it's in Postgres (`DATABASE_URL`, injected automatically on Railway, or the local `postgres` compose service otherwise). Project-root `.env` is not read as an application config file.

</details>

## 📖 Explore the Platform

The full upstream surface is intact — Chat, Partners, My Agents, Co-Writer, Book, Knowledge Center, Learning Space, Memory, and Settings all work exactly as documented at [deeptutor.info](https://deeptutor.info). A few highlights most relevant to how this deployment is actually used:

<details>
<summary><b>💬 Chat</b> — the default tutoring surface</summary>

A single chat thread that can talk normally, ground itself in a course's or the student's own knowledge bases, generate images, and launch into deeper capabilities — **Quiz** for question generation, **Book** for living-book reading, and **Mastery Path** for structured learning-plan flows with per-topic mastery grading.

</details>

<details>
<summary><b>📚 Knowledge Center</b> — admin-only, multi-engine RAG libraries</summary>

Instructors' course materials are indexed here (LlamaIndex by default; GraphRAG, LightRAG, PageIndex, or a linked Obsidian vault are also available) and made available to Chat, Book, and Co-Writer as grounding context.

</details>

<details>
<summary><b>🧠 Memory</b> — inspectable, per-student personalization</summary>

A three-layer, file-backed memory system (raw event trace → curated per-surface facts → cross-surface synthesis) so a student's tutor genuinely gets to know how they learn over a term, and both the student and an instructor can see exactly why the tutor believes what it believes about them.

</details>

<details>
<summary><b>⚙️ Settings & Admin</b> — role-scoped control</summary>

Admins get the full control plane — models, knowledge bases, grants, user roster, and response-feedback review. Instructors get their own course-unit management pages (roster, requests, assignments, gradebook, notes) and nothing outside their own courses. Students get a course catalog, their assignments, their grades, and their notes — no settings surface at all.

</details>

## ⌨️ CLI

The `deeptutor` CLI is unmodified from upstream — `deeptutor chat` for an interactive REPL, `deeptutor run <capability> "<message>" --format json` for scriptable, NDJSON-streamed single turns any other agent can drive. Full command reference and agent-handoff recipes: [deeptutor.info/docs/cli](https://deeptutor.info/docs/cli/agent-handoff/).

## 🏗️ Architecture & Engineering Docs

The `devin-handoff/` folder is this fork's own engineering documentation, written for whoever picks this codebase up next (human or AI coding agent):

| Doc | What's in it |
|:---|:---|
| [`ARCHITECTURE_AND_COMPLETED_WORK.md`](devin-handoff/ARCHITECTURE_AND_COMPLETED_WORK.md) | The 3-role model, the course-unit/assignment/gradebook subsystem, how course notes cross instructor/student workspace boundaries, response feedback, and every established pattern worth reusing rather than reinventing. |
| [`DATABASE_MIGRATION_PLAN.md`](devin-handoff/DATABASE_MIGRATION_PLAN.md) | Why course data moved off flat JSON onto Postgres, the schema, and the phased migration plan. |
| [`EDGE_CASE_TESTING.md`](devin-handoff/EDGE_CASE_TESTING.md) | The regression matrix for the course-unit subsystem — cascade deletes, concurrency, role/ownership boundaries — re-run after any change that touches it. |
| [`TODO.md`](devin-handoff/TODO.md) | What's left, sized and scoped for pickup. |
| [`DEVIN_LOG.md`](devin-handoff/DEVIN_LOG.md) | Append-only record of what's actually been done, by whom, and how it was verified — the source of truth for status, not this README or the TODO list. |

## 🙏 Built on DeepTutor

This deployment is a fork of [**HKUDS/DeepTutor**](https://github.com/HKUDS/DeepTutor), an open-source project led by [Bingxi Zhao](https://github.com/pancacake) within the [HKUDS](https://github.com/HKUDS) Group. All of the underlying tutoring engine — the agent loop, knowledge bases, Book, Memory, Partners, the CLI — is upstream's work; this fork's own contribution is the course-management layer described above. For upstream release notes, community links, and the full general-purpose install guide, see the [upstream repository](https://github.com/HKUDS/DeepTutor) and [deeptutor.info](https://deeptutor.info).

<div align="center">

Licensed under the [Apache License 2.0](LICENSE).

</div>
