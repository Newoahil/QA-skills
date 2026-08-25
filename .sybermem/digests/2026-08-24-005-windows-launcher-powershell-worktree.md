---
type: digest
kind: phase
date: 2026-08-24
number: 005
title: Windows launcher, bat/PowerShell startup & worktree bootstrap fixes
status: completed
source_records:
  - changes/2026-08-20-change-5cb23fed3750411f9d0a01fddae5f6de-per-project-launcher-bindings.md
  - changes/2026-08-20-change-cabd52ea36184a8885927911ff2e029e-launcher-project-switch-and-tool-warning.md
  - changes/2026-08-20-change-ecc5d2f7577c49eb97ff1943f33fd5b0-guardian-two-bat-launchers.md
  - changes/2026-08-20-change-8566e0c1beed41e28dc4c9b6eed93fa8-guardian-target-worktree-runtime.md
  - changes/2026-08-21-change-fc28793f11104036ad20f0cb288bda6f-guardian-launcher-windows-startup.md
  - bugs/2026-08-20-bug-01f49ed7e02b41eba58ccc630c6170d0-scheduler-start-git-stderr.md
  - bugs/2026-08-20-bug-1a8b3cf22fc9424ba73e009dd9c4556d-worktree-command-authors-bootstrap.md
  - bugs/2026-08-20-bug-4efe5578aa8742ad884e419e62a1126d-powershell-newerthan-dynamic-parameter.md
  - bugs/2026-08-20-bug-5a7a143fe7f84b4e9ab88dc922c2511b.md
  - bugs/2026-08-20-bug-72dbe209aad24697a5bf36ffdf0b7a88-stale-launcher-newerthan.md
  - bugs/2026-08-20-bug-83b7d5b7c85e4316adc6fa751321262a-dashboard-wrapper-and-first-run-prompts.md
  - bugs/2026-08-20-bug-986e8e7b64f046c1bedbacbcbc65a083-scheduler-start-tools-branch.md
  - bugs/2026-08-20-bug-99e2cc66c7d34cd28e3bf20ea38814cd-command-authors-property.md
  - bugs/2026-08-20-bug-9ea4fabc7f0948ac9dcdf159659e61de-control-porcelain-offset.md
  - bugs/2026-08-20-bug-c9d39c21fcd640948f061bf092488b1b-newerthan-root-and-control-config.md
  - bugs/2026-08-20-bug-d6d62a18f2394518ad9ee12f20e35315-scheduler-start-git-args.md
  - bugs/2026-08-20-bug-e4748d924c68474b878a8da0c79c88a2-snapshot-diff-and-target-prompt.md
  - bugs/2026-08-24-bug-43128e7037e3460a95030c310a0af7f5-gh-preflight-transient-auth.md
  - bugs/2026-08-24-bug-432ac9e0feec425a91229512c7603ac9-dirty-fixer-launcher-recovery.md
coverage:
  from: 2026-08-20
  to: 2026-08-24
coverage_hash: d1b240713596c844ee9c948c9ae53d711bc99699c80d6cc7eb2b096b08148e00
---

## Phase Scope
The Windows-specific launcher and worktree hardening arc: per-project launcher bindings, control-worktree isolation of dirty target projects, and a dense cluster of PowerShell 5.1 / git-porcelain / gh-CLI startup bugs. This is where Guardian became robust to real double-click operation on Windows.

## Core Conclusions
- Launcher bindings are **stored independently per canonical target path**: explicitly switching projects selects only that project's mode / control worktree / QA snapshot / config, while a no-argument launch reuses the last target.
- Guardian isolates a **dirty target project into a clean control worktree + selected QA runtime snapshot** (a one-time persisted launcher choice), so unattended fixing stays safe while QA can test an explicit current snapshot.
- The recurring **`NewerThan` DateTime binding error is a PowerShell 5.1 parsing hazard**: an unparenthesized `Test-Path` before `-and`/`-or` makes PS 5.1 bind a following SHA-256 string as `Test-Path -NewerThan`; parenthesizing `Test-Path` is the fix. A separately reported `NewerThan` failure traced to a *stale/different* launcher, not the current 578-line `scheduler-start.ps1` (which has no `NewerThan`) — now guarded by a regression.
- Control-worktree cleanliness checks must treat **`.qa/guardian` and `.sybermem` as Guardian-owned** and parse git porcelain from the correct status-column offset, so Guardian's own state does not look like an external dirty change — without hiding real external changes; the existing control config is authoritative and must not be re-compared to the developer checkout.
- PowerShell 5.1 quirks: add a missing `command_authors` JSON property with `Add-Member -Force` (not direct assignment); write BOM-free UTF-8 config; capture benign git fetch/diff/apply stderr so successful-fetch progress or CRLF warnings are not promoted to terminating errors that abort startup.
- Operational safety: the tools repo is checked against the **current branch upstream** (not hardcoded `main`) so local launcher fixes run before merge; the launcher **always asks for a target directory** when none is passed so projects can't be switched accidentally; a clean-but-behind local tools checkout runs with a warning instead of being blocked.
- gh-CLI preflight uses a **retried `gh api user` auth probe + separate repo-access probe** so transient GitHub CLI failures don't masquerade as logged-out; recovery resumes only plan-scoped dirty fix branches and decodes Guardian JSON artifacts explicitly as UTF-8.

## Key Decisions and Changes
- Per-project launcher bindings; project-switch + tool-version warning; two `.bat` launchers; target-worktree + QA runtime separation; Windows startup regression fix (npm `opencode.cmd` preferred, `-CommandAuthors` comma/space normalization).
- ~14 startup bugs fixed: git stderr capture, worktree command-authors bootstrap, `NewerThan` parenthesization + stale-launcher guard + root-cause/control-config authority, control worktree Guardian-state awareness, porcelain offset, tools-branch preflight, PS `Add-Member` authors property, dashboard ASCII wrapper + first-run prompt reduction, snapshot-diff stderr + per-run target prompt, gh preflight transient-auth, dirty fixer launcher recovery.

## Current State
Windows double-click operation is robust: project switching is explicit and isolated, PowerShell 5.1 parsing traps are guarded, and transient git/gh noise no longer aborts startup. This closes the launcher hazard class opened in digest-002.

## Recommended Next Reads
- digest-002 — the first-generation launchers and ops readiness this phase hardens.
- digest-006 — the dashboard/TUI observability that runs alongside these launchers.
- digest-007 — runtime reliability (scheduler startup ReferenceError, shared serve) overlapping this window.

## Source Coverage
19 records (5 changes + 14 bugs), 2026-08-20 to 2026-08-24, covering Windows launcher / PowerShell / worktree / gh-CLI startup.
