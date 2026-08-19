---
type: change
record_id: change-bf2f029768594b7097870069da715a0a
date: 2026-08-19
title: Pass target directory to OpenCode session creation
status: done
key_conclusion: Fixed a bug where SDK sessions were created in the scheduler's cwd (QA-skills) instead of the target repo, causing specialists/fixer/qa to work in the wrong directory.
topics: [qa-guardian, opencode-sdk, bug]
author: goudaren0528
related_files: [tools/guardian/opencode-client.mjs, tools/guardian/investigation-process.mjs, tools/guardian/fixer-session-runner.mjs, tools/guardian/qa-session-runner.mjs]
related: [change-9c651671735d41ca84cb71a1c1bd2213]
---

## Change Content
Fixed the OpenCode session `directory` bug found by the real #211 E2E run:
- `opencode-client.mjs` `createSession` now passes the target `directory` (as query param).
- `investigation-process.mjs` (specialist), `fixer-session-runner.mjs`, and
  `qa-session-runner.mjs` all pass `directory: repoDir` when creating their session.
- Added a test locking that createSession passes the target directory.

## Reason for Change
The first SDK-runtime E2E run revealed that specialist sessions were created in
`D:/QA-skills` (the scheduler's cwd) instead of `D:/tuantuanrent` (the target repo),
because `createSession` did not pass `directory`. Agents were investigating the wrong
repository. This is a correctness bug, not a style issue.

## Impact Scope
Localized to the four SDK session-creation call sites. Full suite stays green.

## Implementation
`createSession` now accepts a `directory` and passes it as the SDK query param
(`{ query: { directory }, body: {...} }`). All role runners pass `directory: repoDir`.

## Test Verification
Full suite: 294/294 green. New test locks createSession passes the target directory.

## Notes
Found by the real #211 E2E run with the SDK runtime.
