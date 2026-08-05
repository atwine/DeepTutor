<!--
Thank you for contributing to DeepTutor! 🚀

## Branching Workflow

This repo uses a four-stage promotion flow:

```
feature/*  →  development  →  staging  →  main
```

- **Feature branches** should fork from `development` and target
  `development` in their PR. Do NOT open PRs against `main` or
  `staging` directly.
- **`main`** is protected — only receives promotions from `staging`
  via a PR. No direct pushes.
- See [AGENTS.md](https://github.com/atwine/DeepTutor/blob/development/AGENTS.md)
  for the full branching workflow and architecture overview.
-->

### Description
*A clear and concise description of the changes.*

### Related Issues
- Closes #...
- Related to #...

### Module(s) Affected
- [ ] `agents`
- [ ] `api`
- [ ] `config`
- [ ] `core`
- [ ] `knowledge`
- [ ] `learning`
- [ ] `logging`
- [ ] `services`
- [ ] `tools`
- [ ] `utils`
- [ ] `web` (Frontend)
- [ ] `docs` (Documentation)
- [ ] `scripts`
- [ ] `tests`
- [ ] Other: `...`

### Checklist
- [ ] My branch is forked from `development` (not `main`).
- [ ] My code follows the project's coding standards.
- [ ] I have run `ruff check .` and `ruff format --check .` and fixed any issues.
- [ ] I have added relevant tests for my changes.
- [ ] I have added/updated docstrings (Google-style for Python, TSDoc for TypeScript).
- [ ] My changes do not introduce any new security vulnerabilities.

### Additional Notes
*Add any other context or screenshots about the pull request here.*
