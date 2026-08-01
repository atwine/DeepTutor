# Handoff: DeepTutor for BigDataClass-ACE

This folder exists so two agents (Claude, working with the repo owner interactively;
Devin, working async) can collaborate on the same fork without duplicating work or
stepping on each other. Read in this order:

1. **`ARCHITECTURE_AND_COMPLETED_WORK.md`** — what this deployment actually is, how it's
   built, and a technical walkthrough of every non-trivial piece added on top of upstream
   DeepTutor. Written assuming you can read the code yourself; it's oriented at *why* and
   *where*, not a line-by-line diff.
2. **`TODO.md`** — everything known to be left, each item framed with enough technical
   context to start without re-deriving it from scratch.
3. **`DEVIN_LOG.md`** — a running log. **Append to this, don't overwrite it.** Every time
   you finish (or partially finish, or decide not to do) something from `TODO.md`, add a
   dated entry: what you changed, what you verified, what you deliberately left alone and
   why, and any new findings that change the picture in `ARCHITECTURE_AND_COMPLETED_WORK.md`.
   This is the mechanism that lets Claude and Devin work in parallel without a live sync —
   Claude will read this log before starting new work each session.

## Ground rules for parallel work

- **This is a real, currently-deployed instance**, not a sandbox — a research/teaching
  platform for Data Science and Bioinformatics courses at ACE, self-hosted on A100 GPUs via
  vLLM, with real instructor and student accounts. Treat `data/` (gitignored) as live state;
  never treat it as fixture data to reset casually.
- **Docker is the deployment mechanism.** `docker compose -f docker-compose.yml build deeptutor`
  then `docker compose -f docker-compose.yml up -d` from the repo root. Never use
  `docker-compose.dev.yml` for anything you intend to keep running — building it with
  `--build` retags the *same* image name (`deeptutor-deeptutor:latest`) to the `development`
  target and silently overwrites the production build. This bit a previous session; don't
  repeat it.
- **Test with real accounts, verify live, clean up, then commit.** Every phase in this
  project's history followed: create temp instructor/student accounts → exercise the feature
  through the actual browser UI or a direct `fetch()`/API call → confirm the DB-level
  behavior (not just that a 200 came back) → delete the temp accounts/sessions/course
  units created for the test → *then* commit. Don't skip the live-verification step; this
  codebase has a real history of bugs that only show up at the integration level (see the
  route-shadowing and INSERT/SELECT-column-list gotchas in `ARCHITECTURE_AND_COMPLETED_WORK.md`).
- **One-off test scripts run as the app user, not root:**
  `docker exec -u deeptutor deeptutor python3 -c "..."`. A script run as plain `docker exec`
  (root) creates root-owned files under `data/` that the app's non-root user can no longer
  write to — this has caused real outages twice this project and looks exactly like an
  unrelated permissions bug until you trace it back.
- **Commit messages explain *why*, not *what*** — the diff already shows what changed. Look
  at recent `git log` on this repo for the house style before writing your own.
- **Don't rename, don't restructure, don't refactor incidentally.** Every existing pattern in
  this repo (see "Established patterns to reuse" in `ARCHITECTURE_AND_COMPLETED_WORK.md`) was
  chosen to match something already used elsewhere in the codebase. Prefer extending an
  existing pattern over introducing a new one, even if you'd design it differently from
  scratch.
- **Push only when asked.** The owner reviews and explicitly says "push" before anything
  goes to `origin/main` (`atwine/DeepTutor`). Commit locally as you go; don't assume push
  authorization carries over between sessions.
