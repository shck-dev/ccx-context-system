# ccx — portable notebook core

Context management for **any** project (any language, no ticket system required): each unit of
work gets a `.scratch/<thread>/STATE.md` handoff doc that survives context loss; a compiled
`INDEX.md` is the single-pane "what's in flight" dashboard across many parallel threads.

Extracted from a production setup where the methodology ran for weeks across ~30 threads.

## What you get

| Piece | What it does |
|---|---|
| `/ccx:start-thread <topic>` | **Create-or-resume**: scaffolds `.scratch/<slug>/STATE.md`, or — if the thread exists — resumes it with a briefing (STATE + live git/PR deltas). One command, day 1 or day 20 |
| `/ccx:save-state` | The dashboard: refresh STATE frontmatter → compile INDEX → ≤6-line summary |
| `/ccx:tidy-scratch` | Date-aware GC: dry-run plan → confirm → archive/delete → reindex |
| `backlink-scratch-notes` hook | Auto-clusters new notes under their thread's STATE (Obsidian graph hygiene) |
| `auto-compile-index` hook | The INDEX saves itself: any STATE write triggers a detached, debounced recompile — forgetting `/ccx:save-state` loses nothing |
| `record-session-thread` + `state-freshness-guard` hooks | A session opened with `/ccx:start-thread` can't end with a stale STATE: stopping with work newer than the STATE doc blocks once with "persist Status/summary first" (throttled 30 min; `SKIP_STATE_GUARD=1` to disable) |

**Prerequisite:** `bun` on PATH.

## Concurrency model (why the INDEX is compiled)

Parallel Claude sessions each hand-rewriting a shared INDEX = last-writer-wins data loss
(empirically 18/20 threads dropped in the source setup). Here the INDEX is a **pure render** of
each thread's STATE frontmatter (`kind` + `summary`) + live git, written atomically — concurrent
compiles converge; per-thread STATE files are the conflict-free partition. **Never hand-edit the
INDEX**; keep `summary:` current and re-run `/ccx:save-state`.

## Configuration (optional)

Zero-config works. To customize, commit `methodology.config.json` at the project root:

```jsonc
{
  "scratch_root": ".scratch",        // notebook root
  "state_basename": "STATE.md",      // per-thread handoff doc
  "index_basename": "INDEX.md",      // compiled dashboard
  "archive_dir": "_archive",         // retired threads (skipped by scans)
  "ticket_system": "none",           // v1: none (linear/github adapters are future work)
  "oneoff_script_runner": "bun",     // referenced in scaffolded STATE docs
  "index_title": null,               // INDEX H1; null → project dir name
  "script_extensions": ["ts", "js", "mjs", "cjs", "py", "sh"],  // what scan counts as a script
  "extra_sections": []               // live INDEX sections: [{"title": "Environment", "command": "bun scripts/env.ts"}]
}
```

`extra_sections` lets a project inject live sections into the compiled INDEX (environment
probes, service health, anything a command can print). Each command runs at compile time with
a 5s cap; empty or failing output omits the section. Note the INDEX stays a pure render — if
your command's output varies run-to-run, so will those INDEX bytes.

## Obsidian (optional but recommended)

Open the scratch dir as a vault — threads cluster under their STATE, STATEs link to INDEX:
- Install the **Front Matter Title** community plugin so graph nodes show each thread's
  `title:` (seeded by `/ccx:start-thread`) instead of a sea of "STATE".
- Exclude the archive from the graph: set the graph search filter to `-path:_archive`.

## Versioning your notebook?

`/ccx:start-thread` checks whether the scratch root is git-ignored and **asks** — some people
want notes versioned, some never want them near a PR. Your call, made explicit once.

## Deliberately not included (v1)

- A status line (the "which thread is this session on" bar) — plugins can't ship a main-thread
  `statusLine`; add-later as a documented snippet if missed.
- Ticket-system adapters (`linear`/`github`) — the identity seam (`scripts/lib/identity.ts`) is
  where they'd slot.
- Worktree/PR workflow tooling — stayed in the source repo; this is the notebook core only.
