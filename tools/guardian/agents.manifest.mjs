export const BUILTIN_AGENT_MANIFEST = Object.freeze({
  agents: Object.freeze([
    Object.freeze({ role: 'guardian-code', modes: Object.freeze(['simple', 'complex']), capability: null }),
    Object.freeze({ role: 'guardian-business', modes: Object.freeze(['complex']), capability: null }),
    Object.freeze({ role: 'guardian-runtime', modes: Object.freeze(['simple', 'complex']), capability: null }),
    Object.freeze({ role: 'guardian-docs', modes: Object.freeze(['complex']), capability: 'context7' }),
    Object.freeze({ role: 'guardian-history', modes: Object.freeze(['complex']), capability: 'git_history' }),
    Object.freeze({ role: 'guardian-plan-critic', modes: Object.freeze(['complex']), capability: 'plan_critic' }),
  ]),
});
