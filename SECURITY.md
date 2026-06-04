# Security

- **Reporting:** report vulnerabilities privately via GitHub Security Advisories
  ("Report a vulnerability" on this repo), not public issues.
- **Supported version:** the latest release / `main`.
- **Scope:** ccx ships bun scripts and two Claude Code hooks that run locally with your user
  permissions. They read/write only the project's scratch notebook and INDEX, and make no
  network calls beyond local `git`/`gh` invocations (worktree/PR listings for the dashboard).
