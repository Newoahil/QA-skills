---
record_id: change-ecc5d2f7577c49eb97ff1943f33fd5b0
key_conclusion: Added separate Windows one-click launchers for Guardian scheduler and read-only Dashboard so operators can double-click two windows instead of memorizing commands.
topics:
  - qa-guardian
  - windows-launcher
  - dashboard
---

# Change: Guardian two-bat Windows launch flow

## Change content

Added `tools/guardian/dashboard-start.bat` and `tools/guardian/dashboard-start.ps1` as a separate one-click read-only Dashboard launcher alongside the existing `scheduler-start.bat` scheduler launcher.

The Dashboard bat delegates to PowerShell with `-ExecutionPolicy Bypass`; the PowerShell wrapper resolves Node from PATH, common install paths, and nvm-windows, resolves the target repo from the argument, `QA_GUARDIAN_REPO`, current `.qa/guardian/config.json`, or an interactive prompt, then runs `dashboard.mjs --watch 5`.

Docs now explain the two-window flow:

- `scheduler-start.bat D:\project` starts real Guardian watch mode.
- `dashboard-start.bat D:\project` starts the read-only Chinese dashboard and session-view guidance.

## Reason

The operator workflow should be double-clickable: one window runs unattended Guardian work, and a second window observes queue/session state. Dashboard observation should not require GitHub preflight or start the scheduler because it is read-only and should be available even when the user only wants visibility.

## Impact scope

- Keeps the existing scheduler launcher unchanged for real watch-mode startup.
- Adds a lightweight Dashboard launcher that does not run GitHub auth checks, clean/latest checks, scheduler, Feishu runtime, or state writes.
- Uses ASCII in the new PowerShell wrapper to avoid Windows PowerShell 5.1 parsing failures for UTF-8 no-BOM Chinese strings; the Node dashboard itself remains Chinese.
- Adds launcher regression tests covering both bat files and the Dashboard PowerShell wrapper.

## Verification

- `npm install` -> up to date, 0 vulnerabilities
- `cmd.exe /c "tools\guardian\dashboard-start.bat D:\QA-skills"` -> starts wrapper and reaches Chinese dashboard output; command was manually timeout-stopped because `--watch` is long-running
- PowerShell parser check for `tools/guardian/dashboard-start.ps1` -> pass
- `node --test "tests/guardian/bat-launchers.test.mjs"` -> pass
- `node --test "tests/guardian/*.test.mjs"` -> 430/430 pass
