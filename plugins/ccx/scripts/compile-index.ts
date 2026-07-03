// Deterministic INDEX compiler — the parallel-session-safe heart of ccx.
//
// WHY: two parallel Claude sessions each full-rewriting the INDEX = last-writer-wins data loss
// (empirically 18/20 threads dropped in the source repo before this design). The INDEX is a PURE
// RENDER of each thread's STATE frontmatter (kind + summary) + live git state, written atomically
// (tmp+rename). Per-thread STATE files are the conflict-free partition — parallel sessions touch
// different threads; two concurrent compiles converge to identical bytes. Eventual-consistent:
// the INDEX catches up whenever save-state runs; nothing is lost in a STATE meanwhile.
//
// Frontmatter contract per STATE: title: <slug> | kind: thread|hub|done | summary: '<one-liner>'
// Run: bun compile-index.ts [outPath]   (default = <scratch_root>/<index_basename>)

import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { execSync } from "node:child_process";
import { loadConfig, projectRoot } from "./lib/config";
import { clip } from "./lib/text";

const ROOT = projectRoot();
const cfg = loadConfig(ROOT);
const SCRATCH = join(ROOT, cfg.scratch_root);
const OUT = process.argv[2] || join(SCRATCH, cfg.index_basename);
const stateLink = cfg.state_basename.replace(/\.md$/, "");

function parseFrontmatter(txt: string): Record<string, string> {
  const m = txt.match(/^---\n([\s\S]*?)\n---/);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const ln of m[1].split("\n")) {
    const mm = ln.match(/^([A-Za-z_]\w*):\s*(.*)$/);
    if (!mm) continue;
    let v = mm[2].trim();
    if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1).replace(/''/g, "'");
    else if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\"/g, '"');
    out[mm[1]] = v;
  }
  return out;
}

type Thread = { slug: string; kind: string; summary: string; mtime: number };
const all: Thread[] = [];
let slugs: string[];
try {
  slugs = readdirSync(SCRATCH)
    .filter((d) => !d.startsWith(".") && d !== cfg.archive_dir)
    .sort();
} catch {
  console.log(`(no ${cfg.scratch_root}/ at ${ROOT} — nothing to compile; /ccx:start-thread creates it)`);
  process.exit(0);
}

for (const slug of slugs) {
  const p = join(SCRATCH, slug, cfg.state_basename);
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(p);
  } catch {
    continue;
  }
  if (!st.isFile()) continue;
  const txt = readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  const fm = parseFrontmatter(txt);
  const kind = (fm.kind || "thread").toLowerCase();
  const summary =
    fm.summary ||
    txt.match(/^\*\*Status:\*\*\s*(.+)$/m)?.[1]?.trim().split(/(?<=\.)\s/)[0] ||
    "(no summary — add `summary:` to this STATE's frontmatter)";
  all.push({ slug, kind, summary: clip(summary, 240), mtime: st.mtimeMs });
}

const live = (cmd: string) => {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trimEnd();
  } catch {
    return "";
  }
};

const byMtime = (a: Thread, b: Thread) => b.mtime - a.mtime;
const bySlug = (a: Thread, b: Thread) => (a.slug < b.slug ? -1 : 1);
const active = all.filter((t) => t.kind === "thread").sort(byMtime);
const hubs = all.filter((t) => t.kind === "hub").sort(bySlug);
const done = all.filter((t) => t.kind === "done").sort(bySlug);

const today = new Date().toISOString().slice(0, 10);
const title = cfg.index_title ?? basename(ROOT);
const worktrees = live("git worktree list");
const prs = live("gh pr list --limit 12");
const extras = cfg.extra_sections.flatMap((s) => {
  const out = live(s.command);
  return out ? [`## ${s.title}`, out, ""] : [];
});

const md = [
  `# Work INDEX — ${title}`,
  "",
  "> Single pane, **compiled** by ccx save-state (`compile-index.ts`) from each",
  `> \`${cfg.scratch_root}/<thread>/${cfg.state_basename}\` frontmatter (\`summary\`/\`kind\`) + live git — never hand-edited`,
  `> (concurrency-safe: a pure render, atomic write). Detail lives in each STATE. Compiled: ${today}.`,
  "",
  ...extras,
  "## Active threads",
  ...(active.length
    ? active.map((t) => `- **${t.slug}** — ${t.summary} → [[${t.slug}/${stateLink}]]`)
    : ["(none — /ccx:start-thread opens one)"]),
  "",
  "## Notes & artifacts (reference hubs — permanent KEEP)",
  ...(hubs.length ? hubs.map((t) => `- [[${t.slug}/${stateLink}|${t.slug}]] — ${t.summary}`) : ["(none)"]),
  "",
  "## Done / prune candidates",
  `Shipped or abandoned — archive on a cold /ccx:tidy-scratch.`,
  ...(done.length ? done.map((t) => `- **${t.slug}** — ${t.summary} → [[${t.slug}/${stateLink}]]`) : ["(none)"]),
  "",
  // Git-generic extras, shown only when they carry signal (omitted in a non-git dir, a
  // worktree-less repo, or when gh is absent/unauthed/not-GitHub).
  ...(worktrees.split("\n").length > 1 ? ["## Worktrees", "```", worktrees, "```", ""] : []),
  ...(prs ? ["## Open PRs", "```", prs, "```", ""] : []),
].join("\n");

const tmp = `${OUT}.tmp.${process.pid}`;
writeFileSync(tmp, md);
renameSync(tmp, OUT);
console.log(
  `compiled ${active.length} active · ${hubs.length} hubs · ${done.length} done → ${cfg.scratch_root}/${cfg.index_basename} (${md.length} bytes)`,
);
