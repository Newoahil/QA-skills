// Investigation/runtime budget calculations (Phase 7).
// Pure helpers consumed by future specialist/child-run adapters.

// Time budgets default to 0 = UNLIMITED. Product decision: do not force-kill investigation on a
// timer; instead record how long each run actually takes (durations telemetry) so future tuning is
// evidence-based. A positive config value still opts back into a hard timeout when explicitly set.
export const DEFAULT_BUDGETS = Object.freeze({
  investigation_ms: 0,
  complex_investigation_ms: 0,
  specialist_timeout_ms: 0,
  child_timeout_ms: 0,
  max_specialists: 4,
  max_investigation_rounds: 2,
});

// Fixer / QA SDK sessions poll for a completion message, so they need a finite deadline (a 0 here
// would mean "give up immediately"). These are lengthened, configurable ceilings — not the tight
// 20-minute default they used to share with child_timeout_ms. Override per project in config.
export const DEFAULT_SESSION_DEADLINES = Object.freeze({
  fixer_deadline_ms: 60 * 60 * 1000, // 60 min
  qa_deadline_ms: 60 * 60 * 1000, // 60 min
  // Specialist SDK prompts always get a positive safety deadline: undici header/body timeouts are
  // disabled for long model runs, so without an app-level bound a hung/queued prompt could hold the
  // N=1 lock indefinitely. 30 min is generous for a read-only investigation while still self-healing.
  specialist_deadline_ms: 30 * 60 * 1000, // 30 min
});

// Resolve a positive session deadline: explicit key → legacy child_timeout_ms (only if positive)
// → lengthened default. Never returns 0/negative, so the polling runners always have a real bound.
export function resolveSessionDeadlineMs(config = {}, key) {
  const explicit = Number(config?.[key]);
  if (hasTimeout(explicit)) return explicit;
  const legacy = Number(config?.child_timeout_ms);
  if (hasTimeout(legacy)) return legacy;
  return DEFAULT_SESSION_DEADLINES[key];
}

// A timeout is active only when a positive, finite millisecond value is configured.
// null / undefined / 0 / negative / NaN → no timeout.
export function hasTimeout(ms) {
  return Number.isFinite(Number(ms)) && Number(ms) > 0;
}

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
