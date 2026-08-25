---
type: bug
record_id: bug-8d302991e94f45cabd67e64870d64ca7
date: 2026-08-25
title: Scheduler DryRun dropped command authors
source: user-report
severity: high
status: resolved
key_conclusion: Combined Guardian startup no longer fails preflight with empty command_authors because scheduler DryRun now validates and propagates binding or argument authors without mutating config.
topics: [qa-guardian, launcher, command-authors]
---

## Bug Description

Launching the combined Guardian entrypoint for `D:\tuantuanrent` failed during scheduler preflight:

```text
command_authors 为空：请先不带 -Yes 运行一次，输入可信 GitHub 登录名，例如 goudaren0528。
Scheduler preflight failed. Fix the error above before opening the read-only TUI.
```

The existing per-project launcher binding already contained `command_authors: ["goudaren0528"]`, and `guardian-start.ps1` resolved it into `-CommandAuthors goudaren0528` for the scheduler preflight.

## Root Cause

`guardian-start.ps1` intentionally preflights the scheduler by appending `-DryRun` to the real scheduler arguments. `scheduler-start.ps1` only populated `$bindingAuthors` inside `if (-not $Dashboard -and -not $DryRun)`, so the preflight path skipped both persisted binding authors and explicit `-CommandAuthors`. Later config validation saw the control repo config's empty or missing `command_authors` and failed under `-Yes`.

## Solution

Moved scheduler author resolution ahead of the `-DryRun` write guard:

- Dashboard still skips author resolution.
- Existing binding authors are validated and used for both live and DryRun paths.
- Explicit `-CommandAuthors` is validated and used for both live and DryRun paths when the binding lacks authors.
- Binding/config writes remain live-only, preserving DryRun's no-mutation contract.

## Prevention Measures

Added a launcher regression test asserting that DryRun propagates provided command authors into preflight before any write guard, and kept the fail-closed `-Yes` behavior for missing authors.

## Related Changes

- `tools/guardian/scheduler-start.ps1`
- `tests/guardian/bat-launchers.test.mjs`

Verified with:

- `node --test tests/guardian/bat-launchers.test.mjs tests/guardian/guardian-start.test.mjs` passed 40/40.
- `node --test "tests/guardian/*.test.mjs"` passed 743/743.
- Real scheduler preflight now prints `Command authors: goudaren0528` and returns the DryRun launch plan for `D:\tuantuanrent`.
