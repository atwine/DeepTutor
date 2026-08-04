# deeptutor/services/ — Service Layer

## Overview

The `services/` package contains all infrastructure and integration
modules that the core agent runtime depends on. These are **not**
capabilities or tools themselves — they provide the storage, config,
external API clients, and platform integrations that the rest of the
system uses.

## Subpackages

| Package | Purpose |
|---------|---------|
| `config/` | Runtime settings (JSON files + env overrides), model catalog |
| `cli_apps/` | Installed CLI application management (Codex, Claude Code, etc.) |
| `codex_auth/` | OAuth flow for Codex/external service authentication |
| `cron/` | Scheduled task execution and cron expression parsing |
| `db/` | SQLAlchemy async ORM — course units, assignments, submissions, enrollments |
| `embedding/` | Embedding model clients (OpenAI, local, etc.) |
| `imagegen/` | Image generation provider integrations |
| `llm/` | LLM provider clients (OpenAI, Anthropic, local, etc.) |
| `mcp/` | Model Context Protocol client for external tool servers |
| `memory/` | Long-term memory store (consolidation, dedup, retrieval) |
| `model_selection/` | Model routing and fallback logic |
| `notebook/` | Jupyter notebook parsing and execution |
| `parsing/` | Document extraction (PDF, DOCX, PPTX, etc.) |
| `partners/` | Partner channel integrations (Matrix, Discord, Slack, etc.) |
| `persona/` | Persona configuration and management |
| `prompt/` | Prompt template loading and rendering |
| `rag/` | Retrieval-augmented generation (LightRAG integration, file routing) |
| `sandbox/` | Code execution sandboxing (bwrap, runner sidecar) |
| `search/` | Web and paper search clients |
| `session/` | Chat session persistence (SQLite store) |
| `settings/` | User settings storage and migration |
| `setup/` | First-run setup and bootstrap |
| `skill/` | Skill definition and loading |
| `storage/` | File storage abstractions |
| `subagent/` | Sub-agent spawning and management |
| `videogen/` | Video generation provider integrations |
| `voice/` | Voice/speech-to-text and text-to-speech |

## Key Patterns

- **Async-first**: Most services use `async/await` with asyncio.
  Database access is via SQLAlchemy async sessions.
- **Settings-driven**: Service configuration lives in
  `data/user/settings/*.json`, loaded via `config/runtime_settings.py`.
  Environment variables override JSON settings.
- **Provider-agnostic**: LLM, embedding, search, and other external
  services use provider-agnostic interfaces with swappable backends.
- **File-based storage**: Most persistent state lives under `data/`
  (user workspaces, knowledge bases, memory, session history).

## Dependencies

This package sits below the core runtime (`deeptutor/core/`,
`deeptutor/runtime/`) and above external libraries. It does NOT
import from `deeptutor/capabilities/` or `deeptutor/tools/` —
those depend on services, not the other way around.
