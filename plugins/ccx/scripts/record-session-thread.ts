// UserPromptExpansion hook — record which thread THIS session is associated with.
//
// Fires when the user types the thread-opening command (/ccx:start-thread <topic>). Writes
// <scratch_root>/.sessions/<session_id>.json = {display, slug, source, ts} — the association the
// state-freshness-guard Stop hook (and any host-project status line) reads to know "what this
// session is about". Side-effect only: always exits 0 with empty stdout — never blocks or alters
// the prompt. Fail open on any parse error.
//
// command_name arrives pre-parsed on stdin; matched by SUFFIX ("start-thread") so both the bare
// and the plugin-namespaced form ("ccx:start-thread") bind — confirm shape via the stashed
// _last_expansion_input.json dump if the association ever doesn't appear.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, projectRoot } from "./lib/config";
import { slugify } from "./lib/identity";

const raw = await Bun.stdin.text();
let d: any;
try {
  d = JSON.parse(raw || "{}");
} catch {
  process.exit(0);
}

const ROOT = projectRoot();
const cfg = loadConfig(ROOT);
const sessDir = join(ROOT, cfg.scratch_root, ".sessions");

// Best-effort shape dump — "no dump appeared" itself diagnoses a matcher that didn't fire.
try {
  mkdirSync(sessDir, { recursive: true });
  writeFileSync(join(sessDir, "_last_expansion_input.json"), raw);
} catch {
  /* ignore */
}

const sid = String(d?.session_id ?? "").trim();
const cmd = String(d?.command_name ?? "").trim().toLowerCase();
const args = String(d?.command_args ?? "").trim();
if (!sid || !cmd.endsWith("start-thread") || !args) process.exit(0); // arg-less: thread not known yet

const slug = slugify(args);
try {
  writeFileSync(
    join(sessDir, `${sid}.json`),
    JSON.stringify({ display: args, slug, source: "start-thread", ts: Date.now() }),
  );
} catch {
  /* best-effort; never break the prompt */
}
process.exit(0);
