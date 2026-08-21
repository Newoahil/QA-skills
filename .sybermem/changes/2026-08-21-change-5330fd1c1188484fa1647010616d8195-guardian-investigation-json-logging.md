---
type: change
record_id: change-5330fd1c1188484fa1647010616d8195
date: 2026-08-21
title: Log Guardian investigation JSON failures and skip unavailable OpenCode agents
status: done
source: manual
key_conclusion: Added structured JSON/prompt diagnostics and runtime OpenCode agent filtering so investigation failures name the bad boundary and missing optional specialists no longer produce empty-output JSON parse errors.
topics: [qa-guardian, logging, opencode]
author: Sisyphus
related_files: [tools/guardian/capabilities.mjs, tools/guardian/opencode-client.mjs, tools/guardian/investigation-process.mjs, tools/guardian/scheduler.mjs, tests/guardian/capabilities.test.mjs, tests/guardian/opencode-client.test.mjs, tests/guardian/investigation-process.test.mjs]
related: [change-856058c87cf3450e8460263aeef5cb2a]
---

## Change Content
Added structured diagnostics at the Guardian investigation JSON boundary and OpenCode prompt boundary:

- `investigation-process.mjs` now throws `InvestigationJsonParseError` with `json_phase`, `json_source`, `role`, parser reason, output byte count, and a bounded redacted preview instead of collapsing failures into a generic invalid-JSON error.
- SDK-path specialist and plan parsing now attach OpenCode prompt response shape metadata, including `parts_count`, `text_bytes`, and whether `structured` or `structured_output` was present.
- `scheduler.mjs` logs those structured fields on `investigation.failed` so the next runtime failure identifies the exact JSON/source boundary without dumping raw issue, prompt, or model output.
- `opencode-client.mjs` now recognizes the official `info.structured_output` response field, records prompt response shape, and exposes `getAgents(directory)` for runtime agent discovery.
- `capabilities.mjs` can disable Guardian specialists missing from the running OpenCode server before investigation selection.

## Reason for Change
Issue #205 was failing with only `Unexpected end of JSON input`, which hid whether the bad JSON came from an artifact file, OpenCode event stream, final specialist output, or SDK prompt response. After adding diagnostics, the failure proved to be `guardian-history` returning zero bytes because the running OpenCode server did not have that optional agent installed and fell back/no-oped instead of producing structured output.

## Impact Scope
The fix improves observability and prevents a known optional-agent misconfiguration from aborting the enforced investigation path:

- Future JSON failures carry enough metadata to identify phase/source/role and prompt response shape.
- Secret-looking values are redacted from previews and full output is never logged.
- Missing optional specialists such as `guardian-history` and `guardian-plan-critic` are logged with `investigation.agents_unavailable` and filtered from the active investigation config.
- Mandatory installed specialists such as `guardian-code`, `guardian-business`, and `guardian-runtime` remain selected normally.

## Verification
Validated with targeted and full regression checks:

- `node --test "tests/guardian/investigation-process.test.mjs"` passed.
- `node --test "tests/guardian/opencode-client.test.mjs"` passed.
- `node --test "tests/guardian/capabilities.test.mjs"` passed.
- `node --test "tests/guardian/*.test.mjs"` passed with 528/528 tests.
- `node --check` passed for changed Guardian modules.
- Live scheduler smoke against `D:\tuantuanrent.qa-guardian-control` changed the runtime evidence from generic `Unexpected end of JSON input` to explicit `investigation.agents_unavailable` for `guardian-history,guardian-plan-critic`.
