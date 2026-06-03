// Prints the resolved ccx context for the current project — injected at skill load so the model
// (and the user) can see exactly which root/config the skill is about to act on. Also self-locates
// and prints the plugin root, so skills can reference bundled scripts by absolute path even if
// ${CLAUDE_PLUGIN_ROOT} substitution is unavailable in some context (belt + suspenders).

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_BASENAME, configSource, loadConfig, projectRoot } from "./lib/config";

const root = projectRoot();
const cfg = loadConfig(root);
const scratch = join(root, cfg.scratch_root);

let threads = 0;
if (existsSync(scratch)) {
  for (const d of readdirSync(scratch)) {
    if (d.startsWith(".") || d === cfg.archive_dir) continue;
    try {
      if (statSync(join(scratch, d, cfg.state_basename)).isFile()) threads++;
    } catch {}
  }
}

console.log(`project root: ${root}`);
console.log(`plugin root: ${dirname(import.meta.dir)}`);
console.log(`config: ${configSource(root) === "file" ? CONFIG_BASENAME : `defaults (no ${CONFIG_BASENAME})`}`);
console.log(
  `notebook: ${cfg.scratch_root}/ (${existsSync(scratch) ? `${threads} thread(s) with ${cfg.state_basename}` : "not created yet"}) · ` +
    `index: ${cfg.scratch_root}/${cfg.index_basename} · archive: ${cfg.scratch_root}/${cfg.archive_dir}/ · ` +
    `ticket_system: ${cfg.ticket_system}`,
);
