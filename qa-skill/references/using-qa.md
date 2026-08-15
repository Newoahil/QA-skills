# Using qa-skill from a development agent

This is for a **development agent** (one that writes code) that wants QA on a change it just made. It explains how to invoke QA and how to close the loop with QA's output. The QA skill itself only investigates and reports; driving the fix/verify loop is the development agent's job.

## Two ways to invoke QA

**1. Dispatch the `qa` sub-agent (recommended).**
Use the Task tool with `subagent_type: "qa"`. The `qa` agent runs QA in its own read-only session and returns a report plus test-case designs. Prefer this: it keeps QA read-only by mechanism (the qa agent cannot edit product files) and independent (the agent that wrote the code is not the one grading it). Give it the target change, the intended behavior/requirement, and the repo path in the prompt — it starts with a fresh context.

**2. Load `qa-skill` yourself (fallback, degraded).**
A development agent can load this skill and run the QA stages itself. This is a **degraded** self-check, not real QA: you hold write permission, so the read-only guarantee is by discipline only, and you are grading your own work (weaker independence — you tend to confirm rather than challenge). If you do this, hold read-only strictly during QA and actively try to *disprove* your change, not confirm it. Its verdict does not substitute for an independent QA pass before shipping.

Both are available (`qa` is `mode: all`). There is no mode to toggle — you simply choose which path by whether you dispatch `qa` or load the skill yourself. For anything you intend to ship, use path 1.

## Facets and sub-agent depth

When `qa` runs and the change is high-risk or multi-facet, it may dispatch parallel read-only `qa-facet` sub-agents. For `qa` (running as a sub-agent) to dispatch `qa-facet` (a further level), the environment needs `subagent_depth: 2` in `opencode.json`. If it is not set, `qa` falls back to covering those facets serially in its own session — coverage is preserved, only parallelism is lost. Setting `subagent_depth: 2` is a global config change (it lets any sub-agent nest one more level); enable it if you want QA's parallel facets.

## Closing the loop (fix -> re-verify)

QA is read-only and stops at a verdict + test-case designs. It does **not** implement tests, fix code, or make the ship decision. Closing the loop is the development agent's job, and only under the user's go-ahead:

1. Dispatch `qa` -> receive the report + test-case designs.
2. **Ask the user once** whether to run the fix loop — surface what QA found (the FAIL items) and that QA designed test cases, and ask if you should implement the tests and fix. Do not start fixing unprompted.
3. On approval: implement the designed test cases, run them, and fix the FAIL items. (You have write permission for this; QA did not.)
4. **Re-verify:** after fixing, dispatch `qa` again to confirm the FAIL items are now PASS and no regression was introduced.
   - Cap the fix->re-verify loop at **1–2 rounds**. If it still does not reach PASS, stop and hand the situation back to the user — do not loop indefinitely.
   - The single ask in step 2 covers the whole loop including re-verification; do not re-prompt each round.

This makes the loop a real cycle — QA -> fix -> re-QA — that ends either at PASS or back in the user's hands, never in an endless fix spiral.
