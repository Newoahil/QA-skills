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
]);
