// PostToolUse(Write|Edit) hook — the INDEX saves itself. Whenever a thread's STATE doc is written
// or edited (any session), kick a DETACHED compile-index.ts run so the INDEX is current the moment
// a STATE changes — save-state is no longer load-bearing for freshness, just the on-demand dashboard.
//
// Debounce: a shared `.pending` lock under <scratch_root>/.sessions/ (10s window) — N quick STATE
// writes → ≤1 compile; the compile re-reads ALL STATEs at run time, so a skipped kick's change is
// picked up by the in-flight run or the next one. The compiler is a pure render + atomic tmp+rename
// write, so concurrent kicks from parallel sessions converge (see compile-index.ts).
//
// Fail open + silent: any parse error or non-matching input → exit 0, empty stdout. Never blocks
// the tool call, never nags. CCX_AUTOCOMPILE_SYNC=1 runs the compile synchronously (tests only).

import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, projectRoot } from "./lib/config";

const raw = await Bun.stdin.text();
let d: any;
try {
  d = JSON.parse(raw || "{}");
} catch {
  process.exit(0);
}

const tool = String(d?.tool_name ?? "");
if (tool !== "Write" && tool !== "Edit") process.exit(0);

const fp = String(d?.tool_input?.file_path ?? "");
if (!fp) process.exit(0);

const ROOT = projectRoot();
const cfg = loadConfig(ROOT);

// Must be <scratch_root>/<thread>/<state_basename>, exactly one level deep, thread not hidden and
// not the archive dir. Match on path segments (handles absolute paths and worktree-relative ones
// whose `.scratch` symlink resolves into the main checkout).
const segs = fp.replace(/\\/g, "/").split("/").filter(Boolean);
const rootSegs = cfg.scratch_root.split("/");
let hit = false;
for (let i = 0; i + rootSegs.length + 2 <= segs.length; i++) {
  if (rootSegs.every((s, k) => segs[i + k] === s)) {
    const thread = segs[i + rootSegs.length];
    const base = segs[i + rootSegs.length + 1];
    if (
      base === cfg.state_basename &&
      i + rootSegs.length + 2 === segs.length &&
      !thread.startsWith(".") &&
      thread !== cfg.archive_dir
    )
      hit = true;
    break;
  }
}
if (!hit) process.exit(0);

const sessDir = join(ROOT, cfg.scratch_root, ".sessions");
const pending = join(sessDir, ".index-compile.pending");
try {
  if (Date.now() - statSync(pending).mtimeMs < 10_000) process.exit(0); // compile kicked <10s ago
} catch {
  /* no lock — proceed */
}

try {
  mkdirSync(sessDir, { recursive: true });
  const compiler = join(import.meta.dir, "compile-index.ts");
  if (process.env.CCX_AUTOCOMPILE_SYNC) {
    Bun.spawnSync([process.execPath, compiler], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT } as Record<string, string>,
      cwd: ROOT,
    });
  } else {
    // process.execPath IS the bun binary (hooks run under bun) — no PATH gamble in the detached shell.
    const cmd = `touch '${pending}'; '${process.execPath}' '${compiler}' >/dev/null 2>&1; rm -f '${pending}'`;
    Bun.spawn(["sh", "-c", cmd], {
      cwd: ROOT,
      env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT } as Record<string, string>,
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    }).unref();
  }
} catch {
  /* best-effort; never break the tool call */
}

process.exit(0);
