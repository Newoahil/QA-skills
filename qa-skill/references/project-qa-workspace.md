# Project QA Workspace (Opt-In, Local-First `.qa/`)

This reference defines the optional, opt-in project-local `.qa/` workspace for persistent QA memory, reports, and plans. It is used by [`../using-project-qa/SKILL.md`](../using-project-qa/SKILL.md) for the storage decision and by [`../project-qa-memory/SKILL.md`](../project-qa-memory/SKILL.md) for durable memory. Like Superpower-style skill persistence, `.qa/` lets a project keep a bounded local QA memory across runs, but it is strictly opt-in and local-first: nothing is silently written into the repository, and QA-only safety is preserved throughout.

## Purpose

`.qa/` is a project-local, git-ignored (or local-excluded) directory for persistent QA planning/history artifacts: reusable-learning memory, reports, and plans. It exists to avoid re-deriving the same project knowledge on every run while keeping that knowledge inside the project's own boundaries when the user wants it. `.qa/` is never an evidence store.

## Allowed Modes

The workspace is used in one of these modes, in priority order:

1. **External storage default.** When `.qa/` is not already present, not already ignored/local-excluded, and the user has not authorized it, host-owned external storage is the default. No `.qa/` directory is created.
2. **Project-local `.qa/` if already present/ignored or user authorizes.** `.qa/` may be created or used only when it already exists, is already ignored or local-excluded, or the user explicitly authorizes it.
3. **Shared curated memory only by explicit team choice.** Persistent memory may be shared or curated for a team only by explicit team choice; it is never shared by default.

## Layout

When authorized, `.qa/` uses this fixed layout:

```
.qa/                          # workspace root
.qa/README.md                 # explains this workspace and its planning-only rule
.qa/config.yaml               # workspace mode and memory persistence target
.qa/memory/                   # durable memory (when authorized)
.qa/memory/index.yaml         # only retrieval entry / source of truth; do not recursively scan
.qa/memory/rules/             # approved Quality Rule cards (<module>.yaml); can generate Must/Should checks
.qa/memory/patterns/          # reusable failure pattern cards (<pattern>.yaml); mainly risk/Should checks
.qa/memory/feedback/          # raw human feedback provenance (QA-<n>.md); must not directly drive planning
.qa/memory/rejected/          # rejected/stale/inapplicable candidates; not applied
.qa/reports/                  # project QA reports (history, planning-only)
.qa/plans/                    # project QA plans (history, planning-only)
.qa/provenance/               # provenance records for planning inputs and memory
.qa/tmp/                      # temporary working files, cleaned before completion
```

`.qa/memory` is the preferred durable memory location when the `.qa/` workspace is authorized. When it is not authorized, memory is report-only/external.

`.qa/memory/index.yaml` is the source of truth for retrieval: an item file under `rules/`, `patterns/`, or `rejected/` is opened only when it is referenced by the index. Do not recursively scan directories. Retrieval is capped at 0–3 relevant `current` items per run, matched by scope/trigger. `feedback/` is raw human provenance and must not directly drive planning; only `rules/` (approved Quality Rules) and `patterns/` (reusable failure patterns) generate plan checks. `rejected/` holds rejected/stale/inapplicable candidates and is never applied. No benchmark seed or corpus data is auto-written into `.qa/memory`; memory is written only as evidence-backed, human-approved entries.

## Decision Order

Resolve storage in this order:

1. Check whether `.qa/` already exists. If yes, use it.
2. Otherwise, check whether the project already ignores/local-excludes `.qa/` (`.gitignore`, `.git/info/exclude`, or equivalent local-exclude) and creating it would not touch tracked files. If yes, create/use it.
3. Otherwise, ask the user for explicit authorization to create `.qa/`, to gitignore/local-exclude it, and to persist memory. Only explicit authorization activates a project-local workspace.
4. Otherwise, use host-owned external storage. No `.qa/` is created.

## Authorization

- Creating `.qa/`, gitignoring/local-excluding it, and persisting durable memory all require explicit user authorization. The default is external storage.
- Authorization is recorded in the report's Storage Decision and Reusable Learning / Memory sections.
- Shared curated memory additionally requires explicit team choice, never default.

## Gitignore / Local-Exclude Policy

- `.qa/` must be gitignored or local-excluded before any project-local write. No tracked-file changes are permitted.
- If the project cannot gitignore/local-exclude `.qa/` without tracked-file changes, the workspace is not used and host external storage is mandatory.
- Do not modify a tracked `.gitignore` to accommodate `.qa/`; that would be repository pollution and is forbidden.

## Planning-Only Rule

Everything in `.qa/` is planning/history only. It is never:

- Module Results, Execution Evidence, or PASS evidence.
- Used to mark any Must Verify item `PASS` by itself.
- Overriding or suppressing a current objective finding.

## Sensitive Data / Redaction Cautions

- Do not write credentials, tokens, cookies, personal data, production data, or raw connection strings into `.qa/`.
- Prefer redacted observations, hashes, byte counts, and concise summaries. Provenance records reference evidence IDs and artifact hashes rather than raw payloads.
- `.qa/tmp` holds only temporary working files and is cleaned before completion.

## Reporting

Record the workspace mode, `.qa/` eligibility/authorization, gitignore/local-exclude state, and memory persistence target in the report's Storage Decision and Reusable Learning / Memory sections.
