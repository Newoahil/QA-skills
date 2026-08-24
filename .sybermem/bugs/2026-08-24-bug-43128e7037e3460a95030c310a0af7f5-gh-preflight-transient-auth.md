---
type: bug
record_id: bug-43128e7037e3460a95030c310a0af7f5
date: 2026-08-24
title: Combined Guardian launcher misreported transient gh preflight failure as logged-out
source: Runtime investigation of combined launcher startup on Windows
severity: medium
status: resolved
key_conclusion: Replaced the single gh auth status preflight with a retried gh api user authentication probe and separate repository access probe, so transient GitHub CLI failures no longer masquerade as missing login.
topics: [qa-guardian, launcher, github-cli]
related: [bug-432ac9e0feec425a91229512c7603ac9]
---

## Bug Description

The combined Guardian launcher failed during scheduler preflight with:

```text
gh 尚未登录，请先执行 gh auth login。
```

However, the same Windows user context could immediately run `gh auth status`, `gh api user`, and
`gh repo view LambdaTheory/tuantuanrent` successfully. The launcher therefore blocked startup with
an incorrect remediation and made a transient CLI/keyring/network failure look like a credential bug.

## Root Cause

The launcher performed one `gh auth status` call, discarded all output, and treated any non-zero exit
as “not logged in”. It did not retry transient failures, did not use the actual authenticated API
call required by the scheduler, and did not distinguish authentication from repository access.

## Solution

- Added `Invoke-GhPreflight` with three bounded attempts and short backoff.
- Replaced the discarded `gh auth status` gate with `gh api user --jq .login`, which directly proves
  the authenticated API identity needed by Guardian.
- Added a separate retried `gh repo view <owner/repo>` probe for repository access.
- Failure messages now preserve the actual gh output and distinguish authentication from repository,
  network, and permission failures; they only suggest `gh auth login` when the real probe fails.

## Prevention Measures

- Do not discard external CLI diagnostics at a startup boundary.
- Retry bounded transient GitHub CLI failures before declaring configuration invalid.
- Keep launcher tests asserting the retry, identity probe, repository probe, and diagnostic behavior.

## Related Changes

- `e889e99 Retry GitHub preflight before reporting auth failure`
- Exact combined scheduler preflight succeeded with exit code 0 after the fix.
- `gh api user --jq .login` returned `goudaren0528`.
- `gh repo view LambdaTheory/tuantuanrent` succeeded.
