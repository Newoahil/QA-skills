import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { createProgressSink, runAgentJson } from '../../tools/guardian/investigation-process.mjs';

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  return child;
}

test('runAgentJson streams OpenCode tool progress and parses text events', async () => {
  // Given: OpenCode emits one tool event and one final text event, split across stdout chunks.
  const child = fakeChild();
  const calls = [];
  const progress = [];
  const spawnImpl = (bin, args, options) => {
    calls.push({ bin, args, options });
    queueMicrotask(() => {
      const toolEvent = `${JSON.stringify({
        type: 'tool_use',
        part: { tool: 'grep', state: { status: 'completed', input: { pattern: 'badDebtReserves' }, title: 'find field' } },
      })}\n`;
      const textEvent = `${JSON.stringify({
        type: 'text',
        part: { text: '{"specialist":"guardian-code","hypotheses":[],"evidence":[],"unresolved_facts":[],"acceptance_criteria":[]}' },
      })}\n`;
      child.stdout.write(toolEvent.slice(0, 17));
      child.stdout.write(toolEvent.slice(17));
      child.stdout.write(textEvent);
      child.emit('close', 0);
    });
    return child;
  };

  // When: the specialist adapter runs.
  const result = await runAgentJson({
    agent: 'guardian-code',
    repoDir: 'D:/repo',
    prompt: 'issue data',
    timeoutMs: 1000,
    spawnImpl,
    serverUrl: 'http://127.0.0.1:4097',
    progressSink: (line) => progress.push(line),
  });

  // Then: OpenCode runs in JSON mode, progress is emitted immediately, and the text payload wins.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[0], 'run');
  assert.equal(calls[0].args.includes('--pure'), false);
  assert.equal(calls[0].args.includes('--attach'), true);
  assert.equal(calls[0].args.includes('http://127.0.0.1:4097'), true);
  assert.equal(calls[0].args.includes('--format'), true);
  assert.equal(calls[0].args[calls[0].args.indexOf('--format') + 1], 'json');
  assert.equal(progress.some((line) => line.includes('guardian-code') && line.includes('grep') && line.includes('badDebtReserves')), true);
  assert.equal(result.specialist, 'guardian-code');
});

test('processSpecialistRunner keeps issue body out of the process argv', async () => {
  // Given: non-ASCII issue data and an already materialized UTF-8 issue-data path.
  const child = fakeChild();
  const calls = [];
  const spawnImpl = (bin, args) => {
    calls.push({ bin, args });
    queueMicrotask(() => {
      child.stdout.write(`${JSON.stringify({
        type: 'text',
        part: { text: '{"specialist":"guardian-code","hypotheses":[],"evidence":[],"unresolved_facts":[],"acceptance_criteria":[]}' },
      })}\n`);
      child.emit('close', 0);
    });
    return child;
  };

  // When: a specialist is launched.
  const { processSpecialistRunner } = await import('../../tools/guardian/investigation-process.mjs');
  await processSpecialistRunner({
    role: 'guardian-code',
    issue: 211,
    issueData: { title: '粉红色', body: '预计坏账金额改为粉红色' },
    issueDataPath: 'D:/repo/.qa/guardian/211/issue-data.json',
    repoDir: 'D:/repo',
    dossierPath: 'D:/repo/.qa/guardian/211/dossier.json',
    timeout_ms: 1000,
    spawnImpl,
  });

  // Then: argv contains only the file path, never the body/title text.
  const argv = calls[0].args.join(' ');
  assert.equal(argv.includes('issue-data.json'), true);
  assert.equal(argv.includes('预计坏账金额'), false);
  assert.equal(argv.includes('粉红色'), false);
});

test('processSpecialistRunner uses the SDK client to create and prompt a session', async () => {
  // Given: an injected fake opencode client.
  const created = [];
  const prompted = [];
  const client = {
    createSession: async ({ title, agent }) => { created.push({ title, agent }); return 'ses_spec'; },
    prompt: async ({ sessionId, agent, parts, format }) => {
      prompted.push({ sessionId, agent, parts, format });
      return { kind: 'ok', result: { text: '{"specialist":"guardian-code","hypotheses":[],"evidence":[],"unresolved_facts":[],"acceptance_criteria":[]}' } };
    },
    abort: async () => {},
    getSession: async () => ({ kind: 'ok', session: { id: 'ses_spec', agent: 'guardian-code' } }),
  };

  // When: a specialist runs through the SDK path.
  const { processSpecialistRunner } = await import('../../tools/guardian/investigation-process.mjs');
  const result = await processSpecialistRunner({
    role: 'guardian-code',
    issue: 211,
    issueDataPath: 'D:/repo/.qa/guardian/211/issue-data.json',
    repoDir: 'D:/repo',
    dossierPath: 'D:/repo/.qa/guardian/211/dossier.json',
    timeout_ms: 1000,
    opencodeClient: client,
  });

  // Then: one session is created, prompted with json_schema, and structured JSON is returned.
  assert.equal(created.length, 1);
  assert.equal(created[0].agent, 'guardian-code');
  assert.equal(prompted.length, 1);
  assert.equal(prompted[0].sessionId, 'ses_spec');
  assert.equal(prompted[0].agent, 'guardian-code');
  assert.equal(prompted[0].format.type, 'json_schema');
  assert.equal(result.specialist, 'guardian-code');
});

test('runAgentJson reports malformed event lines without treating them as final output', async () => {
  // Given: one malformed progress line followed by a valid text result.
  const child = fakeChild();
  const progress = [];
  const spawnImpl = () => {
    queueMicrotask(() => {
      child.stdout.write('not-json\n');
      child.stdout.write(`${JSON.stringify({
        type: 'text',
        part: { text: '{"specialist":"guardian-runtime","hypotheses":[],"evidence":[],"unresolved_facts":[],"acceptance_criteria":[]}' },
      })}\n`);
      child.emit('close', 0);
    });
    return child;
  };

  // When: the adapter parses the stream.
  const result = await runAgentJson({
    agent: 'guardian-runtime',
    repoDir: 'D:/repo',
    prompt: 'issue data',
    timeoutMs: 1000,
    spawnImpl,
    progressSink: (line) => progress.push(line),
  });

  // Then: malformed progress is visible and the valid final text still resolves.
  assert.equal(progress.some((line) => line.includes('unparsed event')), true);
  assert.equal(result.specialist, 'guardian-runtime');
});

test('createProgressSink mirrors progress to scheduler output and the agent log', () => {
  // Given: a progress directory and an observable scheduler sink.
  const root = mkdtempSync(path.join(tmpdir(), 'guardian-progress-'));
  const schedulerLines = [];
  try {
    const sink = createProgressSink({
      agent: 'guardian-code',
      progressDir: root,
      schedulerSink: (line) => schedulerLines.push(line),
    });

    // When: one real progress line is emitted.
    sink('[guardian-code] tool: grep badDebtReserves');

    // Then: scheduler and the dedicated agent log observe the same line.
    assert.deepEqual(schedulerLines, ['[guardian-code] tool: grep badDebtReserves']);
    assert.equal(readFileSync(path.join(root, 'guardian-code.log'), 'utf8'), '[guardian-code] tool: grep badDebtReserves\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
