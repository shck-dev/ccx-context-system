# ccx Hardening & Scale Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the verified bugs (config validation, CRLF, hook anchoring) and scale gaps (summary bloat, missing extra sections, identity near-duplicates) found by reviewing ccx against its real-world deployment, plus docs, CI, and a version bump to 0.3.0.

**Architecture:** All changes live in `plugins/ccx/` (scripts + skills + manifests) plus the single-file test harness `tests/run-tests.ts` and a new GitHub Actions workflow. No new dependencies; everything stays deterministic bun CLIs. `scripts/lib/config.ts` remains the ONE config seam (it gains per-field validation and a new `extra_sections` field); `scripts/lib/identity.ts` remains the ONE identity seam (it gains Unicode-aware slugging and `normalizeForMatch`).

**Tech Stack:** bun (runtime + test runner), TypeScript, GitHub Actions.

## Global Constraints

- Everything runs under **bun**; inline scripts use `bun -e`, never `node -e`.
- Never hardcode `.scratch` / `STATE.md` / `INDEX.md` — always resolve through `loadConfig()`.
- Hooks **fail open**: any parse error or unexpected input → `exit 0`. A hook must never crash the session.
- The INDEX stays a **pure render** written atomically (tmp+rename); double-compile must stay byte-identical (an existing test asserts this).
- Tests: the whole suite is `bun tests/run-tests.ts` (single file, `ok()` assertions, exits non-zero on failure). New tests are added INTO this file following its existing section style.
- The no-config path of `loadConfig` must keep returning the `DEFAULTS` object identity (test asserts `loadConfig(FIX) === DEFAULTS`).
- Run the full suite before every commit: `bun tests/run-tests.ts` → last line must read `N/N passed` with no `✗`.
- Commit after each task with a conventional-commit message ending in the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.

---

### Task 1: Per-field config validation in `loadConfig`

The current merge `{ ...DEFAULTS, ...user }` lets wrong-typed values through: `"script_extensions": "ts"` crashes `scan.ts` (`.join is not a function`), and `"scratch_root": ""` makes the backlink hook match ANY `<dir>/<note>.md` in the project. The documented contract is "malformed config → defaults"; make it true per-field.

**Files:**
- Modify: `plugins/ccx/scripts/lib/config.ts`
- Test: `tests/run-tests.ts` (config section + a new fixture)

**Interfaces:**
- Consumes: nothing new.
- Produces: `loadConfig(root?: string): CcxConfig` — same signature, but every field of the returned object is now guaranteed to be valid (correct type; paths relative with no `..`/`.`/empty segments; basenames contain no `/`). Later tasks (2, 4, 5) rely on this guarantee.

- [ ] **Step 1: Add fixture 3 (bad-typed config) and failing tests to the harness**

In `tests/run-tests.ts`, after the fixture-2 block (after line 86, `writeFileSync(join(FIX2, "notes", "t", "STATE.md"), ...)`), add:

```ts
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
```

In the `// ---------- config ----------` section (after the existing three `ok(...)` calls), add:

```ts
const bad = loadConfig(FIX3);
ok("wrong-typed fields fall back per-field", bad.scratch_root === ".scratch" && bad.archive_dir === "_archive" && bad.ticket_system === "none" && bad.index_title === null && bad.state_basename === "STATE.md");
ok("string script_extensions falls back to default array", Array.isArray(bad.script_extensions) && bad.script_extensions.includes("sh"));
ok("valid fields still apply alongside invalid ones", loadConfig(FIX2).scratch_root === "notes");
const scBad = run("scan.ts", { root: FIX3 });
ok("scan.ts survives a wrong-typed config", scBad.code === 0 && scBad.out.includes("t\tyes"));
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `bun tests/run-tests.ts`
Expected: FAIL — "wrong-typed fields fall back per-field" ✗ (scratch_root comes back `""`), and "scan.ts survives a wrong-typed config" ✗ (exit code 1, `.join is not a function`).

- [ ] **Step 3: Implement `sanitize()` in config.ts**

In `plugins/ccx/scripts/lib/config.ts`, replace the body of `loadConfig` and add a sanitizer above it:

```ts
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
  if (isRelPath(u.scratch_root)) out.scratch_root = u.scratch_root;
  if (isBasename(u.state_basename)) out.state_basename = u.state_basename;
  if (isBasename(u.index_basename)) out.index_basename = u.index_basename;
  if (isBasename(u.archive_dir)) out.archive_dir = u.archive_dir;
  if (u.ticket_system === "none" || u.ticket_system === "linear" || u.ticket_system === "github")
    out.ticket_system = u.ticket_system;
  if (typeof u.oneoff_script_runner === "string" && u.oneoff_script_runner.trim().length > 0)
    out.oneoff_script_runner = u.oneoff_script_runner;
  if (Array.isArray(u.script_extensions)) {
    const exts = u.script_extensions.filter((e): e is string => typeof e === "string" && /^[a-z0-9]+$/i.test(e));
    if (exts.length > 0) out.script_extensions = exts;
  }
  if (u.index_title === null || (typeof u.index_title === "string" && u.index_title.length > 0))
    out.index_title = u.index_title as string | null;
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
```

(Keep `DEFAULTS`, `CONFIG_BASENAME`, `projectRoot`, `configSource` exactly as they are.)

- [ ] **Step 4: Run tests to verify everything passes**

Run: `bun tests/run-tests.ts`
Expected: PASS, `34/34 passed` (30 existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add plugins/ccx/scripts/lib/config.ts tests/run-tests.ts
git commit -m "fix(ccx): validate config values per-field, not just per-file

Wrong-typed values (string script_extensions, empty scratch_root, unknown
ticket_system) previously passed straight through the spread merge, crashing
scan.ts and making the backlink hook match arbitrary project markdown.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: CRLF tolerance + `execSync` timeout in the compiler and threads lister

`parseFrontmatter` matches `^---\n`, so a CRLF STATE.md silently loses its `kind`/`summary` (verified: a `kind: done` CRLF file renders under "Active threads" with the no-summary placeholder). Separately, `compile-index.ts`'s `live()` shells out to `gh pr list` with no timeout — a hung `gh` stalls every save-state forever.

**Files:**
- Modify: `plugins/ccx/scripts/compile-index.ts:60` (read) and `:72` (execSync opts)
- Modify: `plugins/ccx/scripts/threads.ts:31`
- Test: `tests/run-tests.ts` (fixture 2 gains a CRLF thread; new compile-on-FIX2 asserts)

**Interfaces:**
- Consumes: `loadConfig` guarantees from Task 1.
- Produces: nothing new — behavior fix only. Task 5 later edits the same `md` array in `compile-index.ts`; it assumes the file otherwise unchanged.

- [ ] **Step 1: Add a CRLF fixture thread and failing tests**

In `tests/run-tests.ts`, in the fixture-2 block (right after the existing `writeFileSync(join(FIX2, "notes", "t", "STATE.md"), ...)` line), add a STATE.md whose every line ends `\r\n`:

```ts
mkdirSync(join(FIX2, "notes", "crlf"), { recursive: true });
writeFileSync(
  join(FIX2, "notes", "crlf", "STATE.md"),
  "---\r\ntitle: crlf\r\nkind: done\r\nsummary: 'windows line endings'\r\n---\r\n\r\n# crlf\r\n**Status:** parsed fine\r\n",
);
```

Then add a new test section after the existing `// ---------- compile-index ----------` block:

```ts
// ---------- compile-index: custom root + CRLF ----------
console.log("compile-index.ts (custom root, CRLF)");
run("compile-index.ts", { root: FIX2 });
const idx2 = readFileSync(join(FIX2, "notes", "INDEX.md"), "utf8");
ok("CRLF STATE lands in Done with parsed summary", /## Done[\s\S]*\*\*crlf\*\* — windows line endings/.test(idx2));
ok("CRLF STATE absent from Active", !/## Active threads[\s\S]*\*\*crlf\*\*[\s\S]*## Notes/.test(idx2));
const t2 = run("threads.ts", { root: FIX2 }).out;
ok("threads.ts reads CRLF Status without stray \\r", t2.includes("status: parsed fine") && !t2.includes("\r"));
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `bun tests/run-tests.ts`
Expected: FAIL — "CRLF STATE lands in Done…" ✗ (it renders in Active with the placeholder summary) and "threads.ts reads CRLF Status…" ✗.

- [ ] **Step 3: Normalize CRLF at read time and add the exec timeout**

In `plugins/ccx/scripts/compile-index.ts` change line 60 from

```ts
  const txt = readFileSync(p, "utf8");
```

to

```ts
  const txt = readFileSync(p, "utf8").replace(/\r\n/g, "\n");
```

and change the `live` helper (line 70–76) to add a 5s cap:

```ts
const live = (cmd: string) => {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trimEnd();
  } catch {
    return "";
  }
};
```

In `plugins/ccx/scripts/threads.ts` change line 31 from

```ts
  const txt = readFileSync(stateP, "utf8");
```

to

```ts
  const txt = readFileSync(stateP, "utf8").replace(/\r\n/g, "\n");
```

- [ ] **Step 4: Run tests to verify everything passes**

Run: `bun tests/run-tests.ts`
Expected: PASS, `37/37 passed`.

- [ ] **Step 5: Commit**

```bash
git add plugins/ccx/scripts/compile-index.ts plugins/ccx/scripts/threads.ts tests/run-tests.ts
git commit -m "fix(ccx): tolerate CRLF STATE files; cap live git/gh calls at 5s

CRLF frontmatter previously parsed as absent (kind/summary lost); a hung gh
could stall compile-index indefinitely.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Anchor the backlink hook to the project's scratch root

The hook matches `<scratch_root>/<a>/<b>.md` **anywhere** in the written path, so a Write into a *different* project's `.scratch` (or a dir like `data.scratch/`) gets rewritten using this project's config. Anchor the match to `resolve(root, cfg.scratch_root)` and replace the regex with path segments.

**Files:**
- Modify: `plugins/ccx/scripts/backlink-scratch-notes.ts`
- Test: `tests/run-tests.ts` (backlink section)

**Interfaces:**
- Consumes: `loadConfig` (Task 1).
- Produces: same hook contract — reads PostToolUse JSON on stdin, exits 0 always, prepends `> [[STATE]]` / `> [[INDEX]]` only for direct-child notes of a thread dir under the project's own scratch root. Dot-dirs (`.obsidian`) are now excluded like the archive dir.

- [ ] **Step 1: Add failing tests for out-of-root and nested paths**

In `tests/run-tests.ts`, at the end of the `// ---------- backlink hook ----------` section (after the "STATE.md itself untouched" test), add:

```ts
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
```

- [ ] **Step 2: Run tests to verify the out-of-root one fails**

Run: `bun tests/run-tests.ts`
Expected: FAIL — "note under another project's .scratch untouched" ✗ (the unanchored regex matches and prepends `> [[INDEX]]`). The nested test already passes today (regex can't match it) — that's fine; it pins the behavior. The dot-dir test fails today (`.obsidian/stray.md` gets a breadcrumb) — it must pass after the fix.

- [ ] **Step 3: Replace the regex match with anchored path segments**

In `plugins/ccx/scripts/backlink-scratch-notes.ts`, replace lines 8–33 (imports through the `if (base === ...)` guard) with:

```ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { loadConfig } from "./lib/config";

const raw = await Bun.stdin.text();
let data: any;
try {
  data = JSON.parse(raw || "{}");
} catch {
  process.exit(0);
}
if (data?.tool_name !== "Write") process.exit(0);

const fp: string = data?.tool_input?.file_path ?? "";
if (!fp) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR || data?.cwd || process.cwd();
const cfg = loadConfig(root);

// Anchored: only notes under THIS project's scratch root, exactly one thread-dir deep.
const scratchAbs = resolve(root, cfg.scratch_root);
const fpAbs = resolve(root, fp);
if (!fpAbs.startsWith(scratchAbs + sep)) process.exit(0);
const rel = fpAbs.slice(scratchAbs.length + 1).split(sep);
if (rel.length !== 2) process.exit(0); // top-level or nested — not a thread note
const [dir, name] = rel;
if (dir === cfg.archive_dir || dir.startsWith(".")) process.exit(0); // archive + vault plumbing
if (!name.endsWith(".md")) process.exit(0);
const base = name.slice(0, -3);
const stateLink = cfg.state_basename.replace(/\.md$/, "");
const indexLink = cfg.index_basename.replace(/\.md$/, "");
if (base === stateLink || base === indexLink) process.exit(0);
```

Then update the two lines that used the old variables: `readFileSync(fp, ...)` → `readFileSync(fpAbs, ...)`, the `dirAbs` computation becomes `const dirAbs = join(scratchAbs, dir);`, and `writeFileSync(fp, ...)` → `writeFileSync(fpAbs, ...)`. The trailing `hasState`/`target`/write/systemMessage logic is otherwise unchanged. Delete the now-unused `esc` helper and the old `fp.includes(`/${cfg.archive_dir}/`)` check.

- [ ] **Step 4: Run tests to verify everything passes**

Run: `bun tests/run-tests.ts`
Expected: PASS, `40/40 passed` (all pre-existing backlink tests must still pass — they exercise the in-root cases).

- [ ] **Step 5: Commit**

```bash
git add plugins/ccx/scripts/backlink-scratch-notes.ts tests/run-tests.ts
git commit -m "fix(ccx): anchor backlink hook to the project's own scratch root

The unanchored regex matched <scratch_root>/ anywhere in the written path,
so Writes into a different project's notebook (or a *.scratch dir) were
rewritten with this project's config. Dot-dirs are now skipped too.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Clip oversized summaries and status lines at render time

In the source deployment, `summary:` fields grew to 2,000+ chars, ballooning the INDEX to 43KB and the threads.ts skill injection to tens of KB. Skill prose says "one-liner" but nothing enforces it — enforce at render: summaries clip to 240 chars in the INDEX, status lines to 200 chars in threads.ts output.

**Files:**
- Create: `plugins/ccx/scripts/lib/text.ts`
- Modify: `plugins/ccx/scripts/compile-index.ts` (summary push), `plugins/ccx/scripts/threads.ts` (status line)
- Test: `tests/run-tests.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `clip(s: string, max: number): string` in `scripts/lib/text.ts` — returns `s` unchanged when `s.length <= max`, else the first `max - 1` chars right-trimmed with `…` appended (result length ≤ `max`).

- [ ] **Step 1: Add a long-summary fixture thread and failing tests**

In `tests/run-tests.ts` fixture-1 block, after `state("delta", ...)` add a long-summary thread and pin its STATE mtime 2 days back (Active threads sort by STATE mtime desc — alpha must stay first for the existing `## Active threads\n- **alpha**` regex):

```ts
state("longsum", "thread", "L".repeat(500));
const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
utimesSync(join(S, "longsum", "STATE.md"), twoDaysAgo, twoDaysAgo);
```

Adding a 4th STATE thread shifts three existing asserts — update them in place:

- where.ts section: `w.includes("3 thread(s)")` → `w.includes("4 thread(s)")`.
- scan.ts section: `ok("4 rows (alpha,beta,gamma,delta)", scLines.length === 4)` → `ok("5 rows (alpha,beta,gamma,delta,longsum)", scLines.length === 5)`.

The `--slugs` expectation changes: update the existing assert

```ts
ok("--slugs = exactly alpha,beta,delta", slugs.join(",") === "alpha,beta,delta");
```

to

```ts
ok("--slugs = exactly alpha,beta,delta,longsum", slugs.join(",") === "alpha,beta,delta,longsum");
```

and update the compile count assert from `"compiled 1 active · 1 hubs · 1 done"` to `"compiled 2 active · 1 hubs · 1 done"`.

Then add new asserts — in the compile-index section (after the existing `idx` asserts):

```ts
const longLine = idx.split("\n").find((l) => l.includes("**longsum**")) ?? "";
ok("oversized summary clipped to ≤240 chars + ellipsis", longLine.includes("…") && longLine.length < 300);
```

and in the threads.ts section:

```ts
const longStatus = t.split("\n").find((l) => l.includes("LLLL")) ?? "";
ok("oversized status clipped to ≤200 chars + ellipsis", longStatus.includes("…") && longStatus.trim().length < 220);
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `bun tests/run-tests.ts`
Expected: FAIL — both clip asserts ✗ (lines are 500+ chars, no `…`).

- [ ] **Step 3: Implement `clip` and wire it in**

Create `plugins/ccx/scripts/lib/text.ts`:

```ts
// Render-time guards for "one-liner" fields — the INDEX/threads dashboards stay a single pane
// even when a STATE's summary/Status has grown into a paragraph (detail belongs in the STATE).

/** Clip to at most `max` chars; overlong input is cut at max-1 (right-trimmed) + `…`.
 *  Never splits a surrogate pair — a cut landing inside one drops the dangling half. */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  let cut = s.slice(0, max - 1);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1); // lone high surrogate
  return cut.trimEnd() + "…";
}
```

(Review amendment: the original plan's one-liner `s.slice(0, max - 1).trimEnd() + "…"` split surrogate pairs; fixed during execution with a covering `isWellFormed()` test. Suite totals from here on are +1 vs the original plan text.)

In `plugins/ccx/scripts/compile-index.ts`: add `import { clip } from "./lib/text";` and change the push (line 67) from

```ts
  all.push({ slug, kind, summary, mtime: st.mtimeMs });
```

to

```ts
  all.push({ slug, kind, summary: clip(summary, 240), mtime: st.mtimeMs });
```

In `plugins/ccx/scripts/threads.ts`: add `import { clip } from "./lib/text";` and change the status assignment so the matched value is clipped:

```ts
  const status = clip(
    txt.match(/^\*\*Status:\*\*\s*(.+)$/m)?.[1]?.trim() ??
      `(none — add a **Status:** line to this ${cfg.state_basename})`,
    200,
  );
```

- [ ] **Step 4: Run tests to verify everything passes**

Run: `bun tests/run-tests.ts`
Expected: PASS, `42/42 passed` (two new asserts; two updated in place). The double-compile byte-identical test must still pass — `clip` is deterministic.

- [ ] **Step 5: Commit**

```bash
git add plugins/ccx/scripts/lib/text.ts plugins/ccx/scripts/compile-index.ts plugins/ccx/scripts/threads.ts tests/run-tests.ts
git commit -m "feat(ccx): clip summaries (240) and status lines (200) at render time

Real-world summaries grew to 2k+ chars, turning the 'single pane' INDEX into
43KB. Skill prose alone doesn't hold; the compiler now enforces it.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `extra_sections` — config-driven live sections in the INDEX

The source deployment's legacy compiler renders an `## Environment` section (tunnel/NATS probes, MCP list) that the plugin dropped at extraction. Add a generic extension point: `extra_sections: [{title, command}]` in `methodology.config.json`; the compiler runs each command via `live()` (5s cap from Task 2) and renders its output as a section right after the INDEX preamble. Empty/failed output → section omitted (same rule as Worktrees/PRs).

**Files:**
- Modify: `plugins/ccx/scripts/lib/config.ts` (type + default + sanitize), `plugins/ccx/scripts/compile-index.ts` (render), `plugins/ccx/README.md` (config docs)
- Test: `tests/run-tests.ts` (fixture-2 config gains two extra sections)

**Interfaces:**
- Consumes: `sanitize()` shape from Task 1; `live()` with timeout from Task 2.
- Produces: `CcxConfig.extra_sections: Array<{ title: string; command: string }>` (default `[]`). Rendered as `## <title>\n<raw trimmed command output>` between the preamble and "## Active threads", in config order.

- [ ] **Step 1: Extend fixture 2's config and add failing tests**

In `tests/run-tests.ts`, change the fixture-2 config write to:

```ts
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
```

In the `// ---------- compile-index: custom root + CRLF ----------` section (Task 2), add after the existing asserts:

```ts
ok("extra section rendered from config command", /## Environment\n- probe UP/.test(idx2));
ok("failing extra command → section omitted", !idx2.includes("## Broken"));
ok("invalid extra entry ignored", !idx2.includes("skipped-invalid"));
ok("extra section sits before Active threads", idx2.indexOf("## Environment") < idx2.indexOf("## Active threads"));
```

Also extend the FIX3 (bad-typed) config JSON with `"extra_sections": {"title": "x"}` and add to the config section:

```ts
ok("non-array extra_sections falls back to []", Array.isArray(bad.extra_sections) && bad.extra_sections.length === 0);
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `bun tests/run-tests.ts`
Expected: FAIL — "extra section rendered…" ✗ (no `## Environment` in the INDEX); the FIX3 assert fails because `extra_sections` is `undefined`.

- [ ] **Step 3: Implement config field + compiler rendering**

In `plugins/ccx/scripts/lib/config.ts`:

Add to the `CcxConfig` type:

```ts
  /** Extra live INDEX sections: each command runs at compile time (5s cap); empty output → omitted. */
  extra_sections: Array<{ title: string; command: string }>;
```

Add to `DEFAULTS`:

```ts
  extra_sections: [],
```

Add to `sanitize()` (before `return out;`):

```ts
  if (Array.isArray(u.extra_sections)) {
    out.extra_sections = u.extra_sections.filter(
      (s): s is { title: string; command: string } =>
        typeof s === "object" && s !== null &&
        typeof (s as Record<string, unknown>).title === "string" && ((s as Record<string, unknown>).title as string).trim().length > 0 &&
        typeof (s as Record<string, unknown>).command === "string" && ((s as Record<string, unknown>).command as string).trim().length > 0,
    ).map((s) => ({ title: s.title, command: s.command }));
  }
```

In `plugins/ccx/scripts/compile-index.ts`, after `const prs = live("gh pr list --limit 12");` add:

```ts
const extras = cfg.extra_sections.flatMap((s) => {
  const out = live(s.command);
  return out ? [`## ${s.title}`, out, ""] : [];
});
```

and in the `md` array, insert `...extras,` between the preamble's closing `"",` and `"## Active threads",`:

```ts
  `> (concurrency-safe: a pure render, atomic write). Detail lives in each STATE. Compiled: ${today}.`,
  "",
  ...extras,
  "## Active threads",
```

- [ ] **Step 4: Run tests to verify everything passes**

Run: `bun tests/run-tests.ts`
Expected: PASS, `47/47 passed`.

- [ ] **Step 5: Document in the plugin README**

In `plugins/ccx/README.md`, inside the `## Configuration (optional)` jsonc block, add after the `script_extensions` line:

```jsonc
  "extra_sections": []               // live INDEX sections: [{"title": "Environment", "command": "bun scripts/env.ts"}]
```

And below the code block add this paragraph:

```markdown
`extra_sections` lets a project inject live sections into the compiled INDEX (environment
probes, service health, anything a command can print). Each command runs at compile time with
a 5s cap; empty or failing output omits the section. Note the INDEX stays a pure render — if
your command's output varies run-to-run, so will those INDEX bytes.
```

- [ ] **Step 6: Commit**

```bash
git add plugins/ccx/scripts/lib/config.ts plugins/ccx/scripts/compile-index.ts plugins/ccx/README.md tests/run-tests.ts
git commit -m "feat(ccx): extra_sections — config-driven live sections in the INDEX

Restores the extraction-dropped Environment-section capability generically:
methodology.config.json lists {title, command} pairs the compiler renders
after the preamble (5s cap, omit-when-empty).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Unicode-aware slugify + `normalizeForMatch` near-duplicate guard

`slugify` strips everything outside `[a-z0-9]`, so any Cyrillic/CJK topic collapses to the literal `"thread"` (every non-Latin topic collides). And in the wild, `CP-1758` and `cp1758` exist as two dirs for one ticket. Keep Unicode letters/numbers in slugs, and add `normalizeForMatch` so start-thread's guard can treat case/separator variants as the same thread.

**Files:**
- Modify: `plugins/ccx/scripts/lib/identity.ts`, `plugins/ccx/skills/start-thread/SKILL.md`
- Test: `tests/run-tests.ts` (identity section — one existing assert changes)

**Interfaces:**
- Consumes: nothing.
- Produces: `slugify(topic: string): string` (now Unicode-preserving) and `normalizeForMatch(slug: string): string` — lowercases and strips all non-letter/non-number chars; two slugs with equal `normalizeForMatch` output name the same thread. Future ticket adapters build on this.

- [ ] **Step 1: Update/add identity tests (they will fail first)**

In `tests/run-tests.ts` identity section, change the existing line

```ts
ok('slugify("héllo wörld") (non-ascii → dashes)', slugify("héllo wörld") === "h-llo-w-rld");
```

to

```ts
ok('slugify("héllo wörld") keeps unicode letters', slugify("héllo wörld") === "héllo-wörld");
```

and add after it:

```ts
ok('slugify("Исправить Баг") stays readable', slugify("Исправить Баг") === "исправить-баг");
const { normalizeForMatch } = await import(join(SCRIPTS, "lib", "identity.ts"));
ok("normalizeForMatch: CP-1758 ≡ cp1758 ≡ cp-1758",
  normalizeForMatch("CP-1758") === "cp1758" && normalizeForMatch("cp-1758") === "cp1758" && normalizeForMatch("cp1758") === "cp1758");
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun tests/run-tests.ts`
Expected: FAIL — unicode asserts ✗ (current output `h-llo-w-rld` / `thread`), `normalizeForMatch` ✗ (not exported).

- [ ] **Step 3: Implement in identity.ts**

Replace `slugify` and add `normalizeForMatch` in `plugins/ccx/scripts/lib/identity.ts`:

```ts
export function slugify(topic: string): string {
  let slug = topic
    .trim()
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const last = slug.charCodeAt(slug.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) slug = slug.slice(0, -1); // truncation split a surrogate pair
  slug = slug.replace(/-+$/, "");
  return slug || "thread";
}

/** Loose identity: slugs that differ only by case/separators name the SAME thread
 *  (CP-1758 ≡ cp-1758 ≡ cp1758). Ticket adapters extend from here. */
export function normalizeForMatch(slug: string): string {
  return slug.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}
```

(Review amendment: the original snippets lacked NFC normalization — NFD input defeated the duplicate guard — and the 60-unit cut could split a surrogate pair; fixed during execution with two covering tests, the NFD one using an explicit `.normalize("NFD")` input.)

(Keep `displayName` unchanged.)

- [ ] **Step 4: Run tests to verify everything passes**

Run: `bun tests/run-tests.ts`
Expected: PASS, `49/49 passed` (the `"___" → "thread"` and ≤60-truncation asserts must still pass).

- [ ] **Step 5: Strengthen the start-thread guard prose**

In `plugins/ccx/skills/start-thread/SKILL.md`, replace step 3:

```markdown
3. **Guard:** if `<scratch_root>/<slug>/` already has a STATE doc (see the injected config block
   for the real paths), STOP — show its first heading and offer to open it instead of clobbering.
```

with

```markdown
3. **Guard:** if `<scratch_root>/<slug>/` already has a STATE doc (see the injected config block
   for the real paths), STOP — show its first heading and offer to open it instead of clobbering.
   Treat slugs as the SAME thread when they match ignoring case and separators (`CP-1758` ≡
   `cp-1758` ≡ `cp1758` — the `normalizeForMatch` rule in `scripts/lib/identity.ts`): a
   near-match in the existing-threads list above → STOP the same way and offer the existing one.
```

- [ ] **Step 6: Commit**

```bash
git add plugins/ccx/scripts/lib/identity.ts plugins/ccx/skills/start-thread/SKILL.md tests/run-tests.ts
git commit -m "feat(ccx): unicode-aware slugify + normalizeForMatch duplicate guard

Non-Latin topics no longer collapse to the 'thread' fallback; start-thread
now treats CP-1758 / cp-1758 / cp1758 as one identity (seen colliding in the
source deployment).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: tidy-scratch ADOPT rule for file-rich STATE-less dirs

The DELETE-throwaway rule (`STATE = NO` AND `age > 14`) would propose deleting a dir with 35 files / 8 scripts of real work (seen in the wild: `job-url-lookup`). File-rich STATE-less dirs should be *adopted* (get a STATE), not deleted.

**Files:**
- Modify: `plugins/ccx/skills/tidy-scratch/SKILL.md`

**Interfaces:** none (prose-only; `scan.ts` already emits the `files` column the rule needs).

- [ ] **Step 1: Update the classification rules**

In `plugins/ccx/skills/tidy-scratch/SKILL.md`, replace the bullet

```markdown
   - **DELETE (throwaway)** — `STATE = NO` AND `age > 14` (no handoff value + cold).
```

with

```markdown
   - **ADOPT (unfiled work)** — `STATE = NO` AND `files > 3` — too much accumulated work to be
     throwaway; propose creating a STATE doc for it (offer /ccx:start-thread), never delete in
     this pass.
   - **DELETE (throwaway)** — `STATE = NO` AND `age > 14` AND `files ≤ 3` (no handoff value +
     cold + tiny).
```

- [ ] **Step 2: Update the safety rails to match**

In the same file, replace the rail

```markdown
- **Hard `rm` is only ever proposed for folders with no STATE doc.** Anything carrying a STATE is
  *archived* (moved under the archive dir), never deleted — its handoff notes survive.
```

with

```markdown
- **Hard `rm` is only ever proposed for folders with no STATE doc AND ≤3 files.** Anything
  carrying a STATE — or carrying real bulk (>3 files) — is *archived* or *adopted*, never
  deleted; its work survives.
```

- [ ] **Step 3: Verify skill still validates and tests still pass**

Run: `claude plugin validate ./plugins/ccx && bun tests/run-tests.ts`
Expected: `✔ Validation passed` and `49/49 passed`.

- [ ] **Step 4: Commit**

```bash
git add plugins/ccx/skills/tidy-scratch/SKILL.md
git commit -m "feat(ccx): tidy-scratch adopts file-rich STATE-less dirs instead of deleting

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Fix stale "2 hooks" docs + bump plugin to 0.3.0

Commit b976963 removed the `block-stray-scripts` hook; three docs still say two hooks. Bump the version for this feature batch.

**Files:**
- Modify: `.claude-plugin/marketplace.json`, `README.md`, `CLAUDE.md`, `plugins/ccx/.claude-plugin/plugin.json`

**Interfaces:** none.

- [ ] **Step 1: Fix the three stale hook counts**

In `.claude-plugin/marketplace.json` change the plugin `description` value from

```
"Portable scratch-notebook core: per-thread STATE.md handoffs + compiled INDEX dashboard, 3 skills + 2 hooks. Language-agnostic, no ticket system required."
```

to

```
"Portable scratch-notebook core: per-thread STATE.md handoffs + compiled INDEX dashboard, 3 skills + a graph-backlink hook. Language-agnostic, no ticket system required."
```

In `README.md` line 36 change

```
  projects (stock + custom config), covering every script and both hooks.
```

to

```
  projects (stock + custom config), covering every script and the backlink hook.
```

In `CLAUDE.md` line 11 change the phrase `and exercises every script and both hooks` to `and exercises every script and the backlink hook`.

- [ ] **Step 2: Bump the plugin version**

In `plugins/ccx/.claude-plugin/plugin.json` change `"version": "0.2.0"` to `"version": "0.3.0"`.

- [ ] **Step 3: Validate both manifests and run the suite**

Run: `claude plugin validate ./plugins/ccx && claude plugin validate . && bun tests/run-tests.ts`
Expected: both `✔ Validation passed`, `49/49 passed`.

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/marketplace.json README.md CLAUDE.md plugins/ccx/.claude-plugin/plugin.json
git commit -m "docs(ccx): fix stale two-hook references; bump plugin to 0.3.0

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: CI workflow — tests + plugin validation on every push/PR

`.github/workflows/` only has `announce-release.yml`; nothing runs the suite.

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:** none.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - name: Run test suite
        run: bun tests/run-tests.ts
      - name: Install Claude Code CLI
        run: npm install -g @anthropic-ai/claude-code
      - name: Validate plugin + marketplace manifests
        run: |
          claude plugin validate ./plugins/ccx
          claude plugin validate .
```

(If the `claude plugin validate` steps turn out to require authentication in CI, drop the last two steps and keep the bun test step — tests are the load-bearing gate.)

- [ ] **Step 2: Sanity-check the workflow locally**

Run: `bun tests/run-tests.ts && bun -e 'const y = require("fs").readFileSync(".github/workflows/ci.yml","utf8"); console.log(y.includes("bun tests/run-tests.ts") ? "workflow references the suite" : "MISSING suite step")'`
Expected: `49/49 passed` then `workflow references the suite`.

- [ ] **Step 3: Commit and push, then watch the run**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run test suite + plugin validation on push and PR

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
gh run watch --exit-status || gh run view --log-failed
```

Expected: the `ci` workflow goes green. If the validate steps fail on auth, apply the fallback from Step 1 (delete the CLI install + validate steps), commit as `ci: drop claude validate (needs auth); keep bun tests`, and re-push.

---

## Out of scope for this plan (follow-up)

The rjf-auto-apply-microservice legacy de-duplication (removing its duplicated backlink hook + legacy save-state/tidy-scratch skills, porting its Environment section onto `extra_sections`, folding its Linear-awareness into project CLAUDE.md guidance) is a separate ops change in a different repo whose `.claude/` is **not git-tracked** (moves must be reversible by archiving, not deletion). It depends on this plan shipping 0.3.0 and is executed as its own follow-up.
