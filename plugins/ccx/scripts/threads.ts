// Lists scratch threads for skill injection. Default: one block per thread (H1 + Status line +
// path) — the model-facing dashboard input. `--slugs`: bare slugs (start-thread's existence check).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, projectRoot } from "./lib/config";

const root = projectRoot();
const cfg = loadConfig(root);
const scratch = join(root, cfg.scratch_root);
const slugsOnly = process.argv.includes("--slugs");

if (!existsSync(scratch)) {
  console.log(slugsOnly ? "(none yet)" : `(no ${cfg.scratch_root}/ yet — /ccx:start-thread creates the first thread)`);
  process.exit(0);
}

const out: string[] = [];
for (const slug of readdirSync(scratch).sort()) {
  if (slug.startsWith(".") || slug === cfg.archive_dir) continue;
  const stateP = join(scratch, slug, cfg.state_basename);
  try {
    if (!statSync(stateP).isFile()) continue;
  } catch {
    continue;
  }
  if (slugsOnly) {
    out.push(slug);
    continue;
  }
  const txt = readFileSync(stateP, "utf8").replace(/\r\n/g, "\n");
  const title = txt.match(/^# (.+)$/m)?.[1] ?? slug;
  const status =
    txt.match(/^\*\*Status:\*\*\s*(.+)$/m)?.[1]?.trim() ??
    `(none — add a **Status:** line to this ${cfg.state_basename})`;
  out.push(`- **${slug}** — ${title}\n    status: ${status}\n    (→ ${cfg.scratch_root}/${slug}/${cfg.state_basename})`);
}
console.log(out.length ? out.join("\n") : "(none)");
