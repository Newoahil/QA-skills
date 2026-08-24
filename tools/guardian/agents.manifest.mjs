export const BUILTIN_AGENT_MANIFEST = Object.freeze({
  agents: Object.freeze([
    Object.freeze({ role: 'guardian-code', modes: Object.freeze(['simple', 'complex']), requires_capability: null, enabled_default: true }),
    Object.freeze({ role: 'guardian-business', modes: Object.freeze(['complex']), requires_capability: null, enabled_default: true }),
    Object.freeze({ role: 'guardian-runtime', modes: Object.freeze(['simple', 'complex']), requires_capability: null, enabled_default: true }),
    Object.freeze({ role: 'guardian-docs', modes: Object.freeze(['complex']), requires_capability: 'context7', enabled_default: true }),
    Object.freeze({ role: 'guardian-history', modes: Object.freeze(['complex']), requires_capability: 'git_history', enabled_default: true }),
    Object.freeze({ role: 'guardian-plan-critic', modes: Object.freeze(['complex']), requires_capability: 'plan_critic', enabled_default: true }),
  ]),
});
