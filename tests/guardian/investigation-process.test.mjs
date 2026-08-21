import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { createProgressSink, guardianDirFromDossierPath, issueProgressDir, processSpecialistRunner, runAgentJson } from '../../tools/guardian/investigation-process.mjs';

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

test('runAgentJson with no timeout (0) never installs a killer and an abort signal kills the child', async () => {
  const child = fakeChild();
  let killed = false;
  child.kill = () => { killed = true; child.emit('close', 137); };
  const controller = new AbortController();
  const spawnImpl = () => child;
  const pending = runAgentJson({
    agent: 'guardian-code',
    repoDir: 'D:/repo',
    prompt: 'issue data',
    timeoutMs: 0, // unlimited: no forced kill
    spawnImpl,
    signal: controller.signal,
    progressSink: () => {},
  });
  // The child never finishes on its own; only the abort ends it.
  controller.abort();
  await assert.rejects(pending);
  assert.equal(killed, true);
});

test('processSpecialistRunner stamps duration and failed status on the session even when the run fails', async () => {
  const child = fakeChild();
  const spawnImpl = () => {
    queueMicrotask(() => child.emit('close', 1)); // non-zero exit → failure
    return child;
  };
  const state = { opencode: { schema_version: 1, specialists: {} } };
  await assert.rejects(() => processSpecialistRunner({
    role: 'guardian-code',
    issue: 205,
    issueDataPath: 'D:/ctrl/.qa/guardian/205/issue-data.json',
    qaRuntimeDir: 'D:/qa',
    dossierPath: 'D:/ctrl/.qa/guardian/205/dossier.json',
    timeout_ms: 0,
    spawnImpl,
    state,
    round: 1,
  }));
  const record = state.opencode.specialists['guardian-code'];
  assert.equal(record.last_status, 'failed');
  assert.equal(typeof record.duration_ms, 'number');
  assert.equal(record.role, 'guardian-code');
  assert.equal(record.issue, 205);
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
  assert.deepEqual(prompted[0].format.schema.properties.evidence.items.required, [
    'id', 'kind', 'source', 'observation', 'supports', 'contradicts',
  ]);
  assert.equal(result.specialist, 'guardian-code');
});

test('processSpecialistRunner uses QA runtime path while preserving control state path metadata', async () => {
  const created = [];
  const client = {
    createSession: async ({ directory }) => { created.push(directory); return 'ses_runtime'; },
    prompt: async () => ({ kind: 'ok', result: { text: '{"specialist":"guardian-runtime","hypotheses":[],"evidence":[],"unresolved_facts":[],"acceptance_criteria":[]}' } }),
    getSession: async () => ({ kind: 'ok', session: { id: 'ses_runtime', agent: 'guardian-runtime', directory: 'D:/qa-snapshot' } }),
  };
  const state = { opencode: { specialists: {} } };
  await processSpecialistRunner({ role: 'guardian-runtime', issue: 1, repoDir: 'D:/control', qaRuntimeDir: 'D:/qa-snapshot', issueDataPath: 'D:/control/issue.json', dossierPath: 'D:/control/dossier.json', opencodeClient: client, state });
  assert.deepEqual(created, ['D:/qa-snapshot']);
  assert.equal(state.opencode.specialists['guardian-runtime'].repo_dir, 'D:/qa-snapshot');
});

test('processSpecialistRunner reports SDK prompt response shape on empty text JSON failure', async () => {
  const client = {
    createSession: async () => 'ses_empty',
    prompt: async () => ({ kind: 'ok', result: { text: '', structured: null, prompt_response: { parts_count: 0, text_bytes: 0, has_structured: false, has_structured_output: false } } }),
    getSession: async () => ({ kind: 'ok', session: { id: 'ses_empty', agent: 'guardian-history' } }),
  };
  const failure = await processSpecialistRunner({
    role: 'guardian-history',
    issue: 205,
    issueDataPath: 'D:/repo/.qa/guardian/205/issue-data.json',
    repoDir: 'D:/repo',
    dossierPath: 'D:/repo/.qa/guardian/205/dossier.json',
    opencodeClient: client,
  }).then(
    () => null,
    (error) => error,
  );

  assert.ok(failure instanceof Error);
  assert.equal(failure.name, 'InvestigationJsonParseError');
  assert.equal(failure.role, 'guardian-history');
  assert.deepEqual(failure.prompt_response, {
    parts_count: 0,
    text_bytes: 0,
    has_structured: false,
    has_structured_output: false,
  });
});

test('processSpecialistRunner aborts and fails when the prompt exceeds the deadline', async () => {
  let aborted = false;
  const client = {
    createSession: async () => 'ses_dl',
    // prompt never resolves on its own — only the deadline can end it.
    prompt: () => new Promise(() => {}),
    abort: async () => { aborted = true; },
    getSession: async () => ({ kind: 'ok', session: { id: 'ses_dl', agent: 'guardian-code' } }),
  };
  const state = { opencode: { specialists: {} } };
  const failure = await processSpecialistRunner({
    role: 'guardian-code',
    issue: 205,
    issueDataPath: 'D:/repo/.qa/guardian/205/issue-data.json',
    repoDir: 'D:/repo',
    dossierPath: 'D:/repo/.qa/guardian/205/dossier.json',
    opencodeClient: client,
    state,
    deadlineMs: 50,
  }).then(() => null, (e) => e);
  assert.ok(failure instanceof Error, 'should reject on deadline');
  assert.match(failure.message, /timed out|deadline/i);
  assert.equal(aborted, true, 'should abort the session on deadline');
  assert.equal(state.opencode.specialists['guardian-code'].last_status, 'failed');
});

test('processSpecialistRunner forwards the configured per-role model to the prompt', async () => {
  const seen = [];
  const client = {
    createSession: async () => 'ses_m',
    prompt: async ({ model }) => { seen.push(model); return { kind: 'ok', result: { text: '{"specialist":"guardian-code","hypotheses":[],"evidence":[],"unresolved_facts":[],"acceptance_criteria":[]}' } }; },
    getSession: async () => ({ kind: 'ok', session: { id: 'ses_m', agent: 'guardian-code' } }),
  };
  await processSpecialistRunner({
    role: 'guardian-code',
    issue: 205,
    issueDataPath: 'D:/repo/.qa/guardian/205/issue-data.json',
    repoDir: 'D:/repo',
    dossierPath: 'D:/repo/.qa/guardian/205/dossier.json',
    opencodeClient: client,
    model: 'openai/gpt-x',
  });
  assert.equal(seen[0], 'openai/gpt-x');
});

test('processSpecialistRunner forwards fallback models to the prompt', async () => {
  const seen = [];
  const client = {
    createSession: async () => 'ses_fb',
    prompt: async ({ fallbackModels }) => { seen.push(fallbackModels); return { kind: 'ok', result: { text: '{"specialist":"guardian-code","hypotheses":[],"evidence":[],"unresolved_facts":[],"acceptance_criteria":[]}' } }; },
    getSession: async () => ({ kind: 'ok', session: { id: 'ses_fb', agent: 'guardian-code' } }),
  };
  await processSpecialistRunner({
    role: 'guardian-code',
    issue: 205,
    issueDataPath: 'D:/repo/.qa/guardian/205/issue-data.json',
    repoDir: 'D:/repo',
    dossierPath: 'D:/repo/.qa/guardian/205/dossier.json',
    opencodeClient: client,
    fallbackModels: ['cpa/gpt-5.4'],
  });
  assert.deepEqual(seen[0], ['cpa/gpt-5.4']);
});

test('processSpecialistRunner reports provider errors instead of parsing empty JSON', async () => {
  const client = {
    createSession: async () => 'ses_cooldown',
    prompt: async () => ({ kind: 'provider-error', error: { name: 'APIError', statusCode: 429, message: 'model_cooldown: provider cooling down', code: 'model_cooldown' } }),
    getSession: async () => ({ kind: 'ok', session: { id: 'ses_cooldown', agent: 'guardian-runtime' } }),
  };
  const state = { opencode: { specialists: {} } };
  const failure = await processSpecialistRunner({
    role: 'guardian-runtime',
    issue: 205,
    issueDataPath: 'D:/repo/.qa/guardian/205/issue-data.json',
    repoDir: 'D:/repo',
    dossierPath: 'D:/repo/.qa/guardian/205/dossier.json',
    opencodeClient: client,
    state,
  }).then(
    () => null,
    (error) => error,
  );

  assert.ok(failure instanceof Error);
  assert.match(failure.message, /prompt failed/);
  assert.match(failure.message, /model_cooldown/);
  assert.doesNotMatch(failure.message, /Unexpected end of JSON input/);
  assert.equal(state.opencode.specialists['guardian-runtime'].last_status, 'failed');
  assert.match(state.opencode.specialists['guardian-runtime'].last_error, /model_cooldown/);
});

test('processPlanBuilder uses the SDK client instead of spawning an attach process', async () => {
  // Given: an injected fake opencode client.
  const created = [];
  const prompted = [];
  const client = {
    createSession: async ({ title, agent, directory }) => { created.push({ title, agent, directory }); return 'ses_plan'; },
    prompt: async ({ sessionId, agent, parts, format }) => {
      prompted.push({ sessionId, agent, parts, format });
      return { kind: 'ok', result: { text: '{"root_cause":"color","affected_files":["a"],"non_goals":["b"],"test_plan":["t"],"acceptance_criteria":["c"],"rollback_plan":"r","evidence_ids":[],"risk":"LOW"}' } };
    },
    abort: async () => {},
    getSession: async () => ({ kind: 'ok', session: { id: 'ses_plan', agent: 'guardian-business' } }),
  };

  // When: a plan is built through the SDK path.
  const { processPlanBuilder } = await import('../../tools/guardian/investigation-process.mjs');
  const result = await processPlanBuilder({
    issue: 211,
    repoDir: 'D:/repo',
    dossier: { root_cause: 'color', evidence: [{ id: 'E1' }, { id: 'E2' }] },
    opencodeClient: client,
  });

  // Then: one session is created in the target dir and prompted with json_schema; no spawn.
  assert.equal(created.length, 1);
  assert.equal(created[0].agent, 'guardian-business');
  assert.equal(created[0].directory, 'D:/repo');
  assert.equal(prompted.length, 1);
  assert.equal(prompted[0].agent, 'guardian-business');
  assert.equal(prompted[0].format.type, 'json_schema');
  assert.deepEqual(prompted[0].format.schema.properties.risk.enum, ['LOW', 'HIGH']);
  assert.deepEqual(prompted[0].format.schema.properties.evidence_ids.items.enum, ['E1', 'E2']);
  assert.equal(result.root_cause, 'color');
});

test('processPlanBuilder reports provider errors instead of parsing empty JSON', async () => {
  const client = {
    createSession: async () => 'ses_plan_cooldown',
    prompt: async () => ({ kind: 'provider-error', error: { name: 'APIError', statusCode: 429, message: 'model_cooldown: provider cooling down', code: 'model_cooldown' } }),
  };
  const { processPlanBuilder } = await import('../../tools/guardian/investigation-process.mjs');
  const failure = await processPlanBuilder({
    issue: 205,
    repoDir: 'D:/repo',
    dossier: { evidence: [] },
    opencodeClient: client,
  }).then(
    () => null,
    (error) => error,
  );
  assert.ok(failure instanceof Error);
  assert.match(failure.message, /plan prompt failed/);
  assert.match(failure.message, /model_cooldown/);
  assert.doesNotMatch(failure.message, /Unexpected end of JSON input/);
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

test('runAgentJson reports final JSON parse context without leaking secrets', async () => {
  // Given: OpenCode emits truncated final JSON containing a token-looking value.
  const child = fakeChild();
  const spawnImpl = () => {
    queueMicrotask(() => {
      child.stdout.write(`${JSON.stringify({
        type: 'text',
        part: { text: '{"specialist":"guardian-runtime","token":"ghp_1234567890abcdef"' },
      })}\n`);
      child.emit('close', 0);
    });
    return child;
  };

  // When: the final JSON parser rejects the output.
  const failure = await runAgentJson({
    agent: 'guardian-runtime',
    repoDir: 'D:/repo',
    prompt: 'issue data',
    timeoutMs: 1000,
    spawnImpl,
    progressSink: () => {},
  }).then(
    () => null,
    (error) => error,
  );

  // Then: the error carries source metadata and a redacted bounded preview.
  assert.ok(failure instanceof Error);
  assert.equal(failure.name, 'InvestigationJsonParseError');
  assert.equal(failure.json_phase, 'specialist-final-json');
  assert.equal(failure.role, 'guardian-runtime');
  assert.equal(failure.json_source, 'full-text');
  assert.match(failure.parse_error_message, /Expected|Unexpected|JSON/);
  assert.equal(typeof failure.output_bytes, 'number');
  assert.match(failure.output_preview, /\[redacted\]/);
  assert.equal(failure.output_preview.includes('ghp_1234567890abcdef'), false);
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

test('issue progress dir matches the TUI reader path and derives from the dossier path', () => {
  const guardianDir = path.join('D:', 'ctrl', '.qa', 'guardian');
  // TUI reads <guardianDir>/progress/<issue>/<agent>.log — the writer must target the same layout.
  assert.equal(issueProgressDir({ guardianDir, issue: 205 }), path.join(guardianDir, 'progress', '205'));
  assert.equal(issueProgressDir({ guardianDir: null, issue: 205 }), null);
  assert.equal(issueProgressDir({ guardianDir, issue: null }), null);
  // dossierPath is <guardianDir>/<issue>/dossier.json → guardianDir recovered by dirname twice.
  const dossierPath = path.join(guardianDir, '205', 'dossier.json');
  assert.equal(guardianDirFromDossierPath(dossierPath), guardianDir);
  assert.equal(guardianDirFromDossierPath(null), null);
});
