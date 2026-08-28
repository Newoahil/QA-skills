# Bounded-QA regression harness

`run-qa-regression.mjs` drives the current global `qa-skill` (prior-style) over a small set of
real bounded-QA cases, captures each run's JSON event stream, extracts the final report, and
records token / skill-load / read-only markers. It is the harness used for the P12 v3 regression
(`docs/p12-v3-regression-results.md`).

This is an opt-in, cost-bearing tool: running a case spawns `opencode` against a real model.
Use `--recompute` to re-derive markers/stats from an already-captured `opencode-events.jsonl`
at zero model cost.

## What it checks (facts, not a ship decision)

Per case it records:

- `Overall Status:` value vs the case's `expect` (pre-fix cases -> FAIL; the post-fix control -> PASS).
- Whether the loaded skill is the new prior (`skill` tool `metadata.dir` ends in `skills/qa-skill`,
  not `qa-skill-old-backup`); and that no old pipeline sub-skills were loaded.
- Whether the report is free-form with the single mandatory `Overall Status:` line (no old
  Applicability Matrix / Conclusion Gate / Profile Decision sections).
- Token totals (`input+output+reasoning`; `cacheRead` listed separately) and tool-use count.
- Whether a `qa-facet` subagent was dispatched.
- Read-only: whether any edit-product-file / install-dependency attempt or permission denial appeared.

It does not re-apply the P8 6-dimension quality rubric; that scoring is qualitative and done by hand.

## Case corpus

| Case id | Snapshot | Expect | Source |
|---|---|---|---|
| `fake-timers-541-pre` | pre-fix | FAIL | sinonjs/fake-timers PR#541 |
| `claude-skill-check-pre` | pre-fix | FAIL | internal validator boundary bug |
| `js-yaml-155-pre` | pre-fix | FAIL | nodeca/js-yaml PR#155 |
| `dig-pr2-pre` | pre-fix | FAIL | DIG-Network/create-dig-app PR#2 |
| `nextauth-13465-pre` | pre-fix | FAIL | nextauthjs/next-auth PR#13465 (bug present, commit `1116034...`) |
| `nextauth-13465-post` | post-fix | PASS | nextauthjs/next-auth PR#13465 head `e7a32ba1...` (false-positive control) |

The `nextauth-13465-post` case is the false-positive control: on FIXED code the correct verdict is
PASS. It exists so the suite can show the skill distinguishes a bug from its fix, not just that it
flags bugs.

## Workspaces are external (not committed)

The case workspaces are large real repositories kept outside this repo (defaults point at local
temp paths from the P8/P12 setup). The harness only references them; it does not vendor them.
Override any path via environment variables:

```
QA_OPENCODE_BIN      path to the opencode executable
QA_MODEL             model id (default cpa/gpt-5.5)
QA_OUT_ROOT          output root for per-case artifacts
QA_BOUNDED_ROOT      root holding the pre-fix case workspaces (the .../cases dir)
QA_NEXTAUTH_PRE_WS   nextauth pre-fix workspace
QA_NEXTAUTH_POST_WS  nextauth post-fix workspace
QA_TIMEOUT_MS        per-case opencode timeout (default 900000)
```

Run `node run-qa-regression.mjs --list` to see the resolved paths and which workspaces are present.

### Rebuilding the nextauth post-fix workspace

If the post-fix workspace is missing, rebuild it (network + git required; no dependency install
or build is needed - QA verifies read-only against source):

```
git clone https://github.com/nextauthjs/next-auth.git <dir>
git -C <dir> fetch origin pull/13465/head:pr-13465
git -C <dir> checkout e7a32ba19ce4869437f460b30c69dec750adb63d
```

Then point `QA_NEXTAUTH_POST_WS` at `<dir>`. The fix adds `AbortController` / `abortFetches`
guards in `packages/next-auth/src/react.tsx` (grep to confirm they are present).

## Usage

```
# List known cases and resolved paths (no cost)
node run-qa-regression.mjs --list

# Run one case (spawns opencode; costs tokens)
node run-qa-regression.mjs fake-timers-541-pre

# Run every case
node run-qa-regression.mjs --all

# Re-derive markers/stats from already-captured jsonl (zero model cost)
node run-qa-regression.mjs --recompute fake-timers-541-pre
```

Per-case artifacts are written under `QA_OUT_ROOT/<caseId>/`:
`opencode-events.jsonl`, `final-report.md`, `terminal.json`. A combined `run-summary.json`
is written at the output root.

## Read-only / no-install discipline

The harness itself installs nothing and only reads the local provider config through opencode.
The `qa` agent it drives is read-only by mechanism (product files `edit: deny`; install/network
denied). Several cases deliberately hit missing test tooling (pytest / mocha / vitest / node_modules);
correct behavior is to fall back to a runtime probe and record residual risk, never to install.
