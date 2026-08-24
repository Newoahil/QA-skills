import { STATES } from './state.mjs';

export const BUILTIN_PIPELINE_MANIFEST = Object.freeze([
  Object.freeze({
    id: 'fixer',
    agent: 'qa-guardian',
    runner: 'runFixerStage',
    inputArtifacts: Object.freeze(['dossier', 'plan']),
    outputArtifacts: Object.freeze(['pr-summary']),
    stateTransition: Object.freeze({ from: STATES.FIXING, to: STATES.FIXING }),
    retryPolicy: Object.freeze({ maxRounds: 2 }),
    producesEffects: false,
    extensionPoint: 'before-fixer',
  }),
  Object.freeze({
    id: 'qa',
    agent: 'qa',
    runner: 'runQaStage',
    inputArtifacts: Object.freeze(['pr-summary']),
    outputArtifacts: Object.freeze(['qa-acceptance', 'qa-verdict']),
    stateTransition: Object.freeze({ from: STATES.FIXING, to: STATES.VERIFYING }),
    retryPolicy: Object.freeze({ maxRounds: 1 }),
    producesEffects: false,
    extensionPoint: 'after-qa',
  }),
  Object.freeze({
    id: 'notify',
    agent: null,
    runner: 'runNotifyStage',
    inputArtifacts: Object.freeze(['qa-verdict']),
    outputArtifacts: Object.freeze([]),
    stateTransition: Object.freeze({ from: STATES.VERIFYING, to: STATES.VERIFYING }),
    retryPolicy: Object.freeze({ maxRounds: 0 }),
    producesEffects: true,
    extensionPoint: 'after-qa',
  }),
]);
