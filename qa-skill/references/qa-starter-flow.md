# QA Starter Flow (Beginner, 5 Steps)

This is a one-page starter for someone with little or no QA experience. It is a learning ramp into the full skill, not a replacement for it. It keeps the load-bearing rules (read-only, evidence-first, four statuses, human gates) but strips the ceremony so a first QA run is doable.

Use this when the change is small and bounded (one fix, one small feature, one Diff) and you just need a correct, honest verdict. If the change touches security, auth, payments, data migration, cache consistency, or concurrency, or you are unsure, do not stay here: route through [`../using-qa/SKILL.md`](../using-qa/SKILL.md) to Full QA.

## The 5 Steps

1. **Scope** — Write one sentence: what exactly am I checking, and what is out of scope? Name the product target explicitly. If you cannot state it, stop as `BLOCKED`.
2. **Risk** — Ask: what could this change break? List 1-3 concrete risks. If any risk is security/auth/payment/data-migration/cache/concurrency, escalate to Full.
3. **Checks** — For each risk, decide one concrete check (run an existing test, run a command, inspect the changed code path, try the actual behavior). Prefer checks that already exist in the project.
4. **Evidence** — Actually run the checks and record the real result (command + output, or observed behavior). "Looks fine" is not evidence. If you cannot run a check, that item is `BLOCKED`, not `PASS`.
5. **Verdict** — Give one status: `PASS`, `FAIL`, `BLOCKED`, or `NEEDS_HUMAN_REVIEW`. `PASS` is allowed only when every scoped check has real passing evidence.

## Beginner Rules That Never Bend

- **No evidence, no PASS.** If you did not run it, you did not verify it.
- **Read-only.** Do not edit product code, tests, fixtures, or config while doing QA.
- **BLOCKED is not FAIL.** Missing tool/permission/environment is `BLOCKED`. A real product defect is `FAIL`.
- **Ask, do not guess.** Unclear acceptance criteria, subjective calls, or risky/destructive/network/credential/release decisions go to a human as `NEEDS_HUMAN_REVIEW`.
- **After a fix, re-run.** A failed check only becomes `PASS` after fresh rerun evidence.

## Minimal Verdict Examples

- `PASS` — "Scoped to the discount calc fix. Ran `npm test -- discount`, 12/12 pass, output recorded. No other risk touched."
- `FAIL` — "Ran `npm test -- order-cache`; cache still returns stale status after update. Output recorded."
- `BLOCKED` — "No test runner installed and none allowed to install. Could not verify. Rerun once Node test env is available."
- `NEEDS_HUMAN_REVIEW` — "Behavior matches code, but whether this is the intended business rule is a product-owner decision."

## When To Graduate To Full QA

Move to [`../using-qa/SKILL.md`](../using-qa/SKILL.md) (Full) when any of these appear:

- The change is not clearly bounded, or the scope keeps growing.
- A high-risk category is involved (security, auth, payments, data migration, cache consistency, concurrency, external API/credentials).
- You need the full 11-category applicability matrix to be sure nothing is silently skipped.
- The result needs an auditable Risk -> Verification -> Evidence -> Status trail.

Full QA is the same discipline with complete coverage; the starter flow is just the on-ramp.
