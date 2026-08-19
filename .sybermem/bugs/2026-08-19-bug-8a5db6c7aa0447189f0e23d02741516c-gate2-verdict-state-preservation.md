---
type: bug
record_id: bug-8a5db6c7aa0447189f0e23d02741516c
date: 2026-08-19
title: Gate 2 transition erased persisted QA verdict metadata
severity: medium
status: resolved
key_conclusion: Re-read issue state after persisting the QA verdict and before writing GATE_2_WAIT so the PR transition preserves qa_verdict_path, status, and hash.
topics: [qa-guardian, gate2, state-consistency]
related: [bug-a47057aaf97145de807476aef76844e3]
---

## Bug Description

Issue #211 successfully wrote a PASS `qa-verdict.json`, opened PR #222, published
`[QA_VERIFIED]`, and reached `GATE_2_WAIT`. However, its final state contained null
`qa_verdict_path`, `qa_verdict_status`, and `qa_verdict_hash`.

## Root Cause

Scheduler captured `afterRun` before writing the QA verdict metadata. The later PR transition
spread that stale snapshot into the `GATE_2_WAIT` state, overwriting the fields that had just been
persisted.

## Solution

- Re-read the latest issue state after PR creation and before the Gate 2 write.
- Spread the latest state into `GATE_2_WAIT`, preserving verdict metadata.
- Add a regression assertion protecting this ordering.

## Related Changes

- `tools/guardian/scheduler.mjs`
- `tests/guardian/qa-verdict-runtime.test.mjs`
- Full suite: 307/307 green.
