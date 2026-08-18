// QA Guardian — scheduler decision core (§15.1, pure)
//
// The resident scheduler (scheduler.mjs) is a thin loop; ALL its decisions live here so they
// are unit-testable without spawning processes or hitting gh. Given the list of open labeled
// issues, each issue's poll decision, and the current N=1 lock state, decide the single plan
// for this tick: which issue (if any) to run, and which gate-stopped issues to notify.
//
// N=1 concurrency: at most ONE issue may be actively running at a time. If the lock is held by
// a live (non-expired) run, this tick starts nothing new — it only performs read-only polling
// and notifications. A run is startable only for actionable decisions (START/RESUME/STALLED).

export const RUNNABLE_ACTIONS = Object.freeze(['START', 'RESUME', 'STALLED']);
export const NOTIFY_ACTIONS = Object.freeze(['STALLED', 'HANDED_BACK']);

/**
 * Is the N=1 lock currently held by a live run?
 * @param {object|null} lock { pid, acquired_at } or null
 * @param {object} opts { leaseMs, now }
 */
export function isLockLive(lock, opts) {
  if (!lock || typeof lock.acquired_at !== 'number') return false;
  return opts.now - lock.acquired_at < opts.leaseMs;
}

/**
 * Decide the plan for one scheduler tick.
 * @param {object} args
 *   decisions: Array<{ issue:number, action:string, toState?:string, invoke?:string|null, reason?:string }>
 *   lock: object|null   current N=1 lock ({ pid, acquired_at } or null)
 *   leaseMs: number
 *   now: number
 * @returns {{ toRun: object|null, lockBusy: boolean, notify: Array<object> }}
 *   toRun  — the single decision to execute this tick (or null when nothing runnable / lock busy)
 *   notify — gate-stop/stall/handback decisions to push notifications for (independent of lock)
 */
export function planTick(args) {
  const { decisions, lock, leaseMs, now } = args;
  const lockBusy = isLockLive(lock, { leaseMs, now });

  // Notifications are independent of the run lock: a gate stop still deserves a card even if
  // another issue is running. (The notify layer itself is idempotent per last_notified_state.)
  const notify = decisions.filter((d) => NOTIFY_ACTIONS.includes(d.action));

  if (lockBusy) {
    return { toRun: null, lockBusy: true, notify };
  }

  // N=1: pick the FIRST runnable decision in the given order (caller controls ordering, e.g.
  // by issue number / updatedAt). Deterministic single selection.
  const toRun = decisions.find((d) => RUNNABLE_ACTIONS.includes(d.action)) ?? null;
  return { toRun, lockBusy: false, notify };
}
