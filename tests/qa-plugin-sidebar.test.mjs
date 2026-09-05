import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSidebarView,
  formatHeaderLines,
  formatRowLines,
  resolveSidebarRows,
  stripProviderPrefix,
} from '../packages/qa-opencode-plugin/dist/tui.js';

test('sidebar helper preserves configured ordering and strips only provider prefix in compact mode', () => {
  const rows = resolveSidebarRows({
    qaConfig: {
      compactSidebar: true,
      sidebar: { agents: ['qa', 'qa-cr', 'qa-e2e', 'guardian-code'] },
      presets: { team: { qa: { model: 'cpa/gpt-5.5' }, 'qa-cr': { model: 'openrouter/anthropic/claude' }, 'qa-e2e': { model: 'solo-model' }, 'guardian-code': { model: 'cpa/guard', variant: 'fast' } } },
      preset: 'team',
    },
    agents: {
      qa: { model: 'cpa/gpt-5.5' },
      'qa-cr': { model: 'openrouter/anthropic/claude' },
      'qa-e2e': { model: 'solo-model' },
      'guardian-code': { model: 'cpa/guard', variant: 'fast' },
    },
  });

  assert.deepEqual(rows.map((row) => row.agentName), ['qa', 'qa-cr', 'qa-e2e', 'guardian-code']);
  assert.equal(rows[0].model, 'gpt-5.5');
  assert.equal(rows[1].model, 'anthropic/claude');
  assert.equal(rows[2].model, 'solo-model');
  assert.equal(rows[3].variant, 'fast');
  assert.equal(stripProviderPrefix('cpa/gpt-5.5'), 'gpt-5.5');
});

test('sidebar helper retains full model in non-compact mode and omits missing rows', () => {
  const rows = resolveSidebarRows({
    qaConfig: {
      compactSidebar: false,
      sidebar: { agents: ['qa', 'qa-cr', 'qa-e2e', 'guardian-docs'] },
      preset: 'default',
      presets: { default: { qa: { model: 'cpa/gpt-5.5', variant: 'review' }, 'qa-cr': { model: 'cpa/gpt-5.4' } } },
    },
    agents: {
      qa: { model: 'cpa/gpt-5.5', variant: 'review' },
      'qa-cr': { model: 'cpa/gpt-5.4' },
      'qa-e2e': {},
    },
  });

  assert.deepEqual(rows.map((row) => row.agentName), ['qa', 'qa-cr']);
  assert.equal(rows[0].model, 'cpa/gpt-5.5');
  assert.equal(rows[0].variant, 'review');
});

test('sidebar formatting wraps and truncates deterministically for narrow widths', () => {
  const lines = formatRowLines({ agentName: 'guardian-runtime', model: 'anthropic/claude-sonnet-4', variant: 'deep-review' }, 12);
  assert.deepEqual(lines.map((line) => line.segments.map((segment) => segment.text).join('')), [
    'guardian-ru…',
    '· anthropic…',
    'variant: de…',
  ]);
});

test('header formatting aligns when it fits and stacks when it does not', () => {
  assert.deepEqual(formatHeaderLines('QA-Agents', 'v0.1.0', 20).map((line) => line.segments.map((segment) => segment.text).join('')), ['QA-Agents     v0.1.0']);
  assert.deepEqual(formatHeaderLines('QA-Agents', 'v0.1.0', 8).map((line) => line.segments.map((segment) => segment.text).join('')), ['QA-Agen…', 'v0.1.0']);
});

test('buildSidebarView exposes empty state when no effective QA agents are loaded', () => {
  const view = buildSidebarView({
    qaConfig: { compactSidebar: true, preset: 'default', presets: { default: { qa: null } } },
    agents: {},
    width: 18,
    version: '0.1.0',
  });

  assert.equal(view.rows.length, 0);
  assert.equal(view.emptyLabel.segments[0].text, 'No QA agents loaded');
});

test('known-empty agent registry does not backfill default preset rows', () => {
  const view = buildSidebarView({
    qaConfig: { compactSidebar: true, preset: 'default', presets: { default: { qa: { model: 'cpa/gpt-5.6-sol' }, 'qa-cr': { model: 'cpa/gpt-5.5' }, 'qa-e2e': { model: 'cpa/gpt-5.5' } } } },
    agents: {},
    width: 24,
    version: '0.1.0',
  });

  assert.equal(view.rows.length, 0);
  assert.equal(view.emptyLabel.segments[0].text, 'No QA agents loaded');
});
