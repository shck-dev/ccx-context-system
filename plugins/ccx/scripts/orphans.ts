// Finds scratch notes missing a [[wikilink]] in their first 5 lines — orphan leaves that would
// float unattached in the Obsidian graph. save-state's step: prepend `> [[STATE]]` to each.
// Skips the archive dir and dot-dirs (.obsidian, .sessions, …).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { loadConfig, projectRoot } from "./lib/config";

const root = projectRoot();
const cfg = loadConfig(root);
const scratch = join(root, cfg.scratch_root);
const stateBase = cfg.state_basename;
const indexBase = cfg.index_basename;

const missing: string[] = [];
const stack: string[] = [];
try {
  if (statSync(scratch).isDirectory()) stack.push(scratch);
} catch {}

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
      if (e.name === cfg.archive_dir || e.name.startsWith(".")) continue;
      stack.push(p);
      continue;
    }
    if (!e.name.endsWith(".md") || e.name === stateBase || e.name === indexBase) continue;
    try {
      const head = readFileSync(p, "utf8").split("\n").slice(0, 5).join("\n");
      if (!head.includes("[[")) missing.push(`- ${relative(scratch, p)}`);
    } catch {}
  }
}

console.log(missing.length ? missing.sort().join("\n") : "(all notes already cluster under a STATE — none to backfill)");
