// Stop hook — a thread's STATE doc can't silently go stale. When a session ASSOCIATED with a
// thread (via record-session-thread → <scratch_root>/.sessions/<sid>.json) tries to stop while
// there is work NEWER than that thread's STATE — files touched in the thread dir, dirty files in a
// matching git worktree, or commits unique to its branch — it blocks the stop ONCE and tells the
// model to persist the working state (Status line + frontmatter summary) first. The STATE write
// then triggers auto-compile-index, so: work → STATE (forced) → INDEX (auto), zero commands.
//
// Deliberately hard to hate:
//   • no associated thread → silent pass (never nags a casual session)
//   • stop_hook_active → pass (block at most once per stop-chain — structurally cannot loop)
//   • STATE touched within GRACE → pass (just updated; a trailing note doesn't re-trip)
//   • ≤1 nudge per THROTTLE window per session (timestamp stamped into the session json)
//   • escape hatch: SKIP_STATE_GUARD=1
// Fail open: parse error / missing files → exit 0. Silent on the pass path.

import { existsSync, lstatSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig, projectRoot } from "./lib/config";
import { normalizeForMatch } from "./lib/identity";

export const GRACE = 10 * 60_000;
export const THROTTLE = 30 * 60_000;

export type GuardInput = {
  skip: boolean;
  stopHookActive: boolean;
  slug: string | null;
  stateMtime: number | null;
  newestWork: number;
  lastNudge: number;
  now: number;
};

export function decide(i: GuardInput): { block: false } | { block: true; reason: string } {
  if (i.skip || i.stopHookActive || !i.slug || i.stateMtime === null) return { block: false };
  if (i.newestWork <= i.stateMtime) return { block: false }; // STATE is the newest thing — fresh
  if (i.now - i.stateMtime < GRACE) return { block: false }; // just updated
  if (i.now - i.lastNudge < THROTTLE) return { block: false }; // already nudged recently
  return {
    block: true,
    reason:
      `Working state drifted: there is work newer than the "${i.slug}" thread's STATE doc ` +
      `(thread files, worktree changes, or commits). Before stopping, update that STATE: refresh ` +
      `the **Status:** line (one line, live working state, as-of date) and the frontmatter ` +
      `\`summary:\` to match — then stop. Do NOT rewrite history sections; just bring the live ` +
      `state current. (Guard fires at most once per 30 min; escape: SKIP_STATE_GUARD=1.)`,
  };
}

function git(cwd: string, args: string[]): string {
  try {
    const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 4000 });
    if (r.status === 0) return (r.stdout || "").trim();
  } catch {
    /* ignore */
  }
  return "";
}

/** Newest mtime under a thread dir — skips symlinks, dotfiles, and the STATE doc itself. */
export function newestThreadFile(threadDir: string, stateBasename: string): number {
  let newest = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > 6) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      if (dir === threadDir && name === stateBasename) continue;
      const p = join(dir, name);
      let st: ReturnType<typeof lstatSync>;
      try {
        st = lstatSync(p);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        walk(p, depth + 1);
        continue;
      }
      if (st.mtimeMs > newest) newest = st.mtimeMs;
    }
  };
  walk(threadDir, 0);
  return newest;
}

/** The repo's default integration branch, as origin sees it (origin/main | origin/master | …). */
function defaultRef(cwd: string): string {
  const head = git(cwd, ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]);
  if (head) return head;
  for (const ref of ["origin/main", "origin/master", "origin/develop"])
    if (git(cwd, ["rev-parse", "--verify", "-q", ref])) return ref;
  return "";
}

/** Worktrees whose dir basename or branch matches the slug (identity's loose-match rule). */
export function matchingWorktrees(root: string, slug: string): string[] {
  const key = normalizeForMatch(slug);
  if (!key) return [];
  const out: string[] = [];
  let cur: { path?: string; branch?: string } = {};
  const flush = () => {
    if (!cur.path || cur.path === root) return;
    const byDir = normalizeForMatch(basename(cur.path)).includes(key);
    const byBranch = normalizeForMatch(cur.branch || "").includes(key);
    if (byDir || byBranch) out.push(cur.path);
  };
  for (const line of git(root, ["worktree", "list", "--porcelain"]).split("\n")) {
    if (line.startsWith("worktree ")) {
      flush();
      cur = { path: line.slice(9).trim() };
    } else if (line.startsWith("branch ")) cur.branch = line.slice(7).replace("refs/heads/", "").trim();
  }
  flush();
  return out;
}

/** Newest work signal in one worktree: dirty-file mtimes + committer time of commits unique to the
 *  branch (unique-only, so the default branch's own fresh merges can't false-positive). */
export function newestWorktreeWork(wtDir: string): number {
  if (!existsSync(wtDir)) return 0;
  let newest = 0;
  for (const line of git(wtDir, ["status", "--porcelain"]).split("\n")) {
    const f = line.slice(3).trim().replace(/^"|"$/g, "");
    if (!f) continue;
    try {
      const st = lstatSync(join(wtDir, f.includes(" -> ") ? f.split(" -> ")[1] : f));
      if (!st.isSymbolicLink() && st.mtimeMs > newest) newest = st.mtimeMs;
    } catch {
      /* deleted file — no mtime; skip */
    }
  }
  const base = defaultRef(wtDir);
  if (base) {
    const ct = git(wtDir, ["log", `${base}..HEAD`, "-1", "--format=%ct"]);
    if (/^\d+$/.test(ct)) newest = Math.max(newest, parseInt(ct, 10) * 1000);
  }
  return newest;
}

if (import.meta.main) {
  const raw = await Bun.stdin.text();
  let d: any;
  try {
    d = JSON.parse(raw || "{}");
  } catch {
    process.exit(0);
  }

  const ROOT = projectRoot();
  const cfg = loadConfig(ROOT);
  const sid = String(d?.session_id ?? "").trim();

  let sess: any = null;
  const sessFile = join(ROOT, cfg.scratch_root, ".sessions", `${sid}.json`);
  try {
    if (sid && existsSync(sessFile)) sess = JSON.parse(readFileSync(sessFile, "utf8"));
  } catch {
    /* ignore */
  }
  const slug: string | null = sess?.slug ? String(sess.slug) : null;

  let stateMtime: number | null = null;
  if (slug) {
    try {
      stateMtime = statSync(join(ROOT, cfg.scratch_root, slug, cfg.state_basename)).mtimeMs;
    } catch {
      /* no STATE → null → pass */
    }
  }

  let newestWork = 0;
  if (slug) {
    newestWork = newestThreadFile(join(ROOT, cfg.scratch_root, slug), cfg.state_basename);
    for (const wt of matchingWorktrees(ROOT, slug))
      newestWork = Math.max(newestWork, newestWorktreeWork(wt));
  }

  const verdict = decide({
    skip: !!process.env.SKIP_STATE_GUARD,
    stopHookActive: !!d?.stop_hook_active,
    slug,
    stateMtime,
    newestWork,
    lastNudge: Number(sess?.stateGuardNudge ?? 0),
    now: Date.now(),
  });

  if (verdict.block) {
    try {
      writeFileSync(sessFile, JSON.stringify({ ...sess, stateGuardNudge: Date.now() }));
    } catch {
      /* best-effort throttle */
    }
    console.log(JSON.stringify({ decision: "block", reason: verdict.reason }));
  }
  process.exit(0);
}
