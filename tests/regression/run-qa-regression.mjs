// QA skill bounded-QA regression runner.
//
// Runs one or more bounded-QA cases against the current (prior-style) qa skill via a
// direct opencode invocation, captures the JSON event stream, extracts the final report,
// and records token / skill-load / read-only markers. Then a marker/token recompute can
// be run from already-captured jsonl at ZERO model cost with --recompute.
//
// This runner NEVER installs anything and only reads the local provider config via opencode.
// It is opt-in: it spawns opencode (which calls a real model and costs tokens) unless
// --recompute is passed.
//
// Usage:
//   node run-qa-regression.mjs <caseId> [<caseId> ...]
//   node run-qa-regression.mjs --all
//   node run-qa-regression.mjs --recompute <caseId>   (re-parse saved jsonl, no model call)
//   node run-qa-regression.mjs --list                 (print known case ids + resolved paths)
//
// Environment overrides (all optional; defaults target the P8/P12 local setup on Windows):
//   QA_OPENCODE_BIN     path to the opencode executable
//   QA_MODEL            model id (default cpa/gpt-5.5)
//   QA_OUT_ROOT         output root dir for per-case artifacts
//   QA_BOUNDED_ROOT     root holding the pre-fix case workspaces (…/cases)
//   QA_NEXTAUTH_PRE_WS  workspace path for the nextauth pre-fix snapshot
//   QA_NEXTAUTH_POST_WS workspace path for the nextauth post-fix snapshot
//   QA_TIMEOUT_MS       per-case opencode timeout (default 900000)
//
// See README.md in this directory for the case corpus and how to (re)build the workspaces.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const env = process.env;
const OPENCODE = env.QA_OPENCODE_BIN
  || "C:\\Users\\lhw\\AppData\\Roaming\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe";
const MODEL = env.QA_MODEL || "cpa/gpt-5.5";
const OUT_ROOT = env.QA_OUT_ROOT
  || "C:\\Users\\lhw\\AppData\\Local\\Temp\\opencode\\qa-v3-verify";
const BOUNDED_ROOT = env.QA_BOUNDED_ROOT
  || "C:\\Users\\lhw\\AppData\\Local\\Temp\\opencode\\bounded-issue-ab\\run-20260813-10case\\cases";
const NEXTAUTH_PRE_WS = env.QA_NEXTAUTH_PRE_WS
  || "C:\\Users\\lhw\\AppData\\Local\\Temp\\opencode\\p3m\\nxa-full";
const NEXTAUTH_POST_WS = env.QA_NEXTAUTH_POST_WS
  || "C:\\Users\\lhw\\AppData\\Local\\Temp\\opencode\\qa-v3-postfix\\next-auth";
const TIMEOUT_MS = Number(env.QA_TIMEOUT_MS || 900000);

const CASES = {
  "fake-timers-541-pre": {
    ws: join(BOUNDED_ROOT, "fake-timers-541-pre", "workspaces", "qa-skill"),
    pr: "https://github.com/sinonjs/fake-timers/pull/541",
    title: "sinonjs/fake-timers PR#541 timer calibration change",
    context: "A change to timer scheduling/advance behavior that can subtly miscalibrate fired timers.",
    scope: "Only the bounded timer-scheduling change in this PR snapshot (pre-fix state).",
    expect: "FAIL",
  },
  "claude-skill-check-pre": {
    ws: join(BOUNDED_ROOT, "claude-skill-check-pre", "workspaces", "qa-skill"),
    pr: "(internal) claude-skill-check validator boundary bug",
    title: "Validator boundary bug, low complexity",
    context: "A name/length validator whose boundary handling is off (e.g. off-by-one on max length).",
    scope: "Only the bounded validator boundary logic in this pre-fix snapshot.",
    expect: "FAIL",
  },
  "js-yaml-155-pre": {
    ws: join(BOUNDED_ROOT, "js-yaml-155-pre", "workspaces", "qa-skill"),
    pr: "https://github.com/nodeca/js-yaml/pull/155",
    title: "js-yaml PR#155 YAML parsing",
    context: "A YAML parsing behavior change around specific scalar/null forms.",
    scope: "Only the bounded YAML-parsing change in this pre-fix snapshot.",
    expect: "FAIL",
  },
  "dig-pr2-pre": {
    ws: join(BOUNDED_ROOT, "dig-pr2-pre", "workspaces", "qa-skill"),
    pr: "https://github.com/DIG-Network/create-dig-app/pull/2",
    title: "create-dig-app PR#2 NFT metadata contract",
    context: "NFT metadata / API contract change with vendored-template and spec/test implications.",
    scope: "Only the bounded metadata-contract change in this pre-fix snapshot.",
    expect: "FAIL",
  },
  "nextauth-13465-pre": {
    ws: NEXTAUTH_PRE_WS,
    pr: "https://github.com/nextauthjs/next-auth/pull/13465",
    title: "next-auth PR#13465 stale session fetch after signOut race (pre-fix)",
    context: "Auth/session race where stale session fetches can resurrect session/cookie state after signOut. This snapshot is PRE-FIX (bug present), commit 1116034334c63db84de632d076a8fb0ad8bcec8e.",
    scope: "Only the bounded auth/session stale-fetch behavior in this pre-fix snapshot.",
    expect: "FAIL",
  },
  "nextauth-13465-post": {
    ws: NEXTAUTH_POST_WS,
    pr: "https://github.com/nextauthjs/next-auth/pull/13465",
    title: "next-auth PR#13465 prevent stale session fetch from resurrecting session after signOut (post-fix)",
    context: "This snapshot is POST-FIX (PR head e7a32ba19ce4869437f460b30c69dec750adb63d). The fix adds AbortController/abortFetches guards so a stale session fetch that resolves after signOut cannot resurrect the session. This is a false-positive control: correct QA is PASS.",
    scope: "Only the bounded auth/session stale-fetch guard in this post-fix snapshot.",
    expect: "PASS",
  },
};

function buildPrompt(c) {
  return [
    "Please QA this bounded Issue/PR/change.",
    "",
    `Target repository path: ${c.ws}`,
    `Public reference: ${c.pr}`,
    `Title: ${c.title}`,
    `Context: ${c.context}`,
    `Scope: ${c.scope}`,
    "Non-goals: do not modify product files, do not install dependencies, do not access network or production services, do not make a release decision.",
  ].join("\n");
}

function extractFinalReport(stdout) {
  let last = null;
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    let ev;
    try { ev = JSON.parse(t); } catch { continue; }
    if (ev?.type === "text" && ev?.part?.type === "text" && typeof ev.part.text === "string") {
      last = ev.part.text;
    }
  }
  return last;
}

function eachEvent(stdout) {
  const out = [];
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try { out.push(JSON.parse(t)); } catch { /* skip */ }
  }
  return out;
}

function collectStats(stdout) {
  let input = 0, output = 0, reasoning = 0, cacheRead = 0, toolUse = 0, facet = 0;
  const facetSeen = [];
  const skillLoads = [];
  for (const ev of eachEvent(stdout)) {
    // opencode emits type "step-finish" (hyphen) with part.tokens { total, input, output, reasoning, cache: { read, write } }
    const type = ev?.type;
    const part = ev?.part;
    if ((type === "step-finish" || type === "step_finish") && part?.tokens) {
      const tk = part.tokens;
      input += tk.input || 0;
      output += tk.output || 0;
      reasoning += tk.reasoning || 0;
      const cr = (tk.cache && typeof tk.cache === "object") ? (tk.cache.read || 0) : (tk.cache_read || 0);
      cacheRead += cr;
    }
    // tool calls: type "tool_use" with part.type === "tool"
    if (type === "tool_use" && part?.type === "tool") {
      toolUse++;
      const toolName = part.tool;
      const input0 = part?.state?.input || {};
      if (toolName === "skill" && input0.name) {
        skillLoads.push({ name: input0.name, dir: part?.state?.metadata?.dir || null });
      }
      if (toolName === "task") {
        const st = JSON.stringify(input0);
        if (/qa-facet/i.test(st)) { facet++; facetSeen.push(st.slice(0, 200)); }
      }
    }
  }
  // "total" = input + output + reasoning (matches P8/P12 convention; cacheRead listed separately)
  return { input, output, reasoning, cacheRead, total: input + output + reasoning, toolUse, facet, facetSeen, skillLoads };
}

function loadEvidenceMarkers(stdout, report) {
  let newSkillPath = false;
  let oldBackup = false;
  let oldSubskills = false;
  for (const ev of eachEvent(stdout)) {
    const part = ev?.part;
    if (ev?.type === "tool_use" && part?.type === "tool" && part.tool === "skill") {
      const name = part?.state?.input?.name || "";
      const dir = part?.state?.metadata?.dir || "";
      if (/qa-skill-old-backup/i.test(dir) || /qa-skill-old-backup/i.test(name)) oldBackup = true;
      if (name === "qa-skill" && !/old-backup/i.test(dir)) newSkillPath = true;
      if (/^(qa-triage|qa-plan|qa-execute|qa-conclude|qa-lite)$/i.test(name)) oldSubskills = true;
      if (name.toLowerCase() === "using-qa") oldSubskills = true; // old loadable sub-skill, not the reference file
    }
  }
  const oldSections = report ? /(Applicability Matrix|QA Conclusion Gate|Report Quality Self-Check|Profile Decision|Change Intake)/i.test(report) : false;
  const overall = report ? (report.match(/Overall Status:\s*([A-Z_]+)/) || [])[1] || null : null;
  return { oldSubskills, oldBackup, newSkillPath, oldSections, overall };
}

function runCase(caseId) {
  const c = CASES[caseId];
  if (!c) throw new Error(`unknown case ${caseId}`);
  if (!existsSync(c.ws)) throw new Error(`workspace missing: ${c.ws} (set the matching QA_* env var or rebuild it; see README.md)`);
  const outDir = join(OUT_ROOT, caseId);
  mkdirSync(outDir, { recursive: true });
  const prompt = buildPrompt(c);
  const startedAt = new Date().toISOString();
  const args = ["run", "--agent", "qa", "--format", "json", "--model", MODEL, "--auto", "--dir", c.ws, prompt];
  const res = spawnSync(OPENCODE, args, {
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    maxBuffer: 200 * 1024 * 1024,
    windowsHide: true,
  });
  const endedAt = new Date().toISOString();
  const stdout = res.stdout || "";
  const stderr = res.stderr || "";
  writeFileSync(join(outDir, "opencode-events.jsonl"), stdout, "utf8");
  if (stderr) writeFileSync(join(outDir, "stderr.txt"), stderr, "utf8");
  const report = extractFinalReport(stdout);
  if (report) writeFileSync(join(outDir, "final-report.md"), report, "utf8");
  const stats = collectStats(stdout);
  const markers = loadEvidenceMarkers(stdout, report);
  const terminal = {
    caseId,
    status: res.status,
    signal: res.signal || null,
    error: res.error ? String(res.error) : null,
    startedAt,
    endedAt,
    finalReportBytes: report ? Buffer.byteLength(report, "utf8") : 0,
    expected: c.expect,
    stats,
    markers,
  };
  writeFileSync(join(outDir, "terminal.json"), JSON.stringify(terminal, null, 2), "utf8");
  return terminal;
}

// Recompute markers/stats from an already-captured jsonl WITHOUT calling opencode (zero token cost).
function recomputeCase(caseId) {
  const c = CASES[caseId];
  const outDir = join(OUT_ROOT, caseId);
  const jsonlPath = join(outDir, "opencode-events.jsonl");
  if (!existsSync(jsonlPath)) throw new Error(`no captured jsonl to recompute: ${jsonlPath}`);
  const stdout = readFileSync(jsonlPath, "utf8");
  const report = extractFinalReport(stdout);
  const stats = collectStats(stdout);
  const markers = loadEvidenceMarkers(stdout, report);
  let prev = {};
  const tj = join(outDir, "terminal.json");
  if (existsSync(tj)) { try { prev = JSON.parse(readFileSync(tj, "utf8")); } catch { /* ignore */ } }
  const terminal = {
    caseId,
    status: prev.status ?? null,
    signal: prev.signal ?? null,
    error: prev.error ?? null,
    startedAt: prev.startedAt ?? null,
    endedAt: prev.endedAt ?? null,
    finalReportBytes: report ? Buffer.byteLength(report, "utf8") : 0,
    expected: c?.expect ?? null,
    stats,
    markers,
    recomputed: true,
  };
  writeFileSync(tj, JSON.stringify(terminal, null, 2), "utf8");
  return terminal;
}

const argv = process.argv.slice(2);

if (argv.includes("--list")) {
  console.log("Known cases (id -> workspace):");
  for (const [id, c] of Object.entries(CASES)) {
    console.log(`  ${id.padEnd(24)} expect=${c.expect.padEnd(4)} ws=${c.ws} ${existsSync(c.ws) ? "" : "[MISSING]"}`);
  }
  console.log(`\nopencode: ${OPENCODE} ${existsSync(OPENCODE) ? "" : "[MISSING]"}`);
  console.log(`model:    ${MODEL}`);
  console.log(`outRoot:  ${OUT_ROOT}`);
  process.exit(0);
}

const RECOMPUTE = argv.includes("--recompute");
const rest = argv.filter((a) => a !== "--recompute" && a !== "--all" && a !== "--list");
const ids = argv.includes("--all") ? Object.keys(CASES) : rest;
if (ids.length === 0) {
  console.error("no case id given. use a caseId, --all, --list, or add --recompute");
  process.exit(2);
}
const summary = [];
for (const id of ids) {
  console.log(`\n===== ${RECOMPUTE ? "RECOMPUTING" : "RUNNING"} ${id} =====`);
  try {
    const t = RECOMPUTE ? recomputeCase(id) : runCase(id);
    summary.push(t);
    console.log(JSON.stringify({
      caseId: t.caseId,
      status: t.status,
      overall: t.markers.overall,
      expected: t.expected,
      finalReportBytes: t.finalReportBytes,
      newSkillPath: t.markers.newSkillPath,
      oldBackup: t.markers.oldBackup,
      oldSubskills: t.markers.oldSubskills,
      oldSections: t.markers.oldSections,
      facet: t.stats.facet,
      totalTokens: t.stats.total,
      toolUse: t.stats.toolUse,
    }, null, 2));
  } catch (e) {
    console.error(`FAILED ${id}: ${e.message}`);
    summary.push({ caseId: id, error: e.message });
  }
}
mkdirSync(OUT_ROOT, { recursive: true });
writeFileSync(join(OUT_ROOT, "run-summary.json"), JSON.stringify(summary, null, 2), "utf8");
console.log(`\n===== SUMMARY WRITTEN to ${join(OUT_ROOT, "run-summary.json")} =====`);
