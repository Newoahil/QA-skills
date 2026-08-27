---
type: bug
record_id: bug-ca2cee987a2b4a0880e133f21a4eaa7b
date: 2026-08-27
title: Guardian revise plan failed to assimilate feedback into product fields
source: user-report
severity: high
status: open
key_conclusion: Guardian revise plans must structurally assimilate trusted human feedback into non-empty product/B-side/C-side/related-feature/usage-acceptance fields because session continuity alone still allowed Gate1 proposals to leave feedback as unresolved placeholders.
topics: [qa-guardian, gate1, revise]
related: [bug-897d6e684d654aafba07f30dc5079f44]
---

## Bug Description
Issue #366 showed that after `/guardian revise` supplied concrete product and investigation feedback, the regenerated Gate1 proposal still rendered `B 侧影响: 无`, `C 侧影响: 无`, `关联功能影响: 无`, and `产品使用验收: 未提供`. The plan also continued to ask for facts the feedback explicitly requested Guardian to investigate, such as whether `setUserOrderStatus` had backend/admin/internal dependencies and whether gateway constraints changed the risk scope.

## Root Cause
The previous fix added session continuity and required product planning fields in the structured plan, but the schema only required the fields to exist. It did not require product arrays to be non-empty, did not add a machine-checked revise-feedback assimilation field, and did not forbid placeholder values like `无`/`未提供` when trusted revision feedback exists. A resident scheduler can also keep running old code until restarted, so code changes must be paired with restart/push awareness when validating live Guardian behavior.

## Solution
Tighten the plan schema and prompt so revised plans must explicitly address trusted human feedback, keep B/C/related-feature/product-usage fields populated with concrete impact or a concrete no-impact rationale, and reserve `blocking_questions` only for genuine product decisions that cannot be answered by code investigation. Add regressions that fail if revised plan output contains empty product sections or omits the explicit feedback assimilation contract.

## Prevention Measures
When changing Guardian resident behavior, verify both code-level tests and the live runtime version: commit/push the tools repo change, restart the scheduler using the new commit, and inspect the next Gate1 output rather than assuming an already-running process picked up new code. For plan-quality bugs, prefer schema-level constraints and structural fields over prompt-only prose.

## Related Changes
Pending fix in `tools/guardian/investigation-process.mjs`, `tools/guardian/gate1-comment.mjs`, and associated tests.
