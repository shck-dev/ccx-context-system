# ccx: create-or-resume + the self-saving notebook (port spec)

**Status:** planned — pattern shipped and verified 2026-07-10 in the host project
(`rjf-auto-apply-microservice`, a private repo using ccx-style local skills/hooks); this doc is the
source of truth for porting it into the `ccx` plugin.

## The problem (as the user put it)

1. *"There is no way to continue a thread in a new session — it checks the thread exists and asks
   remove-or-keep?? Obviously I want one-click continue."* `start-thread` step 3 today: existing
   STATE → **STOP, offer to open it**. Exists is treated as an error; it's actually the normal
   day-2 path.
2. *"I don't like that if I forget to run the command, everything is gone."* INDEX freshness depends
   on remembering `/ccx:save-state`; STATE content freshness depends on the model remembering to
   update it before the session dies. Forgetting either silently loses working state.

## What shipped in the host project (verified, 28/28 harness + live checks)

Four pieces; the first and the last three are independent, but together they close the loop:
**work → STATE (forced at stop) → INDEX (auto) → resume briefing (next session)** — zero commands
to remember.

### 1. `start-thread` becomes idempotent create-or-resume

Existing STATE → **RESUME mode** (no questions, no "want me to open it?" menu):

- Read the whole STATE doc (Status, ask, plan, current state, open/deferred).
- Pull live deltas, each optional-degrade (unreachable source → say so, move on, never stall):
  in the host that's ticket status + worktree/branch + PR state + dirty files; in stock ccx
  (`ticket_system: none`) it's the git side only — current branch, a `git worktree list` /
  `git branch --list` match on the slug, dirty files, and `gh pr list --head <branch>` if `gh`
  resolves.
- Report a **resume briefing**: where the user left off → what changed since → explicitly flag any
  live fact that CONTRADICTS the STATE. End ready to work, not with a menu.
- Resume is **read-only on the STATE doc** — never re-scaffold, never overwrite; drift gets flagged,
  and the session (plus the Stop guard, piece 4) updates STATE as work proceeds.
- The near-match rule stays: a slug matching an existing thread ignoring case/separators
  (`normalizeForMatch` in `scripts/lib/identity.ts`) resumes THAT thread the same way.

### 2. `auto-compile-index` hook — the INDEX saves itself

PostToolUse(`Write|Edit`): when the touched file is `<scratch_root>/<thread>/<state_basename>`
(one level deep, not `archive_dir`), kick a **detached** `compile-index.ts` run, debounced by a
shared `.pending` lock file (~10s window). The compiler is already a pure render + atomic
tmp+rename write, so concurrent kicks from parallel sessions converge. `save-state` demotes to the
on-demand dashboard — no longer load-bearing for freshness.

Host reference: `.claude/hooks/auto-compile-index.ts` (exports pure `shouldCompile(toolName, path)`
for tests; `import.meta.main`-guarded side effects; silent — exits 0 with empty stdout, never nags).

### 3. Session↔thread association (prerequisite for 4)

A `UserPromptExpansion` hook (matcher on the thread-opening command names) records
`{display, slug, source, ts}` to `<scratch_root>/.sessions/<session_id>.json`. The host verified
`command_name`/`command_args` arrive pre-parsed on this event (real literals in the shipped 2.1.x
binary). For ccx the matcher targets `ccx:start-thread` (confirm the plugin-namespaced
`command_name` shape against a live expansion dump before trusting it — same
"confirm AI-looking specs against the source" rule). `.sessions/` must be excluded from scans,
tidy, and the compiler (dot-dirs already are).

### 4. `state-freshness-guard` Stop hook — STATE can't silently go stale

On Stop: session has an associated thread + there exists work NEWER than its STATE doc →
`{"decision":"block"}` with a reason telling the model to refresh the **Status:** line + frontmatter
`summary:` first, then stop.

- **Work signals** (max of): newest mtime under the thread dir (recursive, skip symlinks/dotfiles,
  exclude the STATE doc itself); if a git worktree matches the slug — dirty-file mtimes
  (`git status --porcelain`, stat each) + committer time of commits unique to the branch
  (`origin/<default>..HEAD -1 --format=%ct`; scoping to unique commits stops the default branch's
  own fresh merges from false-positiving). Worktree discovery for ccx: match `git worktree list
  --porcelain` entries whose dir basename or branch normalizes to the slug — do NOT hardcode the
  host's `.claude/worktrees/` convention.
- **Deliberately hard to hate:** no associated thread → silent pass; `stop_hook_active` → pass
  (≤1 block per stop-chain — structurally cannot loop); GRACE 10 min (a STATE updated moments ago +
  one trailing note doesn't re-trip); THROTTLE 30 min per session (nudge timestamp stamped into the
  session json); `SKIP_STATE_GUARD=1` env escape.
- Decision logic is a **pure exported `decide(input)`** — the host's 12-case decision table ports
  directly into `tests/run-tests.ts`, plus a real-process e2e on a tmpdir fixture (block → throttle
  → `stop_hook_active` → unassociated → env-escape, 6 cases).

## ccx-idiom requirements (non-negotiable seams)

- All paths through `loadConfig()` — no hardcoded `.scratch`/`STATE.md`/`INDEX.md` anywhere.
- Slug matching only via `scripts/lib/identity.ts`.
- Hooks fail open (parse error / weird input → exit 0) and stay silent on the pass path.
- Skills never re-implement script logic; new deterministic pieces are `scripts/*.ts` CLIs or hook
  scripts, with pure decision functions exported for the test harness.
- `hooks/hooks.json` gains the PostToolUse(`Write|Edit`), `UserPromptExpansion`, and `Stop` entries
  via `${CLAUDE_PLUGIN_ROOT}`.
- Tests: extend `tests/run-tests.ts` (fixture projects in tmpdir; assert double-compile stays
  byte-identical with the new hook in play).
- Version bump (0.3.0 → 0.4.0 — three new hooks + a skill behavior change is a feature release).

## Host-project layering (context, not ccx scope)

After this ships, the host project deletes its local copies (auto-compile + freshness hooks, its
`save-state`/`tidy-scratch` duplicates, backlink hook, compile-index lib) and keeps only thin
addons: ticket-system grounding on top of `start-thread`, its worktree conventions, status line +
infra probes (as `extra_sections` / local hooks). That migration is tracked in the host repo's meta
notebook, not here.

## Verification evidence (host, 2026-07-10)

- Harness: 28/28 — `decide` table (12), `shouldCompile` matcher (9), thread-dir mtime semantics,
  6-case real-process e2e incl. throttle persistence.
- Live: a hook kick recompiled the real INDEX (mtime + header moved); worktree work-signal probed
  on 3 real worktrees + a missing dir; resume health commands dry-run green on a real
  worktree/PR.
