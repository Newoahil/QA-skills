---
record_id: change-35fabb09ed8e4e00bb48259a4f4ee8af
key_conclusion: Added a read-only Chinese Guardian dashboard and OpenCode session viewer so operators can see queue state and inspect real agent conversations without mutating Guardian state.
topics:
  - qa-guardian
  - dashboard
  - opencode-sessions
---

# Change: Guardian dashboard and session viewer MVP

## Change content

Implemented a read-only CLI visibility layer for QA Guardian:

- `tools/guardian/dashboard.mjs` renders a Chinese dashboard for `.qa/guardian/*.json` issue state, with `--repo`, `--watch`, `--json`, `--state`, and `--issue` modes.
- `tools/guardian/session-view.mjs` renders real OpenCode session messages either by direct `--session` or by resolving `--repo --issue --agent` from Guardian state.
- `tools/guardian/dashboard-model.mjs`, `dashboard-errors.mjs`, and `session-transcript.mjs` hold the pure model, Chinese guided error text, and OpenCode transcript formatting.
- `scheduler-start.ps1 -Dashboard` opens the read-only dashboard after the existing launcher preflight instead of starting scheduler/Feishu runtime.
- README and DEPLOY now document Chinese progress viewing and session transcript usage.

## Reason

Operators needed a minimal, elegant way to see what Guardian is doing now, which issue is being handled, how issue states are ordered, and the concrete OpenCode conversation for each agent. The MVP intentionally avoids a web UI or action buttons so observation cannot accidentally approve, rework, retry, mutate GitHub, or rewrite `.qa/guardian` state.

## Impact scope

- User-visible CLI surfaces are Chinese, including help text and `问题 / 原因 / 下一步` guided errors.
- Dashboard/session modules are read-only and do not import `writeState`, `atomicWriteJson`, or GitHub/git write operations.
- Session transcripts use the existing OpenCode SDK `getMessages(sessionId)` seam instead of parsing private local OpenCode storage.
- Added regression coverage for dashboard formatting, state loading, session resolution, transcript formatting, guided errors, and client outcome mapping.

## Verification

- `node --check tools/guardian/dashboard-errors.mjs`
- `node --check tools/guardian/dashboard-model.mjs`
- `node --check tools/guardian/session-transcript.mjs`
- `node --check tools/guardian/dashboard.mjs`
- `node --check tools/guardian/session-view.mjs`
- `node --test "tests/guardian/*.test.mjs"` -> 427/427 pass
- PowerShell parser check for `tools/guardian/scheduler-start.ps1` -> pass
- Read-only grep for `writeState|atomicWriteJson|gh pr|gh issue|git push|git commit` in dashboard/session modules -> no matches
