# OpenCode 1.18.19 parent-export v2 fixtures

This directory contains a curated schema-conformance fixture set for the QA-CR B2 parent-export v2 contract. It is based on official OpenCode 1.18.19 source behavior and field casing, but it is not captured production output.

Files:

- `parent-events.jsonl` — native-style JSONL envelopes for one parent run, with `tool_use` events whose `part.type` is `tool`.
- `parent-export.json` — one same-session parent export used for authoritative assistant message timing and canonical exported `step-finish` reconciliation.
- `child-export.json` — one observed completed `qa-cr` child export linked by top-level `info.parentID`.

Rules pinned by this fixture:

- JSONL envelope `timestamp` values are diagnostic emit-times only.
- Emit timestamps never authorize message timing and never justify synthesizing `part.time`.
- `step-start` and `step-finish` parts intentionally omit timing fields.
- Export message objects are `{info, parts}` with no top-level `role`.
- Session `info` includes realistic redacted `projectID`, `directory`, `title`, and `time.{created,updated}`.
- User messages include native `agent` plus `model.{providerID,modelID}`.
- Assistant messages pin `providerID: cpa`, `modelID: gpt-5.5`, `mode == agent` (`qa` for parent, `qa-cr` for child), `parentID` to the same-export user message, and redacted `path.{cwd,root}`.
- Native `tool` parts include `callID`, and completed state includes `title` plus `time.{start,end}`.
- Native generated `step-finish` tokens omit `total`; canonical totals are derived from token components only.
- Parent canonical totals are derived from unique exported `step-finish` parts only.
- All fixture paths are relative or redacted; no absolute host paths are allowed.
