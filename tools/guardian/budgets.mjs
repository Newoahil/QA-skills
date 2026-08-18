// Investigation/runtime budget calculations (Phase 7).
// Pure helpers consumed by future specialist/child-run adapters.

export const DEFAULT_BUDGETS = Object.freeze({
  investigation_ms: 30 * 60 * 1000,
  complex_investigation_ms: 60 * 60 * 1000,
  specialist_timeout_ms: 10 * 60 * 1000,
  child_timeout_ms: 20 * 60 * 1000,
  max_specialists: 4,
  max_investigation_rounds: 2,
});

export function resolveBudgets(config = {}, complexity = 'standard') {
  const investigation = complexity === 'complex'
    ? config.complex_investigation_budget_ms ?? DEFAULT_BUDGETS.complex_investigation_ms
    : config.investigation_budget_ms ?? DEFAULT_BUDGETS.investigation_ms;
  return {
    investigation_ms: Number(investigation),
    specialist_timeout_ms: Number(config.specialist_timeout_ms ?? DEFAULT_BUDGETS.specialist_timeout_ms),
    child_timeout_ms: Number(config.child_timeout_ms ?? DEFAULT_BUDGETS.child_timeout_ms),
    max_specialists: Number(config.max_specialists ?? DEFAULT_BUDGETS.max_specialists),
    max_investigation_rounds: Number(config.max_investigation_rounds ?? DEFAULT_BUDGETS.max_investigation_rounds),
  };
}

export function createDeadline(startedAt, budgetMs) {
  return Number(startedAt) + Number(budgetMs);
}

export function remainingBudget(deadline, now = Date.now()) {
  return Math.max(0, Number(deadline) - Number(now));
}

export function canStartSpecialist({ completed, maxSpecialists, deadline, now = Date.now() }) {
  return completed < maxSpecialists && remainingBudget(deadline, now) > 0;
}

export function classifyTimeout({ phase, childExitCode = null }) {
  return {
    timed_out: true,
    phase,
    error_class: 'timeout',
    child_exit_code: childExitCode,
    retryable: phase === 'investigation' || phase === 'specialist',
    requires_clean_branch_check: phase === 'fixing' || phase === 'verifying',
  };
}
