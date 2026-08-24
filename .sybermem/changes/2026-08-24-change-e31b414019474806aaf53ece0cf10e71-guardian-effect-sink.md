---
type: change
record_id: change-e31b414019474806aaf53ece0cf10e71
date: 2026-08-24
title: Guardian EffectSink abstraction
status: implemented
source: P4 implementation on feature/guardian-extensibility
key_conclusion: QA Guardian now has an EffectSink abstraction that authorizes each existing effect before I/O while keeping the EFFECTS vocabulary and low-level GitHub adapters unchanged.
topics: [qa-guardian, effects, authorization]
author: Sisyphus
related_files: [tools/guardian/effect-sink.mjs, tools/guardian/github-effect-sink.mjs, tests/guardian/effect-sink.test.mjs]
related: [decision-b531cef4d0f44652917eb044fbc0a31e]
---

## Change Content

Added `EffectSink` contract helpers and a GitHub-backed sink implementation. The sink normalizes effect descriptors, checks `assertActorMayPerform(actor, kind)` before dispatch, and routes existing `EFFECTS` kinds to existing GitHub/webhook/label/PR I/O seams.

## Reason for Change

P4 of the extensibility plan needs a single effect boundary before pipeline and source additions. Centralizing effect descriptors lets future stages request audited effects without directly reaching `gh`, `curl`, labels, or PR creation.

## Impact Scope

The change is additive. `actor-routing.mjs` and `EFFECTS` names are unchanged. Existing `notify-io.mjs`, `label-io.mjs`, `pr-io.mjs`, and `gate2-pr.mjs` keep their current authorization behavior and tests.

## Implementation

`github-effect-sink.mjs` supports `fact_comment`, `fact_webhook`, `label`, and `pr_create`. Unsupported kinds fail closed. Tests prove unauthorized label/PR requests are rejected before fake I/O observes a call and allowed supervisor effects dispatch with the expected payloads.

## Test Verification

- `node --test "tests/guardian/effect-sink.test.mjs" "tests/guardian/actor-routing.test.mjs" "tests/guardian/notify-io.test.mjs" "tests/guardian/label-io.test.mjs" "tests/guardian/pr-io.test.mjs"` passed: 34/34.
- `node --test "tests/guardian/*.test.mjs"` passed: 589/589.
- LSP diagnostics on the new sink files and tests reported no diagnostics.
- `git diff -- tools/guardian/actor-routing.mjs` was empty, preserving the actor/effect matrix vocabulary.

## Notes

Existing scheduler call sites still call low-level I/O directly; P6/P7 can begin using the sink when pipeline stages become data-driven.
