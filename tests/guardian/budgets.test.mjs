import assert from 'node:assert/strict';
import test from 'node:test';

import { canStartSpecialist, classifyTimeout, createDeadline, hasTimeout, remainingBudget, resolveBudgets } from '../../tools/guardian/budgets.mjs';

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
