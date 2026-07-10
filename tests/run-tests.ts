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
state("longsum", "thread", "L".repeat(500));
const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
utimesSync(join(S, "longsum", "STATE.md"), twoDaysAgo, twoDaysAgo);
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
  JSON.stringify(
    {
      scratch_root: "notes",
      script_extensions: ["ts", "py", "rb"],
      extra_sections: [
        { title: "Environment", command: "echo '- probe UP'" },
        { title: "Broken", command: "false" },
        { title: "", command: "echo skipped-invalid" },
      ],
    },
    null,
    2,
  ),
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
    extra_sections: { title: "x" },
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
ok("non-array extra_sections falls back to []", Array.isArray(badCfg.extra_sections) && badCfg.extra_sections.length === 0);
ok("valid fields still apply alongside invalid ones", loadConfig(FIX2).scratch_root === "notes");
const FIX4 = join(base, "proj-dotslash");
mkdirSync(join(FIX4, "notes2", "t"), { recursive: true });
writeFileSync(
  join(FIX4, "methodology.config.json"),
  JSON.stringify({ scratch_root: "./notes2/", extra_sections: [{ title: "  Env\nX  ", command: " echo hi " }] }),
);
const dot = loadConfig(FIX4);
ok("./-prefix and trailing slash normalize instead of falling back", dot.scratch_root === "notes2");
ok("extra_sections title/command are trimmed and newline-free",
  dot.extra_sections[0].title === "Env X" && dot.extra_sections[0].command === "echo hi");
const scBad = run("scan.ts", { root: FIX3 });
ok("scan.ts survives a wrong-typed config", scBad.code === 0 && scBad.out.includes("t\tyes"));

// ---------- text ----------
console.log("text.ts");
const { clip } = await import(join(SCRIPTS, "lib", "text.ts"));
const clipped = clip("a".repeat(238) + "😀😀", 240);
ok("clip never splits a surrogate pair", clipped.isWellFormed() && clipped.endsWith("…") && clipped.length <= 240);

// ---------- identity ----------
console.log("identity.ts");
const { slugify } = await import(join(SCRIPTS, "lib", "identity.ts"));
ok('slugify("Fix Auth Redirect!")', slugify("Fix Auth Redirect!") === "fix-auth-redirect");
ok('slugify("héllo wörld") keeps unicode letters', slugify("héllo wörld") === "héllo-wörld");
ok('slugify("Исправить Баг") stays readable', slugify("Исправить Баг") === "исправить-баг");
const { normalizeForMatch } = await import(join(SCRIPTS, "lib", "identity.ts"));
ok("normalizeForMatch: CP-1758 ≡ cp1758 ≡ cp-1758",
  normalizeForMatch("CP-1758") === "cp1758" && normalizeForMatch("cp-1758") === "cp1758" && normalizeForMatch("cp1758") === "cp1758");
ok("slugify never splits a surrogate pair at the 60 cut", slugify("a".repeat(59) + "𝔸b").isWellFormed());
const nfd = "héllo wörld".normalize("NFD"); // macOS-style decomposed input (byte-distinct from NFC)
ok("NFD input ≡ NFC input (slug + match)",
  slugify(nfd) === "héllo-wörld" && normalizeForMatch(nfd) === normalizeForMatch("héllo wörld"));
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
ok("prints plugin root + 4 threads", w.includes(`plugin root: ${PLUGIN}`) && w.includes("4 thread(s)"));

// ---------- threads ----------
console.log("threads.ts");
const t = run("threads.ts", { root: FIX }).out;
ok("default mode lists alpha with status", t.includes("**alpha**") && t.includes("status: alpha work in flight"));
const slugs = run("threads.ts", { root: FIX, args: ["--slugs"] }).out.trim().split("\n");
ok("--slugs = exactly alpha,beta,delta,longsum", slugs.join(",") === "alpha,beta,delta,longsum");
const longStatus = t.split("\n").find((l) => l.includes("LLLL")) ?? "";
ok("oversized status clipped to ≤200 chars + ellipsis", longStatus.includes("…") && longStatus.trim().length < 220);

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
ok("compile reports counts", c1.out.includes("compiled 2 active · 1 hubs · 1 done"));
const longLine = idx.split("\n").find((l) => l.includes("**longsum**")) ?? "";
ok("oversized summary clipped to ≤240 chars + ellipsis", longLine.includes("…") && longLine.length < 300);

// ---------- compile-index: custom root + CRLF ----------
console.log("compile-index.ts (custom root, CRLF)");
run("compile-index.ts", { root: FIX2 });
const idx2 = readFileSync(join(FIX2, "notes", "INDEX.md"), "utf8");
ok("CRLF STATE lands in Done with parsed summary", /## Done[\s\S]*\*\*crlf\*\* — windows line endings/.test(idx2));
ok("CRLF STATE absent from Active", !/## Active threads[\s\S]*\*\*crlf\*\*[\s\S]*## Notes/.test(idx2));
const t2 = run("threads.ts", { root: FIX2 }).out;
ok("threads.ts reads CRLF Status without stray \\r", t2.includes("status: parsed fine") && !t2.includes("\r"));
ok("extra section rendered from config command", /## Environment\n- probe UP/.test(idx2));
ok("failing extra command → section omitted", !idx2.includes("## Broken"));
ok("invalid extra entry ignored", !idx2.includes("skipped-invalid"));
ok("extra section sits before Active threads", idx2.indexOf("## Environment") < idx2.indexOf("## Active threads"));

// ---------- scan ----------
console.log("scan.ts");
const sc = run("scan.ts", { root: FIX }).out;
const scLines = sc.trim().split("\n").filter((l) => !l.startsWith("#"));
ok("5 rows (alpha,beta,gamma,delta,longsum)", scLines.length === 5);
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
const OTHER = join(base, "other-proj", ".scratch", "x");
mkdirSync(OTHER, { recursive: true });
writeFileSync(join(OTHER, "n.md"), "unlinked note outside the project\n");
backlink(join(OTHER, "n.md")); // hook runs with root = FIX — must not touch a foreign .scratch
ok("note under another project's .scratch untouched", readFileSync(join(OTHER, "n.md"), "utf8") === "unlinked note outside the project\n");
mkdirSync(join(S, "alpha", "sub"), { recursive: true });
writeFileSync(join(S, "alpha", "sub", "deep.md"), "nested note\n");
backlink(join(S, "alpha", "sub", "deep.md"));
ok("nested note untouched (only direct children of a thread dir)", readFileSync(join(S, "alpha", "sub", "deep.md"), "utf8") === "nested note\n");
writeFileSync(join(S, ".obsidian", "stray.md"), "vault plumbing\n");
backlink(join(S, ".obsidian", "stray.md"));
ok("dot-dir note untouched", readFileSync(join(S, ".obsidian", "stray.md"), "utf8") === "vault plumbing\n");

// ---------- hook helper with extra env ----------
function runHookEnv(script: string, root: string, stdin: object, extraEnv: Record<string, string> = {}) {
  const r = Bun.spawnSync(["bun", join(SCRIPTS, script)], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, ...extraEnv } as Record<string, string>,
    cwd: root,
    stdin: Buffer.from(JSON.stringify(stdin)),
  });
  return { code: r.exitCode, out: (r.stdout?.toString() ?? "").trim(), err: r.stderr?.toString() ?? "" };
}

// ---------- auto-compile-index hook ----------
console.log("auto-compile-index.ts");
const SYNC = { CCX_AUTOCOMPILE_SYNC: "1" };
const stateWrite = (file_path: string, tool_name = "Write") => ({ tool_name, tool_input: { file_path } });

rmSync(INDEX, { force: true });
const a1 = runHookEnv("auto-compile-index.ts", FIX, stateWrite(join(S, "alpha", "STATE.md")), SYNC);
ok("STATE write → INDEX recompiled, silent stdout", existsSync(INDEX) && a1.out === "" && a1.code === 0);
rmSync(INDEX, { force: true });
runHookEnv("auto-compile-index.ts", FIX, stateWrite(join(S, "alpha", "orphan.md")), SYNC);
ok("non-STATE note → no compile", !existsSync(INDEX));
runHookEnv("auto-compile-index.ts", FIX, stateWrite(join(S, "_archive", "old", "STATE.md")), SYNC);
ok("archived STATE → no compile", !existsSync(INDEX));
runHookEnv("auto-compile-index.ts", FIX, stateWrite(INDEX), SYNC);
ok("INDEX itself → no compile", !existsSync(INDEX));
runHookEnv("auto-compile-index.ts", FIX, stateWrite(join(S, "alpha", "STATE.md"), "Bash"), SYNC);
ok("other tool → no compile", !existsSync(INDEX));
runHookEnv("auto-compile-index.ts", FIX, stateWrite(join(S, "alpha", "STATE.md"), "Edit"), SYNC);
ok("Edit on STATE → compiles too", existsSync(INDEX));
// debounce: a fresh .pending lock suppresses the kick
rmSync(INDEX, { force: true });
mkdirSync(join(S, ".sessions"), { recursive: true });
writeFileSync(join(S, ".sessions", ".index-compile.pending"), "");
runHookEnv("auto-compile-index.ts", FIX, stateWrite(join(S, "alpha", "STATE.md")), SYNC);
ok("fresh .pending lock → kick debounced", !existsSync(INDEX));
rmSync(join(S, ".sessions", ".index-compile.pending"), { force: true });
// custom scratch root honors config
const INDEX2 = join(FIX2, "notes", "INDEX.md");
rmSync(INDEX2, { force: true });
runHookEnv("auto-compile-index.ts", FIX2, stateWrite(join(FIX2, "notes", "t", "STATE.md")), SYNC);
ok("custom scratch_root (notes/) STATE write → its INDEX recompiled", existsSync(INDEX2));

// ---------- record-session-thread hook ----------
console.log("record-session-thread.ts");
const expand = (session_id: string, command_name: string, command_args: string) =>
  runHookEnv("record-session-thread.ts", FIX, { session_id, command_name, command_args });
expand("S9", "ccx:start-thread", "Fix Auth Redirect");
const s9 = JSON.parse(readFileSync(join(S, ".sessions", "S9.json"), "utf8"));
ok("plugin-namespaced command → association written with slugified slug", s9.slug === "fix-auth-redirect" && s9.display === "Fix Auth Redirect" && s9.source === "start-thread");
expand("S10", "start-thread", "guard");
ok("bare command name binds too", existsSync(join(S, ".sessions", "S10.json")));
expand("S11", "ccx:start-thread", "");
ok("arg-less → no association (thread not known yet)", !existsSync(join(S, ".sessions", "S11.json")));
expand("S12", "ccx:save-state", "x");
ok("other command → no association", !existsSync(join(S, ".sessions", "S12.json")));

// ---------- state-freshness-guard hook ----------
console.log("state-freshness-guard.ts");
state("guard", "thread", "guard fixture");
writeFileSync(join(S, "guard", "work.ts"), "// work");
const staleT = new Date(Date.now() - 12 * 60_000); // beyond GRACE (10 min)
const recentT = new Date(Date.now() - 60_000);
utimesSync(join(S, "guard", "STATE.md"), staleT, staleT);
utimesSync(join(S, "guard", "work.ts"), recentT, recentT);
writeFileSync(join(S, ".sessions", "S20.json"), JSON.stringify({ display: "guard", slug: "guard", source: "start-thread", ts: Date.now() }));
const g1 = runHookEnv("state-freshness-guard.ts", FIX, { session_id: "S20", stop_hook_active: false });
let g1parsed: any = null;
try { g1parsed = JSON.parse(g1.out); } catch { /* assertion below reports it */ }
ok("drifted thread → blocks with decision JSON naming the slug", g1.code === 0 && g1parsed?.decision === "block" && String(g1parsed?.reason ?? "").includes('"guard"'), g1.out.slice(0, 120) || g1.err.slice(0, 120));
ok("nudge timestamp persisted", typeof JSON.parse(readFileSync(join(S, ".sessions", "S20.json"), "utf8")).stateGuardNudge === "number");
const g2 = runHookEnv("state-freshness-guard.ts", FIX, { session_id: "S20", stop_hook_active: false });
ok("immediate re-stop → throttled, silent", g2.out === "");
const g3 = runHookEnv("state-freshness-guard.ts", FIX, { session_id: "S20", stop_hook_active: true });
ok("stop_hook_active → silent pass", g3.out === "");
const g4 = runHookEnv("state-freshness-guard.ts", FIX, { session_id: "NOPE", stop_hook_active: false });
ok("unassociated session → silent pass", g4.out === "");
writeFileSync(join(S, ".sessions", "S21.json"), JSON.stringify({ display: "guard", slug: "guard", source: "start-thread", ts: Date.now() }));
const g5 = runHookEnv("state-freshness-guard.ts", FIX, { session_id: "S21", stop_hook_active: false }, { SKIP_STATE_GUARD: "1" });
ok("SKIP_STATE_GUARD=1 → silent pass", g5.out === "");
state("guard2", "thread", "fresh state fixture"); // STATE mtime = now (inside GRACE)
writeFileSync(join(S, "guard2", "late-note.ts"), "// trailing note");
writeFileSync(join(S, ".sessions", "S22.json"), JSON.stringify({ display: "guard2", slug: "guard2", source: "start-thread", ts: Date.now() }));
const g6 = runHookEnv("state-freshness-guard.ts", FIX, { session_id: "S22", stop_hook_active: false });
ok("STATE inside GRACE → silent pass (trailing note doesn't re-trip)", g6.out === "");

// ---------- summary ----------
console.log(`\n${pass}/${pass + fail} passed${fail ? ` — FAILED: ${bad.join(" | ")}` : ""}`);
rmSync(base, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
