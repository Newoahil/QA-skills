import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGate1Comment } from '../../tools/guardian/gate1-comment.mjs';

test('gate1 comment carries marker, plan summary, unresolved facts, and commands', () => {
  const body = buildGate1Comment({
    issue: 211,
    plan: { risk: 'LOW', root_cause: 'color', affected_files: ['a.jsx'] },
    dossier: { unresolved_facts: ['exact pink token?'] },
    planHash: 'sha256:plan-a',
    planRevision: 'inv-a',
  });
  assert.equal(body.split('\n')[0], '[GATE_1_WAIT]');
  assert.equal(body.includes('/guardian approve'), true);
  assert.equal(body.includes('/guardian revise'), true);
  assert.equal(body.includes('/guardian reject'), true);
  assert.equal(body.includes('exact pink token?'), true);
  assert.equal(body.includes('plan_hash: sha256:plan-a'), true);
  assert.equal(body.includes('plan_revision: inv-a'), true);
});

test('gate1 comment renders structured plan and dossier fields without object placeholders', () => {
  const body = buildGate1Comment({
    issue: 205,
    plan: {
      risk: { level: 'HIGH', reason: 'oracle missing' },
      root_cause: { summary: '分类列表空状态文案缺少明确预期', evidence: ['issue body underspecified'] },
      affected_files: [{ path: 'src/pages/category/index.tsx', reason: 'empty state copy' }],
    },
    dossier: {
      unresolved_facts: [
        { question: '期望空状态文案是什么？', source: 'issue #205' },
        { question: '影响环境是什么？', source: 'issue #205' },
      ],
    },
    planHash: 'sha256:plan-205',
    planRevision: 'rev-205',
  });

  assert.doesNotMatch(body, /\[object Object\]/);
  assert.match(body, /风险: HIGH/);
  assert.match(body, /oracle missing/);
  assert.match(body, /分类列表空状态文案缺少明确预期/);
  assert.match(body, /src\/pages\/category\/index\.tsx/);
  assert.match(body, /期望空状态文案是什么/);
  assert.match(body, /影响环境是什么/);
});
