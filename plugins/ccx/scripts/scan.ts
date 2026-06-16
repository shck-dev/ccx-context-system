// Date-aware scanner for tidy-scratch. Emits one TSV row per thread folder with the signals the
// GC needs: whether it carries a STATE (handoff value), file/script counts, and the age of its
// NEWEST file (= "last actually worked on" — a better signal than the dir's own mtime).
//
// Reads the clock at run time — never hardcodes a date — so ages are correct whenever it runs.
// Portable: fs.statSync only (GNU `find -printf` is unavailable on macOS). Skips the archive dir
// (already retired) and dot-dirs (.obsidian, .sessions — vault/session plumbing, not threads).

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, projectRoot } from "./lib/config";

const root = projectRoot();
const cfg = loadConfig(root);
const SCRATCH = join(root, cfg.scratch_root);
const SCRIPT = new RegExp(`\\.(${cfg.script_extensions.join("|")})$`);
const now = Date.now();

let top: string[];
try {
  top = readdirSync(SCRATCH);
} catch {
  console.log(`# ${cfg.scratch_root} not found — nothing to scan`);
  process.exit(0);
}

// Newest mtime + file/script counts across the whole subtree (iterative walk, no recursion limit).
const walk = (dir: string) => {
  let newest = 0,
    files = 0,
    scripts = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        stack.push(p);
        continue;
      }
      files++;
      if (SCRIPT.test(e.name)) scripts++;
      try {
        const m = statSync(p).mtimeMs;
        if (m > newest) newest = m;
      } catch {}
    }
  }
  return { newest, files, scripts };
};

type Row = { slug: string; hasState: boolean; files: number; scripts: number; ageDays: number; last: string };
const rows: Row[] = [];

for (const slug of top) {
  if (slug.startsWith(".") || slug === cfg.archive_dir) continue;
  const dir = join(SCRATCH, slug);
  try {
    if (!statSync(dir).isDirectory()) continue;
  } catch {
    continue;
  }

  let hasState = false;
  try {
    hasState = statSync(join(dir, cfg.state_basename)).isFile();
  } catch {}

  const { newest, files, scripts } = walk(dir);
  const ageDays = newest ? Math.floor((now - newest) / 86_400_000) : -1;
  const last = newest ? new Date(newest).toISOString().slice(0, 10) : "(empty)";
  rows.push({ slug, hasState, files, scripts, ageDays, last });
}

rows.sort((a, b) => b.ageDays - a.ageDays); // stalest first

const stamp = new Date(now).toISOString().slice(0, 16).replace("T", " ");
console.log(`# scanned ${rows.length} folders · now=${stamp} UTC`);
console.log(`# slug\tSTATE\tfiles\tscripts\tlast_edit\tage_days`);
for (const r of rows) {
  console.log(`${r.slug}\t${r.hasState ? "yes" : "NO"}\t${r.files}\t${r.scripts}\t${r.last}\t${r.ageDays}`);
}
