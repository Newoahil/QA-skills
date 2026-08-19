---
type: change
record_id: change-9075ddb15f55461cba237c8f6c302f95
date: 2026-08-19
title: Fix Windows spawn of opencode (resolve opencode.exe)
status: done
key_conclusion: Fixed a Windows-only bug where the QA Guardian scheduler could not spawn the opencode agent (ENOENT/EINVAL on shell:false), by resolving the real opencode.exe per platform, so the enforced investigation/fixer chain actually runs on Windows.
topics: [qa-guardian, windows, spawn]
author: goudaren0528
related_files: [tools/guardian/opencode-bin.mjs, tools/guardian/investigation-process.mjs, tools/guardian/scheduler.mjs, tests/guardian/opencode-bin.test.mjs]
related: [change-5e5f9e3456464cb598ba51d705ffc945]
---

## Change Content
Fixed the Windows opencode spawn bug found by the real E2E run of issue #205.
- New `tools/guardian/opencode-bin.mjs`: `resolveOpencodeBin()` returns the real
  opencode executable per platform — on Windows the npm shim `opencode.cmd`
  ultimately calls `<APPDATA>/npm/node_modules/opencode-ai/bin/opencode.exe`,
  which IS spawnable with `shell:false`; on POSIX the bare `opencode` on PATH.
  Supports `QA_GUARDIAN_OPENCODE_BIN` env override, and a `.cmd` fallback.
- Wired into both spawn sites that launch the agent with `shell:false`:
  `investigation-process.mjs` (specialist runAgentJson) and `scheduler.mjs`
  (`runInvocation`, which spawns the qa-guardian fixer).
- Added 6 unit tests for the resolver (win32 exe, .cmd fallback, posix, env
  override, candidate paths).

## Reason for Change
The real E2E run exposed that `spawn('opencode', ..., { shell:false })` fails on
Windows with ENOENT (opencode is a `.cmd`/`.ps1` npm shim, not on PATH as an
.exe) — and, on hardened Node, spawning the `.cmd` shim without a shell throws
EINVAL. The codebase deliberately uses `shell:false` because the agent prompt
contains issue-derived text that must never be shell-interpreted (injection
safety). The fix resolves the actual `opencode.exe` so it stays shell:false-safe
and works on Windows. This was only found by a real E2E run, not by unit tests
(which inject spawn).

## Impact Scope
Additive: one new pure module + one test file; two spawn sites updated to use
the resolver. No change to STATES, labels, dispatch descriptors, the
authorization model, or `poll.test.mjs` (the `invokeArgv.cmd` descriptor stays
the logical name 'opencode'; only the actual spawn resolves the platform binary).
Verified: real `spawn(opencode.exe, ['--version'], {shell:false})` returns
exit=0 version=1.18.18 on this machine.

## Implementation
The resolver takes env + platform (+ injectable existsSync) so it is unit
testable. On win32 it checks APPDATA and npm_config_prefix candidate paths for
the real exe, falling back to `opencode.cmd`. `scheduler.mjs` maps the logical
`invokeArgv.cmd === 'opencode'` to the resolved bin at the spawn point only.

## Test Verification
Full suite: 263/263 green (257 baseline + 6 new resolver tests). Real spawn
verified: resolved path is the actual opencode.exe and `spawn(..., {shell:false})`
succeeds with exit=0 (no ENOENT, no EINVAL).

## Notes
Found via the real E2E of issue #205 on tuantuanrent: the scheduler discovered
#205, launched the enforced investigation (N=1 lock held, 3 specialists running)
but the opencode spawn failed. After this fix the specialists launch correctly.
The investigation itself later timed out at 30min for guardian-code (a separate,
config-budget matter), unrelated to this spawn fix.
