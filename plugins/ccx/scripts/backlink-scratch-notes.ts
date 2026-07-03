// PostToolUse(Write) — keep the Obsidian graph a clean hierarchy. When a new scratch NOTE is
// written (<scratch_root>/<thread>/<note>.md, excluding the STATE/INDEX docs), if it has no
// [[wikilink]] yet, prepend a one-line breadcrumb linking it to its thread's STATE hub (which
// itself links INDEX) — so the note CLUSTERS under its thread instead of spoking off INDEX.
// Falls back to [[INDEX]] only when the dir has no STATE hub. Additive prepend only (never
// rewrites existing lines); no-ops if the note already links anywhere. Disable via /hooks.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { loadConfig } from "./lib/config";

const raw = await Bun.stdin.text();
let data: any;
try {
  data = JSON.parse(raw || "{}");
} catch {
  process.exit(0);
}
if (data?.tool_name !== "Write") process.exit(0);

const fp: string = data?.tool_input?.file_path ?? "";
if (!fp) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR || data?.cwd || process.cwd();
const cfg = loadConfig(root);

// Anchored: only notes under THIS project's scratch root, exactly one thread-dir deep.
const scratchAbs = resolve(root, cfg.scratch_root);
const fpAbs = resolve(root, fp);
if (!fpAbs.startsWith(scratchAbs + sep)) process.exit(0);
const rel = fpAbs.slice(scratchAbs.length + 1).split(sep);
if (rel.length !== 2) process.exit(0); // top-level or nested — not a thread note
const [dir, name] = rel;
if (dir === cfg.archive_dir || dir.startsWith(".")) process.exit(0); // archive + vault plumbing
if (!name.endsWith(".md")) process.exit(0);
const base = name.slice(0, -3);
const stateLink = cfg.state_basename.replace(/\.md$/, "");
const indexLink = cfg.index_basename.replace(/\.md$/, "");
if (base === stateLink || base === indexLink) process.exit(0);

let content = "";
try {
  content = readFileSync(fpAbs, "utf8");
} catch {
  process.exit(0);
}
if (content.includes("[[")) process.exit(0); // already part of the graph — leave it

// Clean hierarchy: link the thread's STATE hub if it exists (STATE → INDEX carries the spine);
// only fall back to [[INDEX]] for a dir with no STATE.
const dirAbs = join(scratchAbs, dir);
const hasState = existsSync(`${dirAbs}/${cfg.state_basename}`);
const target = hasState ? `[[${stateLink}]]` : `[[${indexLink}]]`;

try {
  writeFileSync(fpAbs, `> ${target}\n\n` + content);
} catch {
  process.exit(0);
}
console.log(
  JSON.stringify({ systemMessage: `ccx graph: clustered ${dir}/${base} → ${target} (no orphan leaf).` }),
);
process.exit(0);
