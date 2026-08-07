#!/usr/bin/env node
import { lstatSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const PLAN_VERSION = 'qa-plan/v1';
const KIND = 'qa-plan';
const SCHEMA_ID = 'https://qa-skills.local/schemas/qa-plan.schema.json';
const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const profileValues = Object.freeze(['Lite', 'Full']);
const evidenceKinds = Object.freeze(['command', 'artifact', 'manual', 'system']);
const changeIntakeRequiredProperties = Object.freeze(['targetScope', 'observedFacts', 'inferredIntent', 'nonGoals', 'authoritativeAcceptanceCriteria', 'unresolvedQuestions']);

const matrixCategories = Object.freeze([
  'Static/build',
  'Unit',
  'Integration',
  'Contract/API',
  'E2E',
  'Database/migration',
  'Security',
  'Performance',
  'Compatibility',
  'Accessibility/visual',
  'Regression',
]);
const applicabilityAssessments = Object.freeze(['Required', 'Recommended', 'Not Applicable', 'Blocked', 'Deferred']);
const executionStatuses = Object.freeze(['PASS', 'FAIL', 'BLOCKED', 'NEEDS_HUMAN_REVIEW']);
const riskPriorities = Object.freeze(['Must Verify', 'Should Verify', 'Optional', 'Explicitly Not Verified']);
const validationLayers = Object.freeze(['Static/unit', 'API/integration', 'E2E/system', 'Specialist non-functional', 'Manual acceptance']);

const topLevelProperties = Object.freeze([
  'schema', 'version', 'kind', 'profile', 'runId', 'title', 'generatedAt', 'canonicalValues',
  'repositoryPreflight', 'changeIntake', 'applicabilityMatrix', 'risks', 'verifications',
  'evidence', 'humanGates', 'liteEligibility', 'qaLiteGate', 'fullTriggerBasis',
  'escalationBasis', 'qaPlanGate', 'conclusion', 'rigor',
]);
const requiredTopLevelProperties = Object.freeze([
  'schema', 'version', 'kind', 'profile', 'runId', 'title', 'generatedAt', 'canonicalValues',
  'repositoryPreflight', 'changeIntake', 'applicabilityMatrix', 'risks', 'verifications',
  'evidence', 'humanGates',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function escapePointerSegment(segment) {
  return String(segment).replaceAll('~', '~0').replaceAll('/', '~1');
}

function joinLocation(base, segment) {
  return `${base}/${escapePointerSegment(segment)}`;
}

function addDiagnostic(diagnostics, code, instanceLocation, message) {
  diagnostics.push({ code, instanceLocation, message });
}

function sortedDiagnostics(diagnostics) {
  return [...diagnostics].sort((left, right) => left.instanceLocation.localeCompare(right.instanceLocation) || left.code.localeCompare(right.code));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function hasNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function hasStringArray(value) {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function arrayValuesEqual(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function sortedValues(value) {
  return Array.isArray(value) ? [...value].sort() : [];
}

function objectKeys(value) {
  return isRecord(value) ? Object.keys(value).sort() : [];
}

function addContractDiagnostic(diagnostics, path, message) {
  diagnostics.push(`schema contract drift at ${path}: ${message}`);
}

function compareOrderedArray(diagnostics, path, actual, expected) {
  if (!arrayValuesEqual(actual, expected)) addContractDiagnostic(diagnostics, path, `expected canonical [${expected.join(', ')}], got [${Array.isArray(actual) ? actual.join(', ') : 'not an array'}]`);
}

function compareUnorderedArray(diagnostics, path, actual, expected) {
  if (!arrayValuesEqual(sortedValues(actual), sortedValues(expected))) addContractDiagnostic(diagnostics, path, `expected fields [${sortedValues(expected).join(', ')}], got [${sortedValues(actual).join(', ')}]`);
}

function schemaConstArray(prefixItems) {
  return Array.isArray(prefixItems) ? prefixItems.map((entry) => entry?.const) : [];
}

function validateCanonicalArraySchema(diagnostics, path, schema, expected) {
  if (!isRecord(schema)) {
    addContractDiagnostic(diagnostics, path, 'expected an array schema');
    return;
  }
  if (schema.type !== 'array') addContractDiagnostic(diagnostics, `${path}/type`, 'expected array');
  if (schema.items !== false) addContractDiagnostic(diagnostics, `${path}/items`, 'expected false to reject extra canonical values');
  if (schema.minItems !== expected.length) addContractDiagnostic(diagnostics, `${path}/minItems`, `expected ${expected.length}`);
  if (schema.maxItems !== expected.length) addContractDiagnostic(diagnostics, `${path}/maxItems`, `expected ${expected.length}`);
  compareOrderedArray(diagnostics, `${path}/prefixItems`, schemaConstArray(schema.prefixItems), expected);
}

export function validateSchemaContract(schema) {
  const diagnostics = [];
  if (!isRecord(schema)) return { valid: false, diagnostics: ['schema contract drift at /: schema must be an object'] };
  if (schema.type !== 'object') addContractDiagnostic(diagnostics, '/type', 'expected object');
  if (schema.additionalProperties !== false) addContractDiagnostic(diagnostics, '/additionalProperties', 'expected false to keep the top-level contract closed');
  if (schema.$id !== SCHEMA_ID) addContractDiagnostic(diagnostics, '/$id', `expected ${SCHEMA_ID}`);
  if (schema?.properties?.schema?.const !== PLAN_VERSION) addContractDiagnostic(diagnostics, '/properties/schema/const', `expected ${PLAN_VERSION}`);
  if (schema?.properties?.version?.const !== PLAN_VERSION) addContractDiagnostic(diagnostics, '/properties/version/const', `expected ${PLAN_VERSION}`);
  if (schema?.properties?.kind?.const !== KIND) addContractDiagnostic(diagnostics, '/properties/kind/const', `expected ${KIND}`);
  compareUnorderedArray(diagnostics, '/required', schema.required, requiredTopLevelProperties);
  compareUnorderedArray(diagnostics, '/properties', objectKeys(schema.properties), topLevelProperties);
  compareOrderedArray(diagnostics, '/properties/profile/enum', schema?.properties?.profile?.enum, profileValues);
  validateCanonicalArraySchema(diagnostics, '/$defs/canonicalValues/properties/matrixCategories', schema?.$defs?.canonicalValues?.properties?.matrixCategories, matrixCategories);
  validateCanonicalArraySchema(diagnostics, '/$defs/canonicalValues/properties/applicabilityAssessments', schema?.$defs?.canonicalValues?.properties?.applicabilityAssessments, applicabilityAssessments);
  validateCanonicalArraySchema(diagnostics, '/$defs/canonicalValues/properties/executionStatuses', schema?.$defs?.canonicalValues?.properties?.executionStatuses, executionStatuses);
  compareOrderedArray(diagnostics, '/$defs/evidence/properties/kind/enum', schema?.$defs?.evidence?.properties?.kind?.enum, evidenceKinds);
  compareUnorderedArray(diagnostics, '/$defs/changeIntake/required', schema?.$defs?.changeIntake?.required, changeIntakeRequiredProperties);

  const commandEvidenceRule = Array.isArray(schema?.$defs?.evidence?.allOf)
    ? schema.$defs.evidence.allOf.find((entry) => entry?.if?.properties?.kind?.const === 'command')
    : undefined;
  if (!commandEvidenceRule) {
    addContractDiagnostic(diagnostics, '/$defs/evidence/allOf', 'missing command evidence conditional requirements');
  } else {
    compareUnorderedArray(diagnostics, '/$defs/evidence/allOf/command/then/required', commandEvidenceRule.then?.required, ['command', 'exitCode']);
  }

  if (schema?.$defs?.conclusion?.properties?.releaseDecision?.const !== 'none') addContractDiagnostic(diagnostics, '/$defs/conclusion/properties/releaseDecision/const', 'releaseDecision must be const none');
  return { valid: diagnostics.length === 0, diagnostics };
}

function requireRecord(value, location, label, diagnostics) {
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, 'type', location, `${label} must be an object`);
    return false;
  }
  return true;
}

function closeObject(value, allowed, location, label, diagnostics) {
  if (!isRecord(value)) return;
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) addDiagnostic(diagnostics, 'additionalProperties', joinLocation(location, key), `${label} has unknown additional property ${key}`);
  }
}

function requireProperties(value, required, location, label, diagnostics) {
  if (!isRecord(value)) return;
  for (const key of required) {
    if (!(key in value)) addDiagnostic(diagnostics, 'required', joinLocation(location, key), `${label} is missing required property ${key}`);
  }
}

function requireNonEmptyString(value, key, location, label, diagnostics) {
  if (!isNonEmptyString(value?.[key])) addDiagnostic(diagnostics, 'type', joinLocation(location, key), `${label}.${key} must be a non-empty string`);
}

function requireStringArray(value, key, location, label, diagnostics, { nonEmpty = false } = {}) {
  const arrayValue = value?.[key];
  if (!(nonEmpty ? hasNonEmptyStringArray(arrayValue) : hasStringArray(arrayValue))) {
    addDiagnostic(diagnostics, 'type', joinLocation(location, key), `${label}.${key} must be ${nonEmpty ? 'a non-empty' : 'an'} array of non-empty strings`);
  }
}

function requireBoolean(value, key, location, label, diagnostics) {
  if (typeof value?.[key] !== 'boolean') addDiagnostic(diagnostics, 'type', joinLocation(location, key), `${label}.${key} must be a boolean`);
}

function requireEnum(value, key, allowed, location, label, diagnostics) {
  if (!allowed.includes(value?.[key])) addDiagnostic(diagnostics, 'enum', joinLocation(location, key), `${label}.${key} must be one of ${allowed.join(', ')}`);
}

function requireExactArray(value, key, expected, location, label, diagnostics) {
  const actual = value?.[key];
  if (!Array.isArray(actual)) {
    addDiagnostic(diagnostics, 'type', joinLocation(location, key), `${label}.${key} must be the canonical array`);
    return;
  }
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
    addDiagnostic(diagnostics, 'const', joinLocation(location, key), `${label}.${key} must exactly match the canonical values: ${expected.join(', ')}`);
  }
}

function validateCanonicalValues(plan, diagnostics) {
  const location = '/canonicalValues';
  if (!requireRecord(plan.canonicalValues, location, 'canonicalValues', diagnostics)) return;
  closeObject(plan.canonicalValues, ['matrixCategories', 'applicabilityAssessments', 'executionStatuses'], location, 'canonicalValues', diagnostics);
  requireProperties(plan.canonicalValues, ['matrixCategories', 'applicabilityAssessments', 'executionStatuses'], location, 'canonicalValues', diagnostics);
  requireExactArray(plan.canonicalValues, 'matrixCategories', matrixCategories, location, 'canonicalValues', diagnostics);
  requireExactArray(plan.canonicalValues, 'applicabilityAssessments', applicabilityAssessments, location, 'canonicalValues', diagnostics);
  requireExactArray(plan.canonicalValues, 'executionStatuses', executionStatuses, location, 'canonicalValues', diagnostics);
}

function validateRepositoryPreflight(plan, diagnostics) {
  const value = plan.repositoryPreflight;
  const location = '/repositoryPreflight';
  if (!requireRecord(value, location, 'repositoryPreflight', diagnostics)) return;
  const props = ['skillSourcePath', 'productTargetPath', 'productTargetExplicit', 'skillAndProductSeparated', 'baselineAvailable'];
  closeObject(value, props, location, 'repositoryPreflight', diagnostics);
  requireProperties(value, props, location, 'repositoryPreflight', diagnostics);
  requireNonEmptyString(value, 'skillSourcePath', location, 'repositoryPreflight', diagnostics);
  requireNonEmptyString(value, 'productTargetPath', location, 'repositoryPreflight', diagnostics);
  requireBoolean(value, 'productTargetExplicit', location, 'repositoryPreflight', diagnostics);
  requireBoolean(value, 'skillAndProductSeparated', location, 'repositoryPreflight', diagnostics);
  requireBoolean(value, 'baselineAvailable', location, 'repositoryPreflight', diagnostics);
}

function validateChangeIntake(plan, diagnostics) {
  const value = plan.changeIntake;
  const location = '/changeIntake';
  if (!requireRecord(value, location, 'changeIntake', diagnostics)) return;
  closeObject(value, changeIntakeRequiredProperties, location, 'changeIntake', diagnostics);
  requireProperties(value, changeIntakeRequiredProperties, location, 'changeIntake', diagnostics);
  requireNonEmptyString(value, 'targetScope', location, 'changeIntake', diagnostics);
  requireStringArray(value, 'observedFacts', location, 'changeIntake', diagnostics, { nonEmpty: true });
  requireStringArray(value, 'nonGoals', location, 'changeIntake', diagnostics);
  requireStringArray(value, 'unresolvedQuestions', location, 'changeIntake', diagnostics);
  if (!Array.isArray(value.inferredIntent)) {
    addDiagnostic(diagnostics, 'type', '/changeIntake/inferredIntent', 'changeIntake.inferredIntent must be an array');
  } else {
    value.inferredIntent.forEach((entry, index) => {
      const entryLocation = `/changeIntake/inferredIntent/${index}`;
      if (!requireRecord(entry, entryLocation, 'inferredIntent', diagnostics)) return;
      closeObject(entry, ['statement', 'confidence', 'basis'], entryLocation, 'inferredIntent', diagnostics);
      requireProperties(entry, ['statement', 'confidence', 'basis'], entryLocation, 'inferredIntent', diagnostics);
      requireNonEmptyString(entry, 'statement', entryLocation, 'inferredIntent', diagnostics);
      requireEnum(entry, 'confidence', ['LOW', 'MEDIUM', 'HIGH'], entryLocation, 'inferredIntent', diagnostics);
      requireNonEmptyString(entry, 'basis', entryLocation, 'inferredIntent', diagnostics);
    });
  }
  if (!Array.isArray(value.authoritativeAcceptanceCriteria)) {
    addDiagnostic(diagnostics, 'type', '/changeIntake/authoritativeAcceptanceCriteria', 'authoritativeAcceptanceCriteria must be an array');
    return;
  }
  value.authoritativeAcceptanceCriteria.forEach((entry, index) => {
    const entryLocation = `/changeIntake/authoritativeAcceptanceCriteria/${index}`;
    if (!requireRecord(entry, entryLocation, 'acceptanceCriterion', diagnostics)) return;
    closeObject(entry, ['id', 'criterion', 'source'], entryLocation, 'acceptanceCriterion', diagnostics);
    requireProperties(entry, ['id', 'criterion', 'source'], entryLocation, 'acceptanceCriterion', diagnostics);
    requireNonEmptyString(entry, 'id', entryLocation, 'acceptanceCriterion', diagnostics);
    requireNonEmptyString(entry, 'criterion', entryLocation, 'acceptanceCriterion', diagnostics);
    requireNonEmptyString(entry, 'source', entryLocation, 'acceptanceCriterion', diagnostics);
  });
}

function validateApplicabilityMatrix(plan, diagnostics) {
  const entries = plan.applicabilityMatrix;
  if (!Array.isArray(entries)) {
    addDiagnostic(diagnostics, 'type', '/applicabilityMatrix', 'applicabilityMatrix must be the exact ordered 11-category matrix');
    return;
  }
  if (entries.length !== matrixCategories.length) addDiagnostic(diagnostics, 'canonicalMatrix', '/applicabilityMatrix', `applicabilityMatrix must contain exactly ${matrixCategories.length} categories; missing or extra required canonical category`);
  const seen = new Set();
  entries.forEach((entry, index) => {
    const location = `/applicabilityMatrix/${index}`;
    if (!requireRecord(entry, location, 'applicabilityMatrix entry', diagnostics)) return;
    closeObject(entry, ['category', 'assessment', 'basis', 'verificationRefs', 'factBasis', 'prerequisite', 'rerunCondition', 'owner', 'trigger', 'residualRisk'], location, 'applicabilityMatrix entry', diagnostics);
    requireProperties(entry, ['category', 'assessment', 'basis', 'verificationRefs'], location, 'applicabilityMatrix entry', diagnostics);
    requireNonEmptyString(entry, 'basis', location, 'applicabilityMatrix entry', diagnostics);
    requireStringArray(entry, 'verificationRefs', location, 'applicabilityMatrix entry', diagnostics);
    if (!matrixCategories.includes(entry.category)) addDiagnostic(diagnostics, 'unknownCategory', `${location}/category`, `unknown applicability matrix category ${String(entry.category)}`);
    if (matrixCategories[index] !== entry.category) addDiagnostic(diagnostics, 'canonicalOrder', `${location}/category`, `applicability matrix order must be canonical; expected ${matrixCategories[index] || 'no category'} at index ${index}, got ${String(entry.category)}`);
    if (seen.has(entry.category)) addDiagnostic(diagnostics, 'duplicateCategory', `${location}/category`, `duplicate applicability matrix category ${entry.category}`);
    seen.add(entry.category);
    requireEnum(entry, 'assessment', applicabilityAssessments, location, 'applicabilityMatrix entry', diagnostics);
    validateMatrixState(entry, location, diagnostics);
  });
  for (const category of matrixCategories) {
    if (!entries.some((entry) => isRecord(entry) && entry.category === category)) addDiagnostic(diagnostics, 'missingCategory', '/applicabilityMatrix', `missing required canonical applicability matrix category ${category}`);
  }
}

function validateMatrixState(entry, location, diagnostics) {
  if (entry.assessment === 'Required' || entry.assessment === 'Recommended') {
    if (!hasNonEmptyStringArray(entry.verificationRefs)) addDiagnostic(diagnostics, 'stateRequired', `${location}/verificationRefs`, `${entry.assessment} matrix category ${entry.category} requires verificationRefs`);
  }
  if (entry.assessment === 'Not Applicable') {
    if (!isNonEmptyString(entry.factBasis)) addDiagnostic(diagnostics, 'stateRequired', `${location}/factBasis`, `Not Applicable matrix category ${entry.category} requires fact basis`);
    if (Array.isArray(entry.verificationRefs) && entry.verificationRefs.length > 0) addDiagnostic(diagnostics, 'stateForbidden', `${location}/verificationRefs`, `Not Applicable matrix category ${entry.category} must not carry verificationRefs`);
  }
  if (entry.assessment === 'Blocked') {
    if (!isNonEmptyString(entry.prerequisite)) addDiagnostic(diagnostics, 'stateRequired', `${location}/prerequisite`, `Blocked matrix category ${entry.category} requires prerequisite`);
    if (!isNonEmptyString(entry.rerunCondition)) addDiagnostic(diagnostics, 'stateRequired', `${location}/rerunCondition`, `Blocked matrix category ${entry.category} requires rerun condition`);
    if (Array.isArray(entry.verificationRefs) && entry.verificationRefs.length > 0) addDiagnostic(diagnostics, 'stateForbidden', `${location}/verificationRefs`, `Blocked matrix category ${entry.category} must not carry verificationRefs`);
  }
  if (entry.assessment === 'Deferred') {
    if (!isNonEmptyString(entry.owner)) addDiagnostic(diagnostics, 'stateRequired', `${location}/owner`, `Deferred matrix category ${entry.category} requires owner`);
    if (!isNonEmptyString(entry.trigger)) addDiagnostic(diagnostics, 'stateRequired', `${location}/trigger`, `Deferred matrix category ${entry.category} requires trigger`);
    if (!isNonEmptyString(entry.rerunCondition)) addDiagnostic(diagnostics, 'stateRequired', `${location}/rerunCondition`, `Deferred matrix category ${entry.category} requires rerun condition`);
    if (!isNonEmptyString(entry.residualRisk)) addDiagnostic(diagnostics, 'stateRequired', `${location}/residualRisk`, `Deferred matrix category ${entry.category} requires residual risk`);
    if (Array.isArray(entry.verificationRefs) && entry.verificationRefs.length > 0) addDiagnostic(diagnostics, 'stateForbidden', `${location}/verificationRefs`, `Deferred matrix category ${entry.category} must not carry verificationRefs`);
  }
}

function validateRisks(plan, diagnostics) {
  if (!Array.isArray(plan.risks)) {
    addDiagnostic(diagnostics, 'type', '/risks', 'risks must be an array');
    return;
  }
  plan.risks.forEach((risk, index) => {
    const location = `/risks/${index}`;
    if (!requireRecord(risk, location, 'risk', diagnostics)) return;
    closeObject(risk, ['id', 'category', 'priority', 'description', 'sourceRefs', 'verificationRefs'], location, 'risk', diagnostics);
    requireProperties(risk, ['id', 'category', 'priority', 'description', 'sourceRefs', 'verificationRefs'], location, 'risk', diagnostics);
    requireNonEmptyString(risk, 'id', location, 'risk', diagnostics);
    requireEnum(risk, 'category', matrixCategories, location, 'risk', diagnostics);
    requireEnum(risk, 'priority', riskPriorities, location, 'risk', diagnostics);
    requireNonEmptyString(risk, 'description', location, 'risk', diagnostics);
    requireStringArray(risk, 'sourceRefs', location, 'risk', diagnostics);
    requireStringArray(risk, 'verificationRefs', location, 'risk', diagnostics);
    if (risk.priority === 'Must Verify' && !hasNonEmptyStringArray(risk.verificationRefs)) addDiagnostic(diagnostics, 'mustVerify', `${location}/verificationRefs`, `Must Verify risk ${risk.id || index} requires a verification plan`);
  });
}

function validateVerifications(plan, diagnostics) {
  if (!Array.isArray(plan.verifications)) {
    addDiagnostic(diagnostics, 'type', '/verifications', 'verifications must be an array');
    return;
  }
  plan.verifications.forEach((verification, index) => {
    const location = `/verifications/${index}`;
    if (!requireRecord(verification, location, 'verification', diagnostics)) return;
    closeObject(verification, ['id', 'riskRefs', 'layer', 'method', 'preconditions', 'expectedResult', 'requiredEvidence', 'humanGateRefs', 'status', 'evidenceRefs'], location, 'verification', diagnostics);
    requireProperties(verification, ['id', 'riskRefs', 'layer', 'method', 'preconditions', 'expectedResult', 'requiredEvidence', 'humanGateRefs'], location, 'verification', diagnostics);
    requireNonEmptyString(verification, 'id', location, 'verification', diagnostics);
    requireStringArray(verification, 'riskRefs', location, 'verification', diagnostics);
    requireEnum(verification, 'layer', validationLayers, location, 'verification', diagnostics);
    requireNonEmptyString(verification, 'method', location, 'verification', diagnostics);
    requireStringArray(verification, 'preconditions', location, 'verification', diagnostics);
    requireNonEmptyString(verification, 'expectedResult', location, 'verification', diagnostics);
    requireStringArray(verification, 'requiredEvidence', location, 'verification', diagnostics, { nonEmpty: true });
    requireStringArray(verification, 'humanGateRefs', location, 'verification', diagnostics);
    if ('status' in verification) requireEnum(verification, 'status', executionStatuses, location, 'verification', diagnostics);
    if ('evidenceRefs' in verification) requireStringArray(verification, 'evidenceRefs', location, 'verification', diagnostics);
    if (verification.status === 'PASS' && 'evidenceRefs' in verification && !hasNonEmptyStringArray(verification.evidenceRefs)) addDiagnostic(diagnostics, 'passEvidence', `${location}/evidenceRefs`, `PASS verification ${verification.id || index} requires evidence`);
  });
}

function validateEvidence(plan, diagnostics) {
  if (!Array.isArray(plan.evidence)) {
    addDiagnostic(diagnostics, 'type', '/evidence', 'evidence must be an array');
    return;
  }
  plan.evidence.forEach((evidence, index) => {
    const location = `/evidence/${index}`;
    if (!requireRecord(evidence, location, 'evidence', diagnostics)) return;
    closeObject(evidence, ['id', 'verificationRef', 'kind', 'command', 'exitCode', 'observed', 'artifactRefs'], location, 'evidence', diagnostics);
    requireProperties(evidence, ['id', 'verificationRef', 'kind', 'observed', 'artifactRefs'], location, 'evidence', diagnostics);
    requireNonEmptyString(evidence, 'id', location, 'evidence', diagnostics);
    requireNonEmptyString(evidence, 'verificationRef', location, 'evidence', diagnostics);
    requireEnum(evidence, 'kind', evidenceKinds, location, 'evidence', diagnostics);
    if (evidence.kind === 'command' || 'command' in evidence) requireNonEmptyString(evidence, 'command', location, 'evidence', diagnostics);
    if (evidence.kind === 'command' || 'exitCode' in evidence) {
      if (!Number.isInteger(evidence.exitCode)) addDiagnostic(diagnostics, 'type', `${location}/exitCode`, 'evidence.exitCode must be an integer');
    }
    requireNonEmptyString(evidence, 'observed', location, 'evidence', diagnostics);
    requireStringArray(evidence, 'artifactRefs', location, 'evidence', diagnostics);
  });
}

function validatePlanStageIsolation(plan, options, diagnostics) {
  if (options.requireConclusion) return;
  if ('conclusion' in plan) addDiagnostic(diagnostics, 'planStage', '/conclusion', 'Default plan-stage validation rejects conclusion artifacts; rerun with --require-conclusion for conclusion validation');
  if ('qaLiteGate' in plan) addDiagnostic(diagnostics, 'planStage', '/qaLiteGate', 'Default plan-stage validation rejects qaLiteGate execution artifacts; rerun with --require-conclusion for conclusion validation');
  if (Array.isArray(plan.evidence) && plan.evidence.length > 0) addDiagnostic(diagnostics, 'planStage', '/evidence', 'Default plan-stage validation rejects populated evidence; rerun with --require-conclusion for conclusion validation');
  if (!Array.isArray(plan.verifications)) return;
  plan.verifications.forEach((verification, index) => {
    if (!isRecord(verification)) return;
    if ('status' in verification) addDiagnostic(diagnostics, 'planStage', `/verifications/${index}/status`, 'Default plan-stage validation rejects verification status; rerun with --require-conclusion for conclusion validation');
    if ('evidenceRefs' in verification) addDiagnostic(diagnostics, 'planStage', `/verifications/${index}/evidenceRefs`, 'Default plan-stage validation rejects verification evidenceRefs; rerun with --require-conclusion for conclusion validation');
  });
}

function validateHumanGates(plan, diagnostics) {
  if (!Array.isArray(plan.humanGates)) {
    addDiagnostic(diagnostics, 'type', '/humanGates', 'humanGates must be an array');
    return;
  }
  plan.humanGates.forEach((gate, index) => {
    const location = `/humanGates/${index}`;
    if (!requireRecord(gate, location, 'humanGate', diagnostics)) return;
    closeObject(gate, ['id', 'critical', 'status', 'question'], location, 'humanGate', diagnostics);
    requireProperties(gate, ['id', 'critical', 'status', 'question'], location, 'humanGate', diagnostics);
    requireNonEmptyString(gate, 'id', location, 'humanGate', diagnostics);
    requireBoolean(gate, 'critical', location, 'humanGate', diagnostics);
    requireEnum(gate, 'status', ['OPEN', 'PENDING', 'COMPLETE', 'WAIVED'], location, 'humanGate', diagnostics);
    requireNonEmptyString(gate, 'question', location, 'humanGate', diagnostics);
  });
}

function collectIds(entries) {
  return new Set(Array.isArray(entries) ? entries.filter(isRecord).map((entry) => entry.id).filter(isNonEmptyString) : []);
}

function collectEntriesById(entries) {
  const byId = new Map();
  if (!Array.isArray(entries)) return byId;
  entries.forEach((entry, index) => {
    if (isRecord(entry) && isNonEmptyString(entry.id) && !byId.has(entry.id)) byId.set(entry.id, { entry, index });
  });
  return byId;
}

function validateUniqueIds(entries, collectionName, location, diagnostics) {
  if (!Array.isArray(entries)) return;
  const seen = new Map();
  entries.forEach((entry, index) => {
    if (!isRecord(entry) || !isNonEmptyString(entry.id)) return;
    if (seen.has(entry.id)) {
      addDiagnostic(diagnostics, 'duplicateId', `${location}/${index}/id`, `duplicate ${collectionName} ID ${entry.id}`);
      return;
    }
    seen.set(entry.id, index);
  });
}

function validateDuplicateIds(plan, diagnostics) {
  validateUniqueIds(plan.risks, 'risk', '/risks', diagnostics);
  validateUniqueIds(plan.verifications, 'verification', '/verifications', diagnostics);
  validateUniqueIds(plan.evidence, 'evidence', '/evidence', diagnostics);
  validateUniqueIds(plan.humanGates, 'Human Gate', '/humanGates', diagnostics);
}

function validateReferenceArray(refs, knownIds, ownerLabel, refsLocation, diagnostics) {
  if (!Array.isArray(refs)) return;
  refs.forEach((ref, index) => {
    if (isNonEmptyString(ref) && !knownIds.has(ref)) addDiagnostic(diagnostics, 'missingReference', `${refsLocation}/${index}`, `${ownerLabel} references missing ${ref}`);
  });
}

function validateReferences(plan, diagnostics) {
  const riskIds = collectIds(plan.risks);
  const verificationIds = collectIds(plan.verifications);
  const evidenceIds = collectIds(plan.evidence);
  const humanGateIds = collectIds(plan.humanGates);
  if (Array.isArray(plan.applicabilityMatrix)) {
    plan.applicabilityMatrix.forEach((entry, index) => {
      if (isRecord(entry)) validateReferenceArray(entry.verificationRefs, verificationIds, `matrix category ${entry.category || index}`, `/applicabilityMatrix/${index}/verificationRefs`, diagnostics);
    });
  }
  if (Array.isArray(plan.risks)) {
    plan.risks.forEach((risk, index) => {
      if (isRecord(risk)) validateReferenceArray(risk.verificationRefs, verificationIds, `risk ${risk.id || index}`, `/risks/${index}/verificationRefs`, diagnostics);
    });
  }
  if (Array.isArray(plan.verifications)) {
    plan.verifications.forEach((verification, index) => {
      if (!isRecord(verification)) return;
      validateReferenceArray(verification.riskRefs, riskIds, `verification ${verification.id || index}`, `/verifications/${index}/riskRefs`, diagnostics);
      if (Array.isArray(verification.evidenceRefs)) validateReferenceArray(verification.evidenceRefs, evidenceIds, `verification ${verification.id || index}`, `/verifications/${index}/evidenceRefs`, diagnostics);
      validateReferenceArray(verification.humanGateRefs, humanGateIds, `verification ${verification.id || index}`, `/verifications/${index}/humanGateRefs`, diagnostics);
    });
  }
  if (Array.isArray(plan.evidence)) {
    plan.evidence.forEach((evidence, index) => {
      if (isRecord(evidence) && isNonEmptyString(evidence.verificationRef) && !verificationIds.has(evidence.verificationRef)) {
        addDiagnostic(diagnostics, 'missingReference', `/evidence/${index}/verificationRef`, `evidence ${evidence.id || index} references missing ${evidence.verificationRef}`);
      }
    });
  }
}

function risksLinkedFromMatrixEntry(entry, verificationsById, risksById) {
  const linkedRisks = [];
  if (!Array.isArray(entry.verificationRefs)) return linkedRisks;
  for (const verificationRef of entry.verificationRefs) {
    const verification = verificationsById.get(verificationRef)?.entry;
    if (!isRecord(verification) || !Array.isArray(verification.riskRefs)) continue;
    for (const riskRef of verification.riskRefs) {
      const risk = risksById.get(riskRef)?.entry;
      if (isRecord(risk)) linkedRisks.push(risk);
    }
  }
  return linkedRisks;
}

function validateMatrixRiskSemantics(plan, diagnostics) {
  if (!Array.isArray(plan.applicabilityMatrix)) return;
  const verificationsById = collectEntriesById(plan.verifications);
  const risksById = collectEntriesById(plan.risks);
  plan.applicabilityMatrix.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    const linkedRisks = risksLinkedFromMatrixEntry(entry, verificationsById, risksById);
    if (entry.assessment === 'Required') {
      const hasSameCategoryMustVerify = linkedRisks.some((risk) => risk.category === entry.category && risk.priority === 'Must Verify');
      if (!hasSameCategoryMustVerify) {
        addDiagnostic(diagnostics, 'matrixRiskMapping', `/applicabilityMatrix/${index}/verificationRefs`, `Required matrix category ${entry.category} must map through linked verifications to at least one same-category Must Verify risk`);
      }
    }
    if (entry.assessment === 'Recommended') {
      const hasSameCategoryVerifiableRisk = linkedRisks.some((risk) => risk.category === entry.category && risk.priority !== 'Explicitly Not Verified');
      if (!hasSameCategoryVerifiableRisk) {
        addDiagnostic(diagnostics, 'matrixRiskMapping', `/applicabilityMatrix/${index}/verificationRefs`, `Recommended matrix category ${entry.category} must map to an existing same-category risk that is not Explicitly Not Verified`);
      }
    }
  });
}

function validateLiteProfile(plan, diagnostics) {
  if (!('liteEligibility' in plan)) addDiagnostic(diagnostics, 'required', '/liteEligibility', 'Lite profile requires liteEligibility');
  if (Array.isArray(plan.applicabilityMatrix)) {
    plan.applicabilityMatrix.forEach((entry, index) => {
      if (isRecord(entry) && (entry.assessment === 'Blocked' || entry.assessment === 'Deferred')) {
        addDiagnostic(diagnostics, 'liteMatrixAssessment', `/applicabilityMatrix/${index}/assessment`, `Lite profile rejects ${entry.assessment} matrix assessment for ${entry.category || 'unknown category'}`);
      }
    });
  }
  if (isRecord(plan.liteEligibility)) {
    const eligibility = plan.liteEligibility;
    const location = '/liteEligibility';
    closeObject(eligibility, ['decision', 'basis', 'disqualifiers', 'safeLocalVerificationAvailable', 'requiresFullTriggers'], location, 'liteEligibility', diagnostics);
    requireProperties(eligibility, ['decision', 'basis', 'disqualifiers', 'safeLocalVerificationAvailable', 'requiresFullTriggers'], location, 'liteEligibility', diagnostics);
    if (eligibility.decision !== 'LITE') addDiagnostic(diagnostics, 'const', '/liteEligibility/decision', 'Lite eligibility decision must be LITE');
    requireNonEmptyString(eligibility, 'basis', location, 'liteEligibility', diagnostics);
    requireStringArray(eligibility, 'disqualifiers', location, 'liteEligibility', diagnostics);
    if (eligibility.safeLocalVerificationAvailable !== true) addDiagnostic(diagnostics, 'liteEligibility', '/liteEligibility/safeLocalVerificationAvailable', 'Lite profile requires safe local verification to be available');
    requireStringArray(eligibility, 'requiresFullTriggers', location, 'liteEligibility', diagnostics);
    if (Array.isArray(eligibility.requiresFullTriggers) && eligibility.requiresFullTriggers.length > 0) addDiagnostic(diagnostics, 'liteEligibility', '/liteEligibility/requiresFullTriggers', 'Lite profile cannot have Full triggers');
  } else if ('liteEligibility' in plan) {
    addDiagnostic(diagnostics, 'type', '/liteEligibility', 'liteEligibility must be an object');
  }
  if (isRecord(plan.qaLiteGate)) {
    const gate = plan.qaLiteGate;
    const location = '/qaLiteGate';
    closeObject(gate, ['status', 'evidenceRefs', 'unresolvedBlockers', 'pendingCriticalHumanGates'], location, 'qaLiteGate', diagnostics);
    requireProperties(gate, ['status', 'evidenceRefs', 'unresolvedBlockers', 'pendingCriticalHumanGates'], location, 'qaLiteGate', diagnostics);
    requireEnum(gate, 'status', executionStatuses, location, 'qaLiteGate', diagnostics);
    requireStringArray(gate, 'evidenceRefs', location, 'qaLiteGate', diagnostics, { nonEmpty: gate.status === 'PASS' });
    requireStringArray(gate, 'unresolvedBlockers', location, 'qaLiteGate', diagnostics);
    requireStringArray(gate, 'pendingCriticalHumanGates', location, 'qaLiteGate', diagnostics);
  } else if ('qaLiteGate' in plan) {
    addDiagnostic(diagnostics, 'type', '/qaLiteGate', 'qaLiteGate must be an object');
  }
}

function validateQaLiteGateConclusion(plan, options, diagnostics) {
  if (!options.requireConclusion || plan.profile !== 'Lite') return;
  if (!('qaLiteGate' in plan)) {
    addDiagnostic(diagnostics, 'required', '/qaLiteGate', 'Concluded Lite validation requires qaLiteGate');
    return;
  }
  const gate = plan.qaLiteGate;
  if (!isRecord(gate)) return;
  const evidenceIds = collectIds(plan.evidence);
  const humanGateIds = collectIds(plan.humanGates);
  validateReferenceArray(gate.evidenceRefs, evidenceIds, 'qaLiteGate', '/qaLiteGate/evidenceRefs', diagnostics);
  validateReferenceArray(gate.pendingCriticalHumanGates, humanGateIds, 'qaLiteGate', '/qaLiteGate/pendingCriticalHumanGates', diagnostics);
  if (isRecord(plan.conclusion) && gate.status !== plan.conclusion.overallStatus) {
    addDiagnostic(diagnostics, 'qaLiteGateStatus', '/qaLiteGate/status', 'qaLiteGate.status must equal conclusion.overallStatus');
  }
  if (gate.status === 'PASS') {
    if (Array.isArray(gate.unresolvedBlockers) && gate.unresolvedBlockers.length > 0) addDiagnostic(diagnostics, 'qaLiteGatePass', '/qaLiteGate/unresolvedBlockers', 'qaLiteGate PASS requires empty unresolvedBlockers');
    if (Array.isArray(gate.pendingCriticalHumanGates) && gate.pendingCriticalHumanGates.length > 0) addDiagnostic(diagnostics, 'qaLiteGatePass', '/qaLiteGate/pendingCriticalHumanGates', 'qaLiteGate PASS requires empty pendingCriticalHumanGates');
  }
}

function validateRigor(plan, diagnostics) {
  if (!('rigor' in plan)) return;
  const rigor = plan.rigor;
  if (!requireRecord(rigor, '/rigor', 'rigor', diagnostics)) return;
  closeObject(rigor, ['level', 'basis', 'approvalRef'], '/rigor', 'rigor', diagnostics);
  requireProperties(rigor, ['level', 'basis'], '/rigor', 'rigor', diagnostics);
  requireEnum(rigor, 'level', ['Standard', 'Audit'], '/rigor', 'rigor', diagnostics);
  requireNonEmptyString(rigor, 'basis', '/rigor', 'rigor', diagnostics);
  if ('approvalRef' in rigor) requireNonEmptyString(rigor, 'approvalRef', '/rigor', 'rigor', diagnostics);
  if (rigor.level === 'Audit') {
    if (plan.profile !== 'Full') addDiagnostic(diagnostics, 'rigor', '/rigor/level', 'Audit rigor requires Full profile');
    if (!isNonEmptyString(rigor.approvalRef)) addDiagnostic(diagnostics, 'rigorApproval', '/rigor/approvalRef', 'Audit rigor requires nonempty approvalRef');
  }
}

function validateFullProfile(plan, diagnostics) {
  if ('qaLiteGate' in plan) addDiagnostic(diagnostics, 'fullQaLiteGate', '/qaLiteGate', 'Full profile rejects stale Lite qaLiteGate');
  if (!hasNonEmptyStringArray(plan.fullTriggerBasis)) addDiagnostic(diagnostics, 'fullTriggerBasis', '/fullTriggerBasis', 'Full profile requires non-empty trigger basis');
  if (!hasNonEmptyStringArray(plan.escalationBasis)) addDiagnostic(diagnostics, 'escalationBasis', '/escalationBasis', 'Full profile requires non-empty escalation basis');
  if (!('qaPlanGate' in plan)) {
    addDiagnostic(diagnostics, 'required', '/qaPlanGate', 'Full profile requires QA Plan Gate OPEN');
  } else if (!isRecord(plan.qaPlanGate)) {
    addDiagnostic(diagnostics, 'type', '/qaPlanGate', 'qaPlanGate must be an object');
  } else {
    const gate = plan.qaPlanGate;
    const location = '/qaPlanGate';
    closeObject(gate, ['status', 'triggerBasis', 'escalationBasis'], location, 'qaPlanGate', diagnostics);
    requireProperties(gate, ['status', 'triggerBasis', 'escalationBasis'], location, 'qaPlanGate', diagnostics);
    if (gate.status !== 'OPEN') addDiagnostic(diagnostics, 'qaPlanGate', '/qaPlanGate/status', 'QA Plan Gate status must be OPEN');
    requireStringArray(gate, 'triggerBasis', location, 'qaPlanGate', diagnostics, { nonEmpty: true });
    requireStringArray(gate, 'escalationBasis', location, 'qaPlanGate', diagnostics, { nonEmpty: true });
    if (Array.isArray(plan.fullTriggerBasis) && Array.isArray(gate.triggerBasis) && !arraysEqual(plan.fullTriggerBasis, gate.triggerBasis)) {
      addDiagnostic(diagnostics, 'qaPlanGateBasis', '/qaPlanGate/triggerBasis', 'qaPlanGate.triggerBasis must match top-level fullTriggerBasis exactly');
    }
    if (Array.isArray(plan.escalationBasis) && Array.isArray(gate.escalationBasis) && !arraysEqual(plan.escalationBasis, gate.escalationBasis)) {
      addDiagnostic(diagnostics, 'qaPlanGateBasis', '/qaPlanGate/escalationBasis', 'qaPlanGate.escalationBasis must match top-level escalationBasis exactly');
    }
  }
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function validateConclusion(plan, options, diagnostics) {
  if (options.requireConclusion && !('conclusion' in plan)) addDiagnostic(diagnostics, 'required', '/conclusion', 'conclusion is required by --require-conclusion');
  if (!('conclusion' in plan)) return;
  const conclusion = plan.conclusion;
  if (!requireRecord(conclusion, '/conclusion', 'conclusion', diagnostics)) return;
  const props = ['overallStatus', 'qaConclusionGate', 'evidenceRefs', 'unresolvedBlockers', 'pendingCriticalHumanGates', 'residualRisks', 'releaseDecision'];
  closeObject(conclusion, props, '/conclusion', 'conclusion', diagnostics);
  requireProperties(conclusion, props, '/conclusion', 'conclusion', diagnostics);
  requireEnum(conclusion, 'overallStatus', executionStatuses, '/conclusion', 'conclusion', diagnostics);
  requireEnum(conclusion, 'qaConclusionGate', ['COMPLETE', 'BLOCKED'], '/conclusion', 'conclusion', diagnostics);
  requireStringArray(conclusion, 'evidenceRefs', '/conclusion', 'conclusion', diagnostics);
  requireStringArray(conclusion, 'unresolvedBlockers', '/conclusion', 'conclusion', diagnostics);
  requireStringArray(conclusion, 'pendingCriticalHumanGates', '/conclusion', 'conclusion', diagnostics);
  requireStringArray(conclusion, 'residualRisks', '/conclusion', 'conclusion', diagnostics);
  requireNonEmptyString(conclusion, 'releaseDecision', '/conclusion', 'conclusion', diagnostics);
  if (conclusion.releaseDecision !== 'none') addDiagnostic(diagnostics, 'releaseDecision', '/conclusion/releaseDecision', 'conclusion.releaseDecision must be exactly none');
  const evidenceIds = collectIds(plan.evidence);
  const humanGateIds = collectIds(plan.humanGates);
  validateExecutionEvidenceConsistency(plan, diagnostics);
  validateReferenceArray(conclusion.evidenceRefs, evidenceIds, 'conclusion', '/conclusion/evidenceRefs', diagnostics);
  validateReferenceArray(conclusion.pendingCriticalHumanGates, humanGateIds, 'conclusion', '/conclusion/pendingCriticalHumanGates', diagnostics);
  validateRequireConclusionExecution(plan, diagnostics);
  if (conclusion.overallStatus === 'PASS') {
    if (conclusion.qaConclusionGate !== 'COMPLETE') addDiagnostic(diagnostics, 'passConclusionGate', '/conclusion/qaConclusionGate', 'PASS conclusion requires qaConclusionGate COMPLETE');
    if (Array.isArray(conclusion.evidenceRefs) && conclusion.evidenceRefs.length === 0) addDiagnostic(diagnostics, 'passEvidence', '/conclusion/evidenceRefs', 'PASS conclusion requires evidence');
    if (Array.isArray(conclusion.unresolvedBlockers) && conclusion.unresolvedBlockers.length > 0) addDiagnostic(diagnostics, 'passBlockers', '/conclusion/unresolvedBlockers', 'PASS conclusion cannot have unresolved blockers');
    if (Array.isArray(conclusion.pendingCriticalHumanGates) && conclusion.pendingCriticalHumanGates.length > 0) addDiagnostic(diagnostics, 'passHumanGate', '/conclusion/pendingCriticalHumanGates', `PASS conclusion cannot have pending critical Human Gates: ${conclusion.pendingCriticalHumanGates.join(', ')}`);
    if (Array.isArray(plan.humanGates)) {
      for (const gate of plan.humanGates) {
        if (isRecord(gate) && gate.critical === true && (gate.status === 'OPEN' || gate.status === 'PENDING')) {
          addDiagnostic(diagnostics, 'passHumanGate', '/humanGates', `PASS conclusion cannot have pending critical Human Gate ${gate.id || 'unknown'}`);
        }
      }
    }
    validatePassConclusionMustVerify(plan, diagnostics);
  }
}

function validateRequireConclusionExecution(plan, diagnostics) {
  if (!Array.isArray(plan.verifications)) return;
  plan.verifications.forEach((verification, index) => {
    if (!isRecord(verification)) return;
    if (!executionStatuses.includes(verification.status)) {
      addDiagnostic(diagnostics, 'conclusionExecutionStatus', `/verifications/${index}/status`, `--require-conclusion requires verification ${verification.id || index} to have canonical status`);
    }
    if (!hasNonEmptyStringArray(verification.evidenceRefs)) {
      addDiagnostic(diagnostics, 'conclusionExecutionEvidence', `/verifications/${index}/evidenceRefs`, `--require-conclusion requires verification ${verification.id || index} to have nonempty evidenceRefs`);
    }
  });
}

function validateExecutionEvidenceConsistency(plan, diagnostics) {
  const evidenceById = collectEntriesById(plan.evidence);
  if (!Array.isArray(plan.verifications)) return;
  plan.verifications.forEach((verification, index) => {
    if (!isRecord(verification) || !Array.isArray(verification.evidenceRefs)) return;
    verification.evidenceRefs.forEach((evidenceRef, refIndex) => {
      const evidence = evidenceById.get(evidenceRef)?.entry;
      if (!evidence) return;
      if (evidence.verificationRef !== verification.id) {
        addDiagnostic(diagnostics, 'evidenceConsistency', `/verifications/${index}/evidenceRefs/${refIndex}`, `verification ${verification.id || index} evidenceRef ${evidenceRef} must point to real evidence for the same verification`);
      }
    });
  });
}

function validatePassConclusionMustVerify(plan, diagnostics) {
  const verificationsById = collectEntriesById(plan.verifications);
  if (!Array.isArray(plan.risks)) return;
  plan.risks.forEach((risk, riskIndex) => {
    if (!isRecord(risk) || risk.priority !== 'Must Verify' || !Array.isArray(risk.verificationRefs)) return;
    risk.verificationRefs.forEach((verificationRef, refIndex) => {
      const verificationRecord = verificationsById.get(verificationRef);
      if (!verificationRecord) return;
      const verification = verificationRecord.entry;
      if (!('status' in verification)) {
        addDiagnostic(diagnostics, 'passMustVerifyStatus', `/verifications/${verificationRecord.index}/status`, `PASS conclusion requires Must Verify linked verification ${verification.id || verificationRef} to have execution status`);
      }
      if (verification.status !== 'PASS') {
        addDiagnostic(diagnostics, 'passMustVerify', `/verifications/${verificationRecord.index}/status`, `PASS conclusion requires Must Verify linked verification ${verification.id || verificationRef} to be PASS`);
      }
      if (!('evidenceRefs' in verification)) {
        addDiagnostic(diagnostics, 'passMustVerifyEvidence', `/verifications/${verificationRecord.index}/evidenceRefs`, `PASS conclusion requires Must Verify linked verification ${verification.id || verificationRef} to have evidenceRefs`);
      }
      if (!hasNonEmptyStringArray(verification.evidenceRefs)) {
        addDiagnostic(diagnostics, 'passMustVerifyEvidence', `/verifications/${verificationRecord.index}/evidenceRefs`, `PASS conclusion requires Must Verify linked verification ${verification.id || verificationRef} to have evidence`);
      }
    });
    if (risk.verificationRefs.length === 0) {
      addDiagnostic(diagnostics, 'passMustVerify', `/risks/${riskIndex}/verificationRefs`, `PASS conclusion requires Must Verify risk ${risk.id || riskIndex} to link to PASS verification evidence`);
    }
  });
}

export function validateQaPlan(plan, options = {}) {
  const diagnostics = [];
  if (!requireRecord(plan, '', 'QA plan', diagnostics)) return { valid: false, diagnostics: sortedDiagnostics(diagnostics) };
  closeObject(plan, topLevelProperties, '', 'QA plan', diagnostics);
  requireProperties(plan, requiredTopLevelProperties, '', 'QA plan', diagnostics);
  if (plan.schema !== PLAN_VERSION) addDiagnostic(diagnostics, 'const', '/schema', `schema must be ${PLAN_VERSION}`);
  if (plan.version !== PLAN_VERSION) addDiagnostic(diagnostics, 'const', '/version', `version must be ${PLAN_VERSION}`);
  if (plan.kind !== KIND) addDiagnostic(diagnostics, 'const', '/kind', `kind must be ${KIND}`);
  requireEnum(plan, 'profile', profileValues, '', 'QA plan', diagnostics);
  requireNonEmptyString(plan, 'runId', '', 'QA plan', diagnostics);
  requireNonEmptyString(plan, 'title', '', 'QA plan', diagnostics);
  requireNonEmptyString(plan, 'generatedAt', '', 'QA plan', diagnostics);
  validateCanonicalValues(plan, diagnostics);
  validateRepositoryPreflight(plan, diagnostics);
  validateChangeIntake(plan, diagnostics);
  validatePlanStageIsolation(plan, options, diagnostics);
  validateApplicabilityMatrix(plan, diagnostics);
  validateRisks(plan, diagnostics);
  validateVerifications(plan, diagnostics);
  validateEvidence(plan, diagnostics);
  validateHumanGates(plan, diagnostics);
  validateDuplicateIds(plan, diagnostics);
  validateReferences(plan, diagnostics);
  validateMatrixRiskSemantics(plan, diagnostics);
  validateRigor(plan, diagnostics);
  if (plan.profile === 'Lite') validateLiteProfile(plan, diagnostics);
  if (plan.profile === 'Full') validateFullProfile(plan, diagnostics);
  validateQaLiteGateConclusion(plan, options, diagnostics);
  validateConclusion(plan, options, diagnostics);
  return { valid: diagnostics.length === 0, diagnostics: sortedDiagnostics(diagnostics) };
}

function loadSchema() {
  const here = dirname(fileURLToPath(import.meta.url));
  const schemaPath = resolve(here, '..', 'schemas', 'qa-plan.schema.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const contract = validateSchemaContract(schema);
  if (!contract.valid) throw new Error(`schema contract drift: ${contract.diagnostics.join('; ')}`);
  return schema;
}

function usage() {
  return 'Usage: node qa-skill/tools/validate-qa-plan.mjs [--json] [--require-conclusion] <plan.json>';
}

function cli(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: 'boolean', default: false },
        'require-conclusion': { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    return { status: 2, stdout: '', stderr: `${usage()}\nUnknown flag or option: ${error.message}\n` };
  }
  if (parsed.positionals.length !== 1) return { status: 2, stdout: '', stderr: `${usage()}\nExpected exactly one input QA plan JSON path.\n` };

  let schema;
  try {
    schema = loadSchema();
  } catch (error) {
    return { status: 2, stdout: '', stderr: `Unable to load qa-plan schema: ${error.message}\n` };
  }

  let inputStats;
  const inputPath = parsed.positionals[0];
  try {
    const literalStats = lstatSync(inputPath);
    inputStats = statSync(inputPath);
    if (!literalStats.isFile() || !inputStats.isFile()) {
      return { status: 2, stdout: '', stderr: `Input plan must be a literal regular file, got non-regular path: ${inputPath}\n` };
    }
    if (inputStats.size > MAX_INPUT_BYTES) {
      return { status: 2, stdout: '', stderr: `Input plan is oversized: maximum 4 MiB (${MAX_INPUT_BYTES} bytes), got ${inputStats.size} bytes\n` };
    }
  } catch (error) {
    return { status: 2, stdout: '', stderr: `Input plan missing, not found, or unreadable: ${error.message}\n` };
  }

  let plan;
  try {
    plan = JSON.parse(readFileSync(inputPath, 'utf8'));
  } catch (error) {
    const message = error.code === 'ENOENT' ? `Input plan missing or not found: ${error.message}` : `Invalid JSON input or read failure: ${error.message}`;
    return { status: 2, stdout: '', stderr: `${message}\n` };
  }

  const result = validateQaPlan(plan, { requireConclusion: parsed.values['require-conclusion'] === true });
  if (parsed.values.json) {
    return {
      status: result.valid ? 0 : 1,
      stdout: `${JSON.stringify({ valid: result.valid, schema: schema.$id, version: PLAN_VERSION, diagnostics: result.diagnostics }, null, 2)}\n`,
      stderr: '',
    };
  }
  if (result.valid) return { status: 0, stdout: `valid ${PLAN_VERSION}\n`, stderr: '' };
  return { status: 1, stdout: '', stderr: result.diagnostics.map((diagnostic) => `${diagnostic.instanceLocation || '/'} ${diagnostic.code}: ${diagnostic.message}`).join('\n') + '\n' };
}

if (import.meta.url === `file://${process.argv[1].replaceAll('\\', '/')}` || process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = cli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.status;
}
