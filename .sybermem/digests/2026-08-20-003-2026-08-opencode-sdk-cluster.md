---
type: digest
kind: phase
date: 2026-08-20
number: 003
title: 2026-08 opencode-sdk cluster
status: completed
source_records:
  - bugs/2026-08-19-bug-09c23cce8bb443d7aadb0f5dea5ce3b7-sdk-session-path-template.md
  - bugs/2026-08-19-bug-682f269c0050412797459f52712af366-headless-permission-hang.md
  - bugs/2026-08-19-bug-95af95c0c87348659c6d36a12974beb0-sdk-prompt-message-convergence.md
  - bugs/2026-08-19-bug-b963cb3902ec472fba0747de51688475-sdk-response-envelope.md
coverage:
  from: 2026-08-19
  to: 2026-08-19
coverage_hash: a6e1a541d777da48da894d6b69780f3eba851dd28f5118640849e13562078674
---

## Phase Scope

OpenCode SDK 1.18.18 adapter defects that broke the headless multi-session runtime: path templates, response envelopes, no-ask permissions, and prompt/message convergence.

## Core Conclusions

- SDK 1.18.18 generated path methods request /session/%7Bid%7D/... and fail; the wrapper must use explicit low-level URLs and unwrap data.id.
- Response envelopes need unwrapping (data.id, data.info.structured); json_schema results come from structured output, not text parts.
- Headless sessions must receive complete role-specific no-ask permission matrices or they hang on permission prompts.
- QA completion must converge from completed assistant messages when the synchronous prompt HTTP request stays open, with baseline IDs and cancellation for round isolation.

## Key Decisions and Changes

- Used the SDK low-level client with explicit /session/<id>/ URLs for prompt/get/abort/messages.
- Role-specific default-deny permission matrices; no generic bash for child agents.
- Prompt/message convergence with baseline message IDs, bounded polling, and cancellation.

## Current State

Resolved and covered by regression tests; part of the 396/396 Guardian suite.

## Recommended Next Reads

- `bugs/2026-08-19-bug-b963cb3902ec472fba0747de51688475-sdk-response-envelope.md`
- `bugs/2026-08-19-bug-95af95c0c87348659c6d36a12974beb0-sdk-prompt-message-convergence.md`

## Source Coverage

4 records listed in frontmatter `source_records`.
