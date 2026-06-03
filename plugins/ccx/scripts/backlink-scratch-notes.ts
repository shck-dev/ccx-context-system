// PostToolUse(Write) — keep the Obsidian graph a clean hierarchy. When a new scratch NOTE is
// written (<scratch_root>/<thread>/<note>.md, excluding the STATE/INDEX docs), if it has no
// [[wikilink]] yet, prepend a one-line breadcrumb linking it to its thread's STATE hub (which
// itself links INDEX) — so the note CLUSTERS under its thread instead of spoking off INDEX.
// Falls back to [[INDEX]] only when the dir has no STATE hub. Additive prepend only (never
// rewrites existing lines); no-ops if the note already links anywhere. Disable via /hooks.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

const cfg = loadConfig(process.env.CLAUDE_PROJECT_DIR || data?.cwd || process.cwd());
if (fp.includes(`/${cfg.archive_dir}/`)) process.exit(0); // archived notes are retired — leave them

// Must be a note inside a thread subdir of the scratch root — not STATE/INDEX, not top-level.
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const m = fp.match(new RegExp(`${esc(cfg.scratch_root)}/([^/]+)/([^/]+)\\.md$`));
if (!m) process.exit(0);
const [, dir, base] = m;
const stateLink = cfg.state_basename.replace(/\.md$/, "");
const indexLink = cfg.index_basename.replace(/\.md$/, "");
if (base === stateLink || base === indexLink) process.exit(0);

let content = "";
try {
  content = readFileSync(fp, "utf8");
} catch {
  process.exit(0);
}
if (content.includes("[[")) process.exit(0); // already part of the graph — leave it

// Clean hierarchy: link the thread's STATE hub if it exists (STATE → INDEX carries the spine);
// only fall back to [[INDEX]] for a dir with no STATE.
const dirAbs = fp.slice(0, fp.lastIndexOf("/"));
const hasState = existsSync(`${dirAbs}/${cfg.state_basename}`);
const target = hasState ? `[[${stateLink}]]` : `[[${indexLink}]]`;

try {
  writeFileSync(fp, `> ${target}\n\n` + content);
} catch {
  process.exit(0);
}
console.log(
  JSON.stringify({ systemMessage: `ccx graph: clustered ${dir}/${base} → ${target} (no orphan leaf).` }),
);
process.exit(0);
