#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runOpenCodeScenario, validateRunInputs } from './harness.mjs';
import { scenarioById } from './scenarios.mjs';

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function requireOption(options, key) {
  if (!options[key]) throw new Error(`Missing required --${key}`);
  return options[key];
}

const options = parseArgs(process.argv.slice(2));
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(path.dirname(testDirectory));
const scenario = scenarioById(requireOption(options, 'scenario'));
const model = requireOption(options, 'model');
const agent = requireOption(options, 'agent');
const validation = validateRunInputs({ model, agent });
if (!validation.ok) throw new Error(`Invalid OpenCode run inputs: ${validation.issues.join('; ')}`);

const result = runOpenCodeScenario({
  scenario,
  model,
  agent,
  artifactRoot: path.resolve(requireOption(options, 'artifact-root')),
  packRoot: path.join(repositoryRoot, 'qa-skill'),
  timeoutMs: Number(options['timeout-ms'] || process.env.QA_SKILL_TIMEOUT_MS || 600000),
});

process.stdout.write(`${JSON.stringify({
  scenario: result.scenario.id,
  qaVerdict: result.qaVerdict,
  infrastructureStatus: result.infrastructureStatus.status,
  agentTopology: result.agentTopology,
  artifacts: result.artifacts.runDirectory,
}, null, 2)}\n`);
