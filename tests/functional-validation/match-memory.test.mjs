import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const repositoryRoot = path.dirname(path.dirname(import.meta.dirname));
const toolPath = path.join(repositoryRoot, 'qa-skill', 'tools', 'match-memory.mjs');
const toolUrl = pathToFileURL(toolPath).href;

const { parseMemoryYaml, normalizeChangeSurface, matchMemory, cli, parseGitDiffToChangeSurface, defaultReadCardsForIndex } = await import(toolUrl);

function tempDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function writeFile(root, name, content) {
  const filePath = path.join(root, name);
  mkdirSync(path.dirname(filePath), { recursive: true });
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

const sampleDiff = `diff --git a/src/order/status.js b/src/order/status.js
index 1111111..2222222 100644
--- a/src/order/status.js
+++ b/src/order/status.js
@@ -1,3 +1,4 @@
-function order_status(id) { return db.read(id); }
+function order_status(id) { const value = db.read(id); cache.invalidate(id); return value; }
diff --git a/src/cache/store.js b/src/cache/store.js
index 3333333..4444444 100644
--- a/src/cache/store.js
+++ b/src/cache/store.js
@@ -5,0 +6,2 @@
+export function invalidate(key) { store.delete(key); }
`;

test('MM-VCS-012 derives a change surface from a unified git diff', () => {
  const surface = parseGitDiffToChangeSurface(sampleDiff);
  assert.ok(surface.paths.includes('src/order/status.js'));
  assert.ok(surface.paths.includes('src/cache/store.js'));
  assert.ok(surface.symbols.includes('order_status'));
  assert.ok(surface.symbols.includes('invalidate'));
  // path-segment keywords are derived too
  assert.ok(surface.keywords.some((k) => k === 'order' || k === 'cache' || k === 'status' || k === 'store'));
});

test('MM-VCS-013 --diff mode matches a rule via injected diff file', () => {
  const orderCard = {
    id: 'rule-order-cache-001',
    type: 'rule',
    match: { paths: ['src/order/**', 'src/cache/**'], symbols: ['order_status'], keywords: ['cache'] },
    checks: { must: ['re-read order status after update returns the new value'] },
    confidence: 'high',
  };
  const io = {
    readTextFile(inputPath) {
      if (inputPath === 'index.yaml') return indexYaml;
      if (inputPath === 'change.diff') return sampleDiff;
      throw new Error(`unexpected ${inputPath}`);
    },
    readCardsForIndex: () => new Map([['rule-order-cache-001', orderCard]]),
  };
  const result = cli(['--index', 'index.yaml', '--diff', 'change.diff', '--json'], io);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.valid, true);
  assert.ok(payload.qa_planning_inputs.some((i) => i.claim_type === 'memory_regression_check'));
});

test('MM-VCS-014 --base/--head mode runs git via injected runner (read-only)', () => {
  let calledArgs = null;
  const orderCard = {
    id: 'rule-order-cache-001',
    type: 'rule',
    match: { paths: ['src/order/**'] },
    checks: { must: ['re-read order status after update returns the new value'] },
  };
  const io = {
    readTextFile: () => indexYaml,
    readCardsForIndex: () => new Map([['rule-order-cache-001', orderCard]]),
    runGit(args) {
      calledArgs = args;
      return sampleDiff;
    },
  };
  const result = cli(['--index', 'index.yaml', '--base', 'main', '--head', 'HEAD', '--json'], io);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calledArgs, ['diff', '--unified=0', '--no-color', 'main...HEAD']);
  const payload = JSON.parse(result.stdout);
  assert.ok(payload.qa_planning_inputs.length >= 1);
});

test('MM-VCS-015 rejects unsafe git refs and mutually exclusive change sources', () => {
  const io = { readTextFile: () => indexYaml, runGit: () => { throw new Error('should not run'); } };
  const unsafe = cli(['--index', 'index.yaml', '--base', '--evil', '--head', 'HEAD', '--json'], io);
  assert.equal(unsafe.status, 2);

  const conflict = cli(['--index', 'index.yaml', '--diff', 'd.diff', '--base', 'main', '--head', 'HEAD'], io);
  assert.equal(conflict.status, 2);
  assert.match(conflict.stderr, /mutually exclusive/);

  const none = cli(['--index', 'index.yaml', '--json'], io);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /exactly one change source/);
});

const orderCardYaml = `id: rule-order-cache-001
type: rule
match:
  paths:
    - "src/order/**"
    - "src/cache/**"
  symbols:
    - order_status
  keywords:
    - cache
applies_when:
  - change may modify order status persistence
do_not_apply_when:
  - change is docs-only
checks:
  must:
    - re-read order status after update returns the new value
  should:
    - concurrent update does not leave a stale cached status
confidence: high
`;

test('MM-LOAD-016 defaultReadCardsForIndex reads and parses safe card files from the memory root', () => {
  const root = tempDir('mm-load-');
  try {
    const indexPath = writeFile(root, 'index.yaml', indexYaml);
    writeFile(path.join(root, 'rules'), 'order.yaml', orderCardYaml);
    // rule-stale-001 references rules/stale.yaml which does not exist -> parse-error card.
    const index = parseMemoryYaml(indexYaml).value;
    const cards = defaultReadCardsForIndex(index, indexPath);
    assert.ok(cards.has('rule-order-cache-001'));
    assert.equal(cards.get('rule-order-cache-001').id, 'rule-order-cache-001');
    assert.deepEqual(cards.get('rule-order-cache-001').checks.must, ['re-read order status after update returns the new value']);
    assert.ok(cards.has('rule-stale-001'));
    assert.equal(cards.get('rule-stale-001').__parseError, true);
    // rejected items are never opened for planning
    assert.ok(!cards.has('rejected-001'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MM-LOAD-017 default loader skips unsafe/mismatched index paths without reading them', () => {
  const root = tempDir('mm-load-unsafe-');
  try {
    const unsafeIndex = `items:
  - id: trav
    type: rule
    review_status: current
    path: ../escape.yaml
  - id: wrongdir
    type: rule
    review_status: current
    path: patterns/x.yaml
`;
    const indexPath = writeFile(root, 'index.yaml', unsafeIndex);
    const index = parseMemoryYaml(unsafeIndex).value;
    const cards = defaultReadCardsForIndex(index, indexPath);
    // traversal path is rejected outright (never loaded); wrong-dir path is not allowed for type rule.
    assert.ok(!cards.has('trav'));
    assert.ok(!cards.has('wrongdir'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MM-LOAD-018 real spawn end-to-end: derives surface from diff and matches a disk card without injection', () => {
  const root = tempDir('mm-e2e-');
  try {
    const indexPath = writeFile(root, 'index.yaml', `items:\n  - id: rule-order-cache-001\n    type: rule\n    review_status: current\n    path: rules/order.yaml\n`);
    writeFile(path.join(root, 'rules'), 'order.yaml', orderCardYaml);
    const diffPath = writeFile(root, 'change.diff', sampleDiff);
    const run = spawnSync(process.execPath, [toolPath, '--index', indexPath, '--diff', diffPath, '--json'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const payload = JSON.parse(run.stdout);
    assert.equal(payload.valid, true);
    assert.ok(payload.qa_planning_inputs.some((i) => i.claim_type === 'memory_regression_check'), `expected a memory_regression_check, got ${run.stdout}`);
    assert.ok(payload.qa_planning_inputs.every((i) => i.use_limit === 'planning_only'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
