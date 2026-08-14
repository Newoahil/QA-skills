---
name: project-qa-context
description: Bounded change-intent extraction from explicit GitHub references (linked Issue/PR/commit) to inform project QA planning. GitHub-only, explicit refs only, no search, one-hop, gh preferred. Feeds qa_planning_inputs, never evidence.
---

# Project QA Context (Bounded Change-Intent Extraction, GitHub-Only)

Use this skill only from [`using-project-qa`](../using-project-qa/SKILL.md), after Project Intake and before `project-qa-plan`. This is a deliberately thin mechanism: it extracts the *stated and intended* change intent from an explicit GitHub reference the change already points to, so a human QA does not have to re-read that link. It is not a general research or discovery capability.

This skill targets GitHub only. Jira, Linear, and other trackers are explicitly out of scope for this version, not merely unimplemented; do not attempt to read them even if a reference to one appears, and record them as `unusable_context` with reason "non-GitHub source out of scope."

## When This Applies

Only when the current Diff, change description, request text, or an already-open report explicitly names or links an external GitHub reference: an Issue, PR, or commit URL/ID belonging to the current repository or an explicitly related GitHub repository named in that reference.

Do not search, crawl, guess, or discover references on your own. No GitHub reference named anywhere in the current material means `context_acquired: N/A` and planning continues without this step. This is a hard boundary, not an optimization: unbounded discovery is out of scope.

## Extraction Boundary

- **GitHub-only.** Only explicit GitHub references are read. Non-GitHub references are recorded as `unusable_context` without being read.
- **Explicit refs only.** Only references explicitly named in the current material. No references from memory or assumption.
- **No search.** Do not search, crawl, or discover references.
- **One-hop.** Read the named reference and directly linked follow-on GitHub references it names (one hop only). Do not chain-follow a reference's own references' references.
- **`gh` preferred.** Use the `gh` CLI already logged in on the host (for example `gh issue view`, `gh pr view`, `gh pr view --json body,title,url`). This reads both public and private repositories the host's existing `gh` authentication already has access to, without requesting or configuring any new credential. Only fall back to a generic public web-fetch tool when `gh` is unavailable and the reference is plainly public.

## What To Do

1. List every explicit GitHub reference found in the current material (Diff, request, existing report). Do not add references from memory or assumption. Record any non-GitHub reference as `unusable_context` with reason "non-GitHub source out of scope" without attempting to read it.
2. For each GitHub reference, use the `gh` CLI (or public fetch fallback) to read title, description, and directly linked follow-on GitHub references it names (one hop only).
3. Extract structured change-intent categories from what the reference states, and record each as a `qa_planning_inputs` record per [`../references/qa_planning_inputs.md`](../references/qa_planning_inputs.md):
   - `intent` — what the change states it intends to do.
   - `acceptance_criteria` — stated acceptance conditions.
   - `repro_steps` — stated reproduction steps.
   - `risk_hypothesis` — inferred risk the QA agent hypothesizes from the source (labeled as inferred, never as confirmed intent).
   - `contradiction` — a stated or observed conflict between sources or with current material.
   - `unusable_context` — a reference that yields no useful QA context (for example a merge commit with no change description, or a non-GitHub source).
4. For every record, require `provenance` (the exact reference identifier/URL), `confidence` (`high`/`medium`/`low`), and `use_limit: planning_only`. Every nontrivial claim needs provenance; a claim without provenance is discarded. Phrase claims as stated/intended, never as confirmed fact.
5. If a GitHub reference is private and `gh` is not authenticated with access to it, fails to load, or is otherwise unreadable with already-available access, record it as `unusable_context` with the reason. This is not a failure; continue planning without it unless it is the only source for a Must Verify acceptance criterion, in which case flag it as a missing prerequisite for that item. Never prompt for, request, or configure a new credential to read a reference.

## What This Feeds Into Planning

Hand the recorded `qa_planning_inputs` records to `project-qa-plan` as planning-only inputs, under a visible `External Context (not evidence)` note. These inputs may:

- Change how a Diff is read (for example: a field naming difference that looks inconsistent is actually required by an external spec the reference names).
- Surface a related file, module, or prior fix the current change must stay consistent with.
- Sharpen or add a risk to the Risk and Verification Plan.

This must never:

- Count as Execution Evidence or Module Results.
- Be used to mark any Must Verify item `PASS` by itself.
- Override or suppress a current objective finding.
- Persist beyond the current run. Nothing here is written to a durable knowledge store.

## Reporting

Record the reference list, the extracted `qa_planning_inputs` records (with `source_type`, `claim_type`, `claim`, `provenance`, `confidence`, `use_limit`), and any `unusable_context` / `contradiction` records directly in the project report's planning section. There is no separate artifact, schema, or validator for this version — the report entry is the whole record.
