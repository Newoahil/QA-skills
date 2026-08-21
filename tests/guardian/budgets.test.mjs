import assert from 'node:assert/strict';
import test from 'node:test';

import { canStartSpecialist, classifyTimeout, createDeadline, DEFAULT_SESSION_DEADLINES, hasTimeout, remainingBudget, resolveBudgets, resolveSessionDeadlineMs } from '../../tools/guardian/budgets.mjs';

test('resolveBudgets selects standard/complex configured defaults', () => {
  const standard = resolveBudgets({ investigation_budget_ms: 1000 }, 'standard');
  const complex = resolveBudgets({ complex_investigation_budget_ms: 2000 }, 'complex');
  assert.equal(standard.investigation_ms, 1000);
  assert.equal(complex.investigation_ms, 2000);
});

test('time budgets default to unlimited (0) and hasTimeout gates only positive values', () => {
  const defaults = resolveBudgets({}, 'complex');
  assert.equal(defaults.investigation_ms, 0);
  assert.equal(defaults.specialist_timeout_ms, 0);
  assert.equal(defaults.child_timeout_ms, 0);
  assert.equal(hasTimeout(0), false);
  assert.equal(hasTimeout(null), false);
  assert.equal(hasTimeout(undefined), false);
  assert.equal(hasTimeout(-5), false);
  assert.equal(hasTimeout(NaN), false);
  assert.equal(hasTimeout(1), true);
  assert.equal(hasTimeout(600000), true);
});

test('resolveSessionDeadlineMs is configurable, lengthened by default, and never zero', () => {
  // Explicit per-key config wins.
  assert.equal(resolveSessionDeadlineMs({ fixer_deadline_ms: 90 * 60 * 1000 }, 'fixer_deadline_ms'), 90 * 60 * 1000);
  assert.equal(resolveSessionDeadlineMs({ qa_deadline_ms: 45 * 60 * 1000 }, 'qa_deadline_ms'), 45 * 60 * 1000);
  // Legacy child_timeout_ms is honored only when positive (back-compat).
  assert.equal(resolveSessionDeadlineMs({ child_timeout_ms: 30 * 60 * 1000 }, 'fixer_deadline_ms'), 30 * 60 * 1000);
  // child_timeout_ms=0 (unlimited investigation) must NOT zero out the session deadline → default.
  assert.equal(resolveSessionDeadlineMs({ child_timeout_ms: 0 }, 'qa_deadline_ms'), DEFAULT_SESSION_DEADLINES.qa_deadline_ms);
  // No config → lengthened default (60 min).
  assert.equal(resolveSessionDeadlineMs({}, 'fixer_deadline_ms'), 60 * 60 * 1000);
  assert.equal(resolveSessionDeadlineMs({}, 'qa_deadline_ms'), 60 * 60 * 1000);
});

test('deadline and remaining budget never go negative', () => {
  const deadline = createDeadline(1000, 500);
  assert.equal(deadline, 1500);
  assert.equal(remainingBudget(deadline, 1200), 300);
  assert.equal(remainingBudget(deadline, 2000), 0);
});

test('specialist start is bounded by count and deadline', () => {
  assert.equal(canStartSpecialist({ completed: 0, maxSpecialists: 4, deadline: 2000, now: 1000 }), true);
  assert.equal(canStartSpecialist({ completed: 4, maxSpecialists: 4, deadline: 2000, now: 1000 }), false);
  assert.equal(canStartSpecialist({ completed: 0, maxSpecialists: 4, deadline: 1000, now: 1000 }), false);
});

test('timeout classification distinguishes investigation from fixing', () => {
  assert.equal(classifyTimeout({ phase: 'investigation' }).retryable, true);
  assert.equal(classifyTimeout({ phase: 'fixing' }).requires_clean_branch_check, true);
});
