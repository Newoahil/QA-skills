# QA Planning Inputs (Planning-Only Contract)

This is the shared, planning-only contract for structured inputs that inform project QA planning but are never evidence. It is consumed by [`../project-qa-context/SKILL.md`](../project-qa-context/SKILL.md) for bounded change-intent extraction from explicit GitHub refs. It feeds `qa_planning_inputs`; it never feeds Execution Evidence, Module Results, or PASS evidence.

## Purpose

`qa_planning_inputs` is a bounded, provenance-carrying record of what the change is *claimed* to be. It exists to sharpen how a Diff is read and which verification is worth planning. It is never a substitute for current objective evidence.

## Record Shape

Each planning input is a single structured record with exactly these fields:

| Field | Required record |
|---|---|
| `source_type` | Where the claim came from: `github_ref` (explicit Issue/PR/commit) or `user` (explicit user statement). |
| `claim_type` | What kind of claim it is: `intent`, `acceptance_criteria`, `repro_steps`, `risk_hypothesis`, `contradiction`, or `unusable_context`. |
| `claim` | The stated or intended claim, phrased as stated/intended, never as confirmed fact. |
| `provenance` | The exact reference identifier/URL, memory entry ID, or user statement that the claim came from. |
| `confidence` | `high`, `medium`, or `low` based on how directly the source states the claim. |
| `use_limit` | Always `planning_only`. |

## Rules

- **Every nontrivial claim needs provenance.** A claim without a concrete `provenance` is discarded, not recorded.
- **No provenance, discard.** Do not fill in provenance from assumption; an unprovenanced claim is dropped.
- **Never PASS evidence.** `qa_planning_inputs` never supports `PASS`, is never Module Results or Execution Evidence, and cannot override or suppress a current objective finding.
- **Distinguish claim types.** Keep `intent` (stated intent) separate from `risk_hypothesis` (inferred risk), `repro_steps` (reproduction steps), and `acceptance_criteria` (stated acceptance). Do not collapse them.
- **Phrase as stated/intended.** Record what the source states or intends, not what the QA agent concludes. Inferred risk is labeled `risk_hypothesis` with its own confidence, never presented as confirmed intent.
- **Planning only.** These inputs inform planning and do not persist beyond the run.

## Claim Types

| `claim_type` | Meaning | Example |
|---|---|---|
| `intent` | What the change states it intends to do. | "PR states the change adds a retry on network timeout." |
| `acceptance_criteria` | A stated acceptance condition. | "Issue states the total must equal the sum of line items." |
| `repro_steps` | Stated steps to reproduce a reported behavior. | "Issue lists steps: open settings, toggle X, observe Y." |
| `risk_hypothesis` | An inferred risk the QA agent hypothesizes from the source. | "Inferred risk: the new field may break existing serialization." |
| `contradiction` | A stated or observed conflict between sources or with current material. | "PR description contradicts the linked issue on default behavior." |
| `unusable_context` | A reference that yields no useful QA context. | "Reference is a merge commit with no change description." |

## Consumption

`project-qa-context` produces `qa_planning_inputs` records. `project-qa-plan` reads them as planning hints only. A `contradiction` or `unusable_context` record is surfaced visibly in the report so the human can see that a reference was read but yielded no useful QA context or exposed a conflict.
