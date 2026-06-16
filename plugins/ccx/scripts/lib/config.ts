// ccx config loader — the single seam every ccx script and hook reads paths through.
// Looks for methodology.config.json at the target project root; every field has a working
// default, so a project with NO config file gets the stock .scratch/STATE/INDEX layout.
// Malformed config → defaults (a hook must never crash the session over bad JSON).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type CcxConfig = {
  /** Notebook root, relative to the project root. */
  scratch_root: string;
  /** Per-thread handoff doc basename. */
  state_basename: string;
  /** Compiled dashboard basename (lives directly under scratch_root). */
  index_basename: string;
  /** Retired-threads dir under scratch_root (archive target; skipped by scans + the compiler). */
  archive_dir: string;
  /** v1 ships "none": a thread is a free-form topic. linear|github = future adapters. */
  ticket_system: "none" | "linear" | "github";
  /** How one-off scripts are run in this project (referenced by scaffolded STATE docs). */
  oneoff_script_runner: string;
  /** Extensions counted as "scripts" when scan.ts reports on a scratch thread. */
  script_extensions: string[];
  /** INDEX H1 suffix; null → the project dir name. */
  index_title: string | null;
};

export const DEFAULTS: CcxConfig = {
  scratch_root: ".scratch",
  state_basename: "STATE.md",
  index_basename: "INDEX.md",
  archive_dir: "_archive",
  ticket_system: "none",
  oneoff_script_runner: "bun",
  script_extensions: ["ts", "js", "mjs", "cjs", "py", "sh"],
  index_title: null,
};

export const CONFIG_BASENAME = "methodology.config.json";

/** Target project root: the session's project dir when a hook/skill runs, else cwd. */
export function projectRoot(): string {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

export function loadConfig(root: string = projectRoot()): CcxConfig {
  const p = join(root, CONFIG_BASENAME);
  if (!existsSync(p)) return DEFAULTS;
  try {
    const user = JSON.parse(readFileSync(p, "utf8"));
    return { ...DEFAULTS, ...user };
  } catch {
    return DEFAULTS;
  }
}

/** Did the project provide a config file, or are we on stock defaults? */
export function configSource(root: string = projectRoot()): "file" | "defaults" {
  return existsSync(join(root, CONFIG_BASENAME)) ? "file" : "defaults";
}
