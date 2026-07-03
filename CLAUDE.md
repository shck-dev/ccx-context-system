# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Claude Code **plugin marketplace** repo whose single plugin, `ccx` (`plugins/ccx/`), provides scratch-notebook context management for any project: per-thread `STATE.md` handoff docs under `.scratch/<thread>/`, plus a compiled `INDEX.md` dashboard. Everything (scripts, hooks, tests) runs under **bun**, regardless of the host project's language.

## Commands

- **Tests:** `bun tests/run-tests.ts` — single-file scenario harness (no test framework; `ok()` assertions, exits non-zero on failure). It builds fresh fixture projects in a tmpdir each run (a fake Go project on stock config + a custom-config project) and exercises every script and the backlink hook. There is no per-test runner; run the whole file.
- **Validate plugin structure:** `claude plugin validate ./plugins/ccx` (and `claude plugin validate .` for the marketplace).
- **Try changes live in one session:** `claude --plugin-dir ./plugins/ccx`.
- **Refresh an installed copy after edits:** `/plugin marketplace update ccx-context-system` (or restart the session).

## Architecture

Three layers, all under `plugins/ccx/`:

1. **Skills** (`skills/*/SKILL.md`) — `start-thread`, `save-state`, `tidy-scratch`. Markdown with frontmatter; they inject live data at load time via `` !`bun "${CLAUDE_PLUGIN_ROOT}/scripts/<x>.ts"` `` preamble commands, then instruct the model. Skills never re-implement logic that scripts own (e.g. slugging goes through `slug.ts`).
2. **Scripts** (`scripts/*.ts`) — deterministic bun CLIs the skills call: `where.ts` (resolved context), `threads.ts` / `orphans.ts` / `scan.ts` (read-only scans), `slug.ts`, `compile-index.ts` (the INDEX compiler).
3. **Hooks** (`hooks/hooks.json` → scripts) — `backlink-scratch-notes.ts` (PostToolUse on Write: prepends a `[[STATE]]` wikilink to new unlinked scratch notes). Hooks read the tool-call JSON from stdin and **fail open** — any parse error or unexpected input → `exit 0`; a hook must never crash the session.

### Load-bearing seams

- **`scripts/lib/config.ts`** — the ONE place paths/settings resolve. Reads optional `methodology.config.json` at the target project root; every field has a default, malformed config → defaults. Project root = `CLAUDE_PROJECT_DIR` env var, else cwd. All scripts and hooks go through `loadConfig()` — never hardcode `.scratch`/`STATE.md`/`INDEX.md` names.
- **`scripts/lib/identity.ts`** — the ONE place thread identity (topic → slug) lives. Future ticket-system adapters (`linear`/`github`) extend this module; nothing else may re-implement identity.

### Concurrency model (why the INDEX is compiled)

The INDEX is a **pure render** of each thread's STATE frontmatter (`kind` + `summary`) + live git state, written atomically (tmp+rename) by `compile-index.ts`. Per-thread STATE files are the conflict-free partition across parallel sessions; concurrent compiles converge to identical bytes (the tests assert double-compile is byte-identical). Never make the INDEX hand-edited or incrementally patched — that reintroduces last-writer-wins data loss, the exact failure this design exists to prevent.

## Conventions

- Scripts read the clock at run time (`scan.ts`, date stamps) — never hardcode dates.
- `tidy-scratch` is the only skill allowed to propose destructive actions, and only after a dry-run plan + user confirmation; folders with a STATE doc are archived, never deleted.
- Skills reference bundled scripts via `${CLAUDE_PLUGIN_ROOT}`, with the `where.ts`-printed plugin root as fallback.
- Plugin metadata lives in `plugins/ccx/.claude-plugin/plugin.json`; the marketplace manifest is `.claude-plugin/marketplace.json`. Bump the plugin `version` when shipping changes.
