// ccx test harness — application-scenario tests against a fixture NON-Node (Go) project.
// Proves the port's three load-bearing seams: config resolution, the shared identity fn, and
// every script/hook behaving correctly on a foreign-language repo with ticket_system: none.
// Run: bun tests/run-tests.ts   (builds a fresh fixture in tmpdir each run; exits non-zero on fail)

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLUGIN = join(import.meta.dir, "..", "plugins", "ccx");
const SCRIPTS = join(PLUGIN, "scripts");

// ---------- tiny harness ----------
let pass = 0,
  fail = 0;
const bad: string[] = [];
function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    bad.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

type RunOpts = { root?: string; stdin?: string; args?: string[]; cwd?: string };
function run(script: string, { root, stdin, args = [], cwd }: RunOpts = {}) {
  const env: Record<string, string | undefined> = { ...process.env };
  if (root) env.CLAUDE_PROJECT_DIR = root;
  else delete env.CLAUDE_PROJECT_DIR;
  const r = Bun.spawnSync(["bun", join(SCRIPTS, script), ...args], {
    env: env as Record<string, string>,
    cwd: cwd ?? root ?? process.cwd(),
    stdin: stdin !== undefined ? Buffer.from(stdin) : undefined,
  });
  return {
    code: r.exitCode,
    out: r.stdout?.toString() ?? "",
    err: r.stderr?.toString() ?? "",
  };
}

// ---------- fixture: fake Go project, stock config ----------
const base = mkdtempSync(join(tmpdir(), "ccx-fixture-"));
const FIX = join(base, "proj-go"); // name avoids every allowlist substring (/src/ /test /app/ …)
const S = join(FIX, ".scratch");

function state(slug: string, kind: string, summary: string, extra = "") {
  mkdirSync(join(S, slug), { recursive: true });
  writeFileSync(
    join(S, slug, "STATE.md"),
    `---\ntitle: ${slug}\nkind: ${kind}\nsummary: '${summary}'\n---\n\n# ${slug} — fixture thread\n\n**Hub:** [[INDEX]]\n**Status:** ${summary}\n${extra}`,
  );
}

mkdirSync(join(FIX, "internal"), { recursive: true });
writeFileSync(join(FIX, "go.mod"), "module example.com/proj\n\ngo 1.22\n");
writeFileSync(join(FIX, "main.go"), "package main\n\nfunc main() {}\n");
state("alpha", "thread", "alpha work in flight");
state("beta", "hub", "reference hub note");
state("delta", "done", "shipped last month");
writeFileSync(join(S, "alpha", "note.md"), "> [[STATE]]\n\nlinked note\n");
writeFileSync(join(S, "alpha", "orphan.md"), "an unlinked note\n");
mkdirSync(join(S, "gamma"), { recursive: true });
writeFileSync(join(S, "gamma", "probe.py"), "print('throwaway')\n");
writeFileSync(join(S, "gamma", "note.md"), "note in a STATE-less dir\n");
mkdirSync(join(S, "_archive", "old"), { recursive: true });
writeFileSync(join(S, "_archive", "old", "STATE.md"), "---\ntitle: old\nkind: done\nsummary: 'archived'\n---\n# old\n");
writeFileSync(join(S, "_archive", "old", "note.md"), "archived orphan note\n");
mkdirSync(join(S, ".obsidian"), { recursive: true });
writeFileSync(join(S, ".obsidian", "graph.json"), "{}\n");
// age gamma ~20 days
const old = new Date(Date.now() - 20 * 86_400_000);
utimesSync(join(S, "gamma", "probe.py"), old, old);
utimesSync(join(S, "gamma", "note.md"), old, old);

// ---------- fixture 2: custom config (scratch_root = notes) ----------
const FIX2 = join(base, "proj-custom");
mkdirSync(join(FIX2, "notes", "t"), { recursive: true });
writeFileSync(
  join(FIX2, "methodology.config.json"),
  JSON.stringify({ scratch_root: "notes", script_extensions: ["ts", "py", "rb"] }, null, 2),
);
writeFileSync(join(FIX2, "notes", "t", "STATE.md"), "---\ntitle: t\nkind: thread\nsummary: 'custom-root thread'\n---\n# t\n**Status:** alive\n");
mkdirSync(join(FIX2, "notes", "crlf"), { recursive: true });
writeFileSync(
  join(FIX2, "notes", "crlf", "STATE.md"),
  "---\r\ntitle: crlf\r\nkind: done\r\nsummary: 'windows line endings'\r\n---\r\n\r\n# crlf\r\n**Status:** parsed fine\r\n",
);

// ---------- fixture 3: wrong-TYPED config values (must all fall back per-field) ----------
const FIX3 = join(base, "proj-badcfg");
mkdirSync(join(FIX3, ".scratch", "t"), { recursive: true });
writeFileSync(
  join(FIX3, "methodology.config.json"),
  JSON.stringify({
    scratch_root: "",
    script_extensions: "ts",
    ticket_system: "jira",
    archive_dir: "a/b",
    index_title: 7,
    state_basename: 42,
  }),
);
writeFileSync(join(FIX3, ".scratch", "t", "STATE.md"), "---\ntitle: t\nkind: thread\nsummary: 'ok'\n---\n# t\n**Status:** alive\n");

console.log(`fixtures at ${base}\n`);

// ---------- config ----------
console.log("config.ts");
const { loadConfig, DEFAULTS } = await import(join(SCRIPTS, "lib", "config.ts"));
ok("defaults when no config file", loadConfig(FIX).scratch_root === ".scratch" && loadConfig(FIX) === DEFAULTS);
ok("file overrides scratch_root", loadConfig(FIX2).scratch_root === "notes");
ok(
  "file overrides script_extensions wholesale",
  loadConfig(FIX2).script_extensions.includes("rb") &&
    !loadConfig(FIX2).script_extensions.includes("sh"),
);
const badCfg = loadConfig(FIX3);
ok("wrong-typed fields fall back per-field", badCfg.scratch_root === ".scratch" && badCfg.archive_dir === "_archive" && badCfg.ticket_system === "none" && badCfg.index_title === null && badCfg.state_basename === "STATE.md");
ok("string script_extensions falls back to default array", Array.isArray(badCfg.script_extensions) && badCfg.script_extensions.includes("sh"));
ok("valid fields still apply alongside invalid ones", loadConfig(FIX2).scratch_root === "notes");
const scBad = run("scan.ts", { root: FIX3 });
ok("scan.ts survives a wrong-typed config", scBad.code === 0 && scBad.out.includes("t\tyes"));

// ---------- identity ----------
console.log("identity.ts");
const { slugify } = await import(join(SCRIPTS, "lib", "identity.ts"));
ok('slugify("Fix Auth Redirect!")', slugify("Fix Auth Redirect!") === "fix-auth-redirect");
ok('slugify("héllo wörld") (non-ascii → dashes)', slugify("héllo wörld") === "h-llo-w-rld");
ok('slugify("___") falls back to "thread"', slugify("___") === "thread");
const longSlug = slugify("x".repeat(80) + " tail");
ok("slugify truncates ≤60, no trailing dash", longSlug.length <= 60 && !longSlug.endsWith("-"));

// ---------- slug CLI ----------
console.log("slug.ts");
ok('CLI "My Topic Name" → my-topic-name', run("slug.ts", { args: ["My Topic Name"] }).out.trim() === "my-topic-name");
ok("CLI with no args exits non-zero", run("slug.ts").code !== 0);

// ---------- where ----------
console.log("where.ts");
const w = run("where.ts", { root: FIX }).out;
ok("prints project root", w.includes(`project root: ${FIX}`));
ok("prints plugin root + 3 threads", w.includes(`plugin root: ${PLUGIN}`) && w.includes("3 thread(s)"));

// ---------- threads ----------
console.log("threads.ts");
const t = run("threads.ts", { root: FIX }).out;
ok("default mode lists alpha with status", t.includes("**alpha**") && t.includes("status: alpha work in flight"));
const slugs = run("threads.ts", { root: FIX, args: ["--slugs"] }).out.trim().split("\n");
ok("--slugs = exactly alpha,beta,delta", slugs.join(",") === "alpha,beta,delta");

// ---------- orphans ----------
console.log("orphans.ts");
const o = run("orphans.ts", { root: FIX }).out;
ok(
  "flags orphan.md + gamma/note.md, not linked note / archive",
  o.includes("alpha/orphan.md") && o.includes("gamma/note.md") && !o.includes("alpha/note.md") && !o.includes("_archive"),
);

// ---------- compile-index ----------
console.log("compile-index.ts");
const c1 = run("compile-index.ts", { root: FIX });
const INDEX = join(S, "INDEX.md");
ok("INDEX.md created, title = dir basename", existsSync(INDEX) && readFileSync(INDEX, "utf8").includes("# Work INDEX — proj-go"));
const idx = readFileSync(INDEX, "utf8");
ok(
  "alpha→Active, beta→hubs, delta→Done",
  /## Active threads\n- \*\*alpha\*\*/.test(idx) && idx.includes("[[beta/STATE|beta]]") && /## Done[\s\S]*\*\*delta\*\*/.test(idx),
);
ok("archived thread absent", !idx.includes("[[old/STATE]]") && !/\*\*old\*\*/.test(idx));
ok("no leftover .tmp files", !readdirSync(S).some((f) => f.includes(".tmp.")));
run("compile-index.ts", { root: FIX });
ok("double-compile byte-identical", readFileSync(INDEX, "utf8") === idx);
ok("non-git fixture: no Worktrees/PRs sections", !idx.includes("## Worktrees") && !idx.includes("## Open PRs"));
ok("compile reports counts", c1.out.includes("compiled 1 active · 1 hubs · 1 done"));

// ---------- compile-index: custom root + CRLF ----------
console.log("compile-index.ts (custom root, CRLF)");
run("compile-index.ts", { root: FIX2 });
const idx2 = readFileSync(join(FIX2, "notes", "INDEX.md"), "utf8");
ok("CRLF STATE lands in Done with parsed summary", /## Done[\s\S]*\*\*crlf\*\* — windows line endings/.test(idx2));
ok("CRLF STATE absent from Active", !/## Active threads[\s\S]*\*\*crlf\*\*[\s\S]*## Notes/.test(idx2));
const t2 = run("threads.ts", { root: FIX2 }).out;
ok("threads.ts reads CRLF Status without stray \\r", t2.includes("status: parsed fine") && !t2.includes("\r"));

// ---------- scan ----------
console.log("scan.ts");
const sc = run("scan.ts", { root: FIX }).out;
const scLines = sc.trim().split("\n").filter((l) => !l.startsWith("#"));
ok("4 rows (alpha,beta,gamma,delta)", scLines.length === 4);
ok("gamma has STATE=NO", scLines.some((l) => l.startsWith("gamma\tNO")));
const gammaAge = parseInt(scLines.find((l) => l.startsWith("gamma"))?.split("\t")[5] ?? "-1", 10);
ok("gamma age ≥ 19 days", gammaAge >= 19);
ok("archive + .obsidian not scanned", !sc.includes("_archive") && !sc.includes(".obsidian"));

// ---------- backlink hook ----------
console.log("backlink-scratch-notes.ts");
const backlink = (file_path: string, root = FIX) =>
  run("backlink-scratch-notes.ts", { root, stdin: JSON.stringify({ tool_name: "Write", tool_input: { file_path }, cwd: root }) });

writeFileSync(join(S, "alpha", "orphan2.md"), "fresh unlinked note\n");
const b1 = backlink(join(S, "alpha", "orphan2.md"));
ok(
  "unlinked note in STATE dir → prepends [[STATE]] + systemMessage",
  readFileSync(join(S, "alpha", "orphan2.md"), "utf8").startsWith("> [[STATE]]\n\n") && b1.out.includes("systemMessage"),
);
const linkedBefore = readFileSync(join(S, "alpha", "note.md"), "utf8");
backlink(join(S, "alpha", "note.md"));
ok("already-linked note untouched", readFileSync(join(S, "alpha", "note.md"), "utf8") === linkedBefore);
backlink(join(S, "gamma", "note.md"));
ok("note in STATE-less dir → [[INDEX]]", readFileSync(join(S, "gamma", "note.md"), "utf8").startsWith("> [[INDEX]]\n\n"));
const archBefore = readFileSync(join(S, "_archive", "old", "note.md"), "utf8");
backlink(join(S, "_archive", "old", "note.md"));
ok("archived note untouched", readFileSync(join(S, "_archive", "old", "note.md"), "utf8") === archBefore);
const stateBefore = readFileSync(join(S, "alpha", "STATE.md"), "utf8");
backlink(join(S, "alpha", "STATE.md"));
ok("STATE.md itself untouched", readFileSync(join(S, "alpha", "STATE.md"), "utf8") === stateBefore);

// ---------- summary ----------
console.log(`\n${pass}/${pass + fail} passed${fail ? ` — FAILED: ${bad.join(" | ")}` : ""}`);
rmSync(base, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
