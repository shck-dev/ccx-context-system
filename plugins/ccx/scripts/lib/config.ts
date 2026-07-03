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
  /** Extra live INDEX sections: each command runs at compile time (5s cap); empty output → omitted. */
  extra_sections: Array<{ title: string; command: string }>;
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
  extra_sections: [],
};

export const CONFIG_BASENAME = "methodology.config.json";

/** Target project root: the session's project dir when a hook/skill runs, else cwd. */
export function projectRoot(): string {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

/** Per-field validation: any invalid field silently falls back to its default (the documented
 *  "malformed config → defaults" contract, enforced per-field, not just per-file). */
function sanitize(user: unknown): Partial<CcxConfig> {
  if (typeof user !== "object" || user === null || Array.isArray(user)) return {};
  const u = user as Record<string, unknown>;
  const out: Partial<CcxConfig> = {};
  const isRelPath = (v: unknown): v is string =>
    typeof v === "string" && v.length > 0 && !v.startsWith("/") && !v.includes("\\") &&
    !v.split("/").some((seg) => seg === "" || seg === "." || seg === "..");
  const isBasename = (v: unknown): v is string =>
    typeof v === "string" && v.length > 0 && !v.includes("/") && !v.includes("\\") && v !== "." && v !== "..";
  const normRel = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const n = v.replace(/^\.\//, "").replace(/\/+$/, "");
    return isRelPath(n) ? n : null;
  };
  const scratchRoot = normRel(u.scratch_root);
  if (scratchRoot !== null) out.scratch_root = scratchRoot;
  if (isBasename(u.state_basename)) out.state_basename = u.state_basename;
  if (isBasename(u.index_basename)) out.index_basename = u.index_basename;
  if (isBasename(u.archive_dir)) out.archive_dir = u.archive_dir;
  if (u.ticket_system === "none" || u.ticket_system === "linear" || u.ticket_system === "github")
    out.ticket_system = u.ticket_system;
  if (typeof u.oneoff_script_runner === "string" && u.oneoff_script_runner.trim().length > 0)
    out.oneoff_script_runner = u.oneoff_script_runner.trim();
  if (Array.isArray(u.script_extensions)) {
    const exts = u.script_extensions.filter((e): e is string => typeof e === "string" && /^[a-z0-9]+$/i.test(e));
    if (exts.length > 0) out.script_extensions = exts;
  }
  if (u.index_title === null || (typeof u.index_title === "string" && u.index_title.length > 0))
    out.index_title = u.index_title as string | null;
  if (Array.isArray(u.extra_sections)) {
    out.extra_sections = u.extra_sections.filter(
      (s): s is { title: string; command: string } =>
        typeof s === "object" && s !== null &&
        typeof (s as Record<string, unknown>).title === "string" && ((s as Record<string, unknown>).title as string).trim().length > 0 &&
        typeof (s as Record<string, unknown>).command === "string" && ((s as Record<string, unknown>).command as string).trim().length > 0,
    ).map((s) => ({ title: s.title.replace(/\s+/g, " ").trim(), command: s.command.trim() }));
  }
  return out;
}

export function loadConfig(root: string = projectRoot()): CcxConfig {
  const p = join(root, CONFIG_BASENAME);
  if (!existsSync(p)) return DEFAULTS;
  try {
    return { ...DEFAULTS, ...sanitize(JSON.parse(readFileSync(p, "utf8"))) };
  } catch {
    return DEFAULTS;
  }
}

/** Did the project provide a config file, or are we on stock defaults? */
export function configSource(root: string = projectRoot()): "file" | "defaults" {
  return existsSync(join(root, CONFIG_BASENAME)) ? "file" : "defaults";
}
