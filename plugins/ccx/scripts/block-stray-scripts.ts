// PreToolUse(Write) hygiene gate — keep throwaway scripts out of the repo, steer them into the
// scratch notebook. DENIES a Write only when it would create a *script* file (policed extensions
// from config) OUTSIDE the allowlisted source dirs / the scratch root. Everything else passes.
// Only Write is matched (the file-creation vector); Edit / existing files are never blocked.
// Tune per project via methodology.config.json `script_allowlist`; disable anytime via /hooks.

import { loadConfig } from "./lib/config";

const raw = await Bun.stdin.text();
let data: any;
try {
  data = JSON.parse(raw || "{}");
} catch {
  process.exit(0); // not our concern — let it through
}

if (data?.tool_name !== "Write") process.exit(0);

const fp: string = data?.tool_input?.file_path ?? "";
if (!fp) process.exit(0);

const cfg = loadConfig(process.env.CLAUDE_PROJECT_DIR || data?.cwd || process.cwd());

const base = fp.split("/").pop() ?? "";
const ext = base.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
if (!ext || !cfg.script_allowlist.extensions.includes(ext)) process.exit(0); // only police scripts

const allowedDirs = [...cfg.script_allowlist.dirs, `/${cfg.scratch_root}/`];
const isConfigOrDotfile =
  /\.config\.[a-z0-9]+$/.test(base) || base.endsWith(".d.ts") || base.startsWith(".");

if (isConfigOrDotfile || allowedDirs.some((d) => fp.includes(d))) process.exit(0);

const reason =
  `ccx hygiene gate: "${base}" would be created outside ${cfg.scratch_root}/. Throwaway / ` +
  `experimental scripts belong in ${cfg.scratch_root}/<thread>/ so they never pollute the repo ` +
  `or a PR. If this is real source, put it under a source dir (e.g. ` +
  `${cfg.script_allowlist.dirs.slice(0, 6).join(" ")} …). ` +
  `(ccx plugin hook — tune via methodology.config.json script_allowlist, disable via /hooks.)`;

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }),
);
process.exit(0);
