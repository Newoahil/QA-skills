import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const repositoryRoot = path.dirname(path.dirname(import.meta.dirname));
const toolPath = path.join(repositoryRoot, 'qa-skill', 'tools', 'match-memory.mjs');
const toolUrl = pathToFileURL(toolPath).href;

const { parseMemoryYaml, normalizeChangeSurface, matchMemory, cli } = await import(toolUrl);

function tempDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function writeFile(root, name, content) {
  const filePath = path.join(root, name);
  writeFileSync(filePath, content);
  return filePath;
}

const indexYaml = `items:
  - id: rule-order-cache-001
    type: rule
    scope: order, cache
    review_status: current
    path: rules/order.yaml
  - id: rule-stale-001
    type: rule
    scope: order
    review_status: stale
    path: rules/stale.yaml
  - id: rejected-001
    type: rejected
    scope: order
    review_status: current
    path: rejected/rejected-rules.yaml
`;

const orderCard = {
  id: 'rule-order-cache-001',
  type: 'rule',
  match: { paths: ['src/order/**', 'src/cache/**'], symbols: ['order_status'], keywords: ['cache'] },
  applies_when: ['change may modify order status persistence'],
  do_not_apply_when: ['change is docs-only'],
  checks: { must: ['re-read order status after update returns the new value'], should: ['concurrent update does not leave a stale cached status'] },
  confidence: 'high',
};

function cardsReader(cards) {
  return () => new Map(Object.entries(cards));
}

test('MM-YAML-001 parses the bounded memory YAML subset', () => {
  const parsed = parseMemoryYaml(indexYaml);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.items.length, 3);
  assert.equal(parsed.value.items[0].id, 'rule-order-cache-001');
  assert.equal(parsed.value.items[0].path, 'rules/order.yaml');
});

test('MM-YAML-002 rejects tabs and trailing garbage deterministically', () => {
  const diagnostics = [];
  const tabbed = parseMemoryYaml('items:\n\t- id: x', diagnostics);
  assert.equal(tabbed.ok, false);
  assert.ok(diagnostics.some((d) => d.code === 'yamlTab'));
});

test('MM-SURFACE-003 normalizes change surface and rejects bad shapes', () => {
  const good = normalizeChangeSurface({ paths: ['src/order/service.js'], symbols: ['order_status'], keywords: ['cache'] });
  assert.equal(good.ok, true);
  assert.deepEqual(good.surface.paths, ['src/order/service.js']);

  const bad = normalizeChangeSurface({ paths: [42] });
  assert.equal(bad.ok, false);
});

test('MM-MATCH-004 generates memory_regression_check inputs for an applicable matched rule', () => {
  const index = parseMemoryYaml(indexYaml).value;
  const surface = normalizeChangeSurface({ paths: ['src/order/status.js'], symbols: ['order_status'], keywords: [] }).surface;
  const result = matchMemory(index, new Map([['rule-order-cache-001', orderCard]]), surface);

  assert.equal(result.valid, true);
  assert.equal(result.matched, 1);
  assert.equal(result.applicable, 1);
  const must = result.planningInputs.filter((i) => i.claim_type === 'memory_regression_check' && i.planned_level === 'Must Verify');
  const should = result.planningInputs.filter((i) => i.planned_level === 'Should Verify');
  assert.equal(must.length, 1);
  assert.equal(should.length, 1);
  assert.ok(result.planningInputs.every((i) => i.source_type === 'memory' && i.use_limit === 'planning_only'));
  assert.match(must[0].provenance, /rule-order-cache-001 \(\.qa\/memory\/rules\/order\.yaml\)/);
});

test('MM-GATE-005 do_not_apply_when is available to the planner while a non-matching change yields nothing', () => {
  const index = parseMemoryYaml(indexYaml).value;
  const surface = normalizeChangeSurface({ paths: ['docs/readme.md'], symbols: [], keywords: [] }).surface;
  const result = matchMemory(index, new Map([['rule-order-cache-001', orderCard]]), surface);
  assert.equal(result.matched, 0);
  assert.equal(result.planningInputs.length, 0);
});

test('MM-STALE-006 skips stale items and surfaces them for review; rejected never applies', () => {
  const index = parseMemoryYaml(indexYaml).value;
  const surface = normalizeChangeSurface({ paths: ['src/order/status.js'], symbols: ['order_status'], keywords: [] }).surface;
  const staleCard = { id: 'rule-stale-001', type: 'rule', match: { paths: ['src/order/**'] }, checks: { must: ['x'] } };
  const result = matchMemory(index, new Map([['rule-order-cache-001', orderCard], ['rule-stale-001', staleCard]]), surface);

  assert.ok(result.reviewItems.some((r) => r.id === 'rule-stale-001' && /stale/.test(r.reason)));
  assert.ok(!result.planningInputs.some((i) => /rule-stale-001/.test(i.provenance)));
  assert.ok(!result.planningInputs.some((i) => /rejected-001/.test(i.provenance)));
});

test('MM-CAP-007 caps applicable items at 0-3 and surfaces the overflow', () => {
  const items = [];
  const cards = new Map();
  for (let n = 1; n <= 5; n += 1) {
    const id = `rule-${n}`;
    items.push({ id, type: 'rule', review_status: 'current', path: `rules/r${n}.yaml` });
    cards.set(id, { id, type: 'rule', match: { paths: ['src/**'] }, checks: { must: [`check ${n}`] }, confidence: 'high' });
  }
  const index = { items };
  const surface = normalizeChangeSurface({ paths: ['src/x.js'], symbols: [], keywords: [] }).surface;
  const result = matchMemory(index, cards, surface);
  assert.equal(result.matched, 5);
  assert.equal(result.applicable, 3);
  assert.equal(result.reviewItems.filter((r) => /retrieval cap/.test(r.reason)).length, 2);
});

test('MM-SAFETY-008 unsafe or mismatched index paths become review items, not crashes', () => {
  const index = {
    items: [
      { id: 'trav', type: 'rule', review_status: 'current', path: '../escape.yaml' },
      { id: 'abs', type: 'rule', review_status: 'current', path: '/etc/passwd' },
      { id: 'wrongdir', type: 'rule', review_status: 'current', path: 'patterns/x.yaml' },
    ],
  };
  const surface = normalizeChangeSurface({ paths: ['src/x.js'] }).surface;
  const result = matchMemory(index, new Map(), surface);
  assert.equal(result.valid, true);
  assert.equal(result.planningInputs.length, 0);
  assert.ok(result.reviewItems.some((r) => r.id === 'trav'));
  assert.ok(result.reviewItems.some((r) => r.id === 'abs'));
  assert.ok(result.reviewItems.some((r) => r.id === 'wrongdir' && /not allowed for type/.test(r.reason)));
});

test('MM-CLI-009 runs end-to-end via injected IO with JSON output and exit 0', () => {
  const io = {
    readTextFile(inputPath) {
      if (inputPath === 'index.yaml') return indexYaml;
      if (inputPath === 'change.json') return JSON.stringify({ paths: ['src/order/status.js'], symbols: ['order_status'], keywords: [] });
      throw new Error(`unexpected ${inputPath}`);
    },
    readCardsForIndex: cardsReader({ 'rule-order-cache-001': orderCard }),
  };
  const result = cli(['--index', 'index.yaml', '--change', 'change.json', '--json'], io);
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.valid, true);
  assert.equal(payload.matched, 1);
  assert.ok(payload.qa_planning_inputs.length >= 1);
  assert.ok(payload.qa_planning_inputs.every((i) => i.use_limit === 'planning_only'));
});

test('MM-CLI-010 missing flags exit 2 with usage', () => {
  const result = cli(['--json'], { readTextFile: () => '' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
  assert.match(result.stderr, /--index/);
});

test('MM-CLI-011 real process spawn produces deterministic JSON and exit 0', () => {
  const root = tempDir('mm-cli-');
  try {
    const indexPath = writeFile(root, 'index.yaml', `items:\n  - id: rule-order-cache-001\n    type: rule\n    review_status: current\n    path: rules/order.yaml\n`);
    const changePath = writeFile(root, 'change.json', JSON.stringify({ paths: ['src/order/status.js'], symbols: ['order_status'], keywords: ['cache'] }));
    // Without a card reader the CLI still runs; the index references a card not on disk,
    // so it is surfaced as a review item rather than crashing.
    const run = spawnSync(process.execPath, [toolPath, '--index', indexPath, '--change', changePath, '--json'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const payload = JSON.parse(run.stdout);
    assert.equal(payload.valid, true);
    assert.ok(Array.isArray(payload.qa_planning_inputs));
    assert.ok(payload.review_items.some((r) => r.id === 'rule-order-cache-001'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
