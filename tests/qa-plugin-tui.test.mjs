import assert from 'node:assert/strict';
import test from 'node:test';

import pluginModule, { createQaSkillTuiPlugin } from '../packages/qa-opencode-plugin/dist/tui.js';

function createFakeSolid() {
  return {
    createElement: (tag) => ({ tag, props: {}, children: [] }),
    insert: (parent, child) => parent.children.push(child),
    setProp: (node, name, value) => { node.props[name] = value; },
  };
}

const THEME = { accent: 'accent-color', textMuted: 'muted-color', text: 'text-color', borderActive: 'border-active-color' };

function collectText(node, out = []) {
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (node && Array.isArray(node.children)) {
    for (const child of node.children) collectText(child, out);
  }
  return out;
}

function createFakeCore() {
  return {
    parseColor: (input) => {
      if (input && typeof input === 'object' && 'r' in input && 'g' in input && 'b' in input) return input;
      throw new Error('fake core only parses RGBA-shaped accents');
    },
    RGBA: {
      fromInts: (r, g, b, a = 255) => ({ r: r / 255, g: g / 255, b: b / 255, a: a / 255 }),
    },
  };
}

function getTitleTextNode(root) {
  const header = root.children[0];
  const titleBadge = header.children[0];
  return titleBadge.children[0];
}

async function renderTree(configOverrides, agentOverrides, overrides = {}) {
  let requested = 0;
  const registrations = [];
  const plugin = createQaSkillTuiPlugin({
    loadConfig: () => ({ config: configOverrides }),
    importSolid: async () => createFakeSolid(),
    importCore: overrides.importCore ?? (async () => null),
  });

  await plugin({
    state: { path: { directory: 'C:/repo' }, config: { agent: agentOverrides } },
    theme: { current: overrides.theme ?? THEME },
    renderer: { requestRender: () => { requested += 1; } },
    slots: { register: (registration) => registrations.push(registration) },
  }, undefined, { version: '1.2.3' });

  return { root: registrations[0].slots.sidebar_content(), requested, registrations };
}

const DEFAULT_QA_CONFIG = { compactSidebar: true, preset: 'default', presets: { default: { qa: { model: 'cpa/gpt-5.5' } } } };
const DEFAULT_QA_AGENTS = { qa: { model: 'cpa/gpt-5.5' } };

test('tui plugin registers native sidebar_content slot at order 900', async () => {
  const { registrations, requested } = await renderTree(
    { compactSidebar: true, preset: 'default', presets: { default: { qa: { model: 'cpa/gpt-5.5' } } } },
    { qa: { model: 'cpa/gpt-5.5' } },
  );

  assert.equal(pluginModule.id, 'qa-skill:tui');
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].order, 900);
  assert.equal(typeof registrations[0].slots.sidebar_content, 'function');
  assert.equal(requested, 1);
});

test('root panel keeps the accepted borderless padding and header layout', async () => {
  const { root } = await renderTree(
    { compactSidebar: true, preset: 'default', presets: { default: { qa: { model: 'cpa/gpt-5.5' } } } },
    { qa: { model: 'cpa/gpt-5.5' } },
  );

  assert.equal(root.tag, 'box');
  assert.equal('border' in root.props, false);
  assert.equal('borderColor' in root.props, false);
  assert.equal(root.props.paddingTop, 1);
  assert.equal(root.props.paddingBottom, 1);
  assert.equal(root.props.paddingLeft, 1);
  assert.equal(root.props.paddingRight, 1);

  const [header, headingWrapper] = root.children;
  assert.equal(header.tag, 'box');
  assert.equal(header.props.flexDirection, 'row');
  assert.equal(header.props.justifyContent, 'space-between');
  assert.equal(header.props.alignItems, 'center');

  const [titleBadge, versionText] = header.children;
  assert.equal(titleBadge.tag, 'box');
  assert.equal(titleBadge.props.paddingLeft, 1);
  assert.equal(titleBadge.props.paddingRight, 1);
  assert.equal(titleBadge.props.backgroundColor, THEME.accent);
  const titleText = titleBadge.children[0];
  assert.equal(titleText.tag, 'text');
  assert.equal(titleText.props.fg, THEME.text);
  assert.deepEqual(collectText(titleText), ['QA-Agents']);

  assert.equal(versionText.tag, 'text');
  assert.equal(versionText.props.fg, THEME.textMuted);
  assert.deepEqual(collectText(versionText), ['v1.2.3']);

  assert.equal(headingWrapper.tag, 'box');
  assert.equal(headingWrapper.props.marginTop, 1);
  assert.deepEqual(collectText(headingWrapper), ['Agents']);
});

test('compact rows use fixed-width label cell, blank indicator, and truncated model text with no dot separator', async () => {
  const { root } = await renderTree(
    {
      compactSidebar: true,
      preset: 'default',
      presets: {
        default: {
          qa: { model: 'cpa/gpt-5.5' },
          'qa-cr': { model: 'cpa/gpt-5.4' },
          'qa-e2e': { model: 'cpa/gpt-5.3' },
        },
      },
    },
    {
      qa: { model: 'cpa/gpt-5.5' },
      'qa-cr': { model: 'cpa/gpt-5.4' },
      'qa-e2e': { model: 'cpa/gpt-5.3' },
    },
  );

  const rowWrappers = root.children.slice(2);
  assert.equal(rowWrappers.length, 3);

  const expected = [
    ['qa', 'gpt-5.5'],
    ['qa-cr', 'gpt-5.4'],
    ['qa-e2e', 'gpt-5.3'],
  ];

  rowWrappers.forEach((wrapper, index) => {
    const [expectedName, expectedModel] = expected[index];
    assert.equal(wrapper.tag, 'box');
    assert.equal(wrapper.props.flexDirection, 'column');

    const line = wrapper.children[0];
    assert.equal(line.tag, 'box');
    assert.equal(line.props.width, '100%');
    assert.equal(line.props.flexDirection, 'row');
    assert.equal(line.props.justifyContent, 'space-between');

    const [left, modelText] = line.children;
    assert.equal(left.tag, 'box');
    assert.equal(left.props.width, 16);
    assert.equal(left.props.flexShrink, 0);
    assert.equal(left.props.flexDirection, 'row');

    const [label, indicator] = left.children;
    assert.equal(label.tag, 'text');
    assert.equal(label.props.width, 14);
    assert.equal(label.props.fg, THEME.textMuted);
    assert.deepEqual(collectText(label), [expectedName]);

    assert.equal(indicator.tag, 'text');
    assert.equal(indicator.props.width, 2);
    assert.deepEqual(collectText(indicator), ['']);

    assert.equal(modelText.tag, 'text');
    assert.equal(modelText.props.fg, THEME.textMuted);
    assert.equal(modelText.props.wrapMode, 'none');
    assert.equal(modelText.props.truncate, true);
    assert.equal(modelText.props.flexShrink, 1);
    assert.deepEqual(collectText(modelText), [expectedModel]);
  });

  const allText = collectText(root).join('');
  assert.equal(allText.includes('\u00B7'), false);
});

test('compact variant renders on a second indented row without disturbing the primary row', async () => {
  const { root } = await renderTree(
    { compactSidebar: true, preset: 'default', presets: { default: { 'guardian-code': { model: 'cpa/guard', variant: 'fast' } } }, sidebar: { agents: ['guardian-code'] } },
    { 'guardian-code': { model: 'cpa/guard', variant: 'fast' } },
  );

  const [wrapper] = root.children.slice(2);
  assert.equal(wrapper.children.length, 2);

  const [line, variantLine] = wrapper.children;
  assert.equal(line.props.justifyContent, 'space-between');
  assert.equal(line.children[0].props.width, 16);

  assert.equal(variantLine.tag, 'text');
  assert.equal(variantLine.props.marginLeft, 2);
  assert.equal(variantLine.props.fg, THEME.textMuted);
  assert.deepEqual(collectText(variantLine), ['variant: fast']);
});

test('non-compact mode renders provider/model/variant detail rows', async () => {
  const { root } = await renderTree(
    { compactSidebar: false, preset: 'default', presets: { default: { qa: { model: 'cpa/gpt-5.5', variant: 'review' } } }, sidebar: { agents: ['qa'] } },
    { qa: { model: 'cpa/gpt-5.5', variant: 'review' } },
  );

  const [wrapper] = root.children.slice(2);
  const [nameText, providerLine, modelLine, variantLine] = wrapper.children;

  assert.deepEqual(collectText(nameText), ['qa']);

  assert.deepEqual(collectText(providerLine), ['provider:', 'cpa']);
  assert.deepEqual(collectText(modelLine), ['model:', 'gpt-5.5']);
  assert.deepEqual(collectText(variantLine), ['variant:', 'review']);
});

test('empty agent set renders the muted empty label instead of rows', async () => {
  const { root } = await renderTree(
    { compactSidebar: true, preset: 'default', presets: { default: { qa: null } } },
    {},
  );

  const emptyText = root.children[2];
  assert.equal(emptyText.tag, 'text');
  assert.equal(emptyText.props.fg, THEME.textMuted);
  assert.deepEqual(collectText(emptyText), ['No QA agents loaded']);
  assert.equal(root.children.length, 3);
});

test('light RGBA accent badge picks a resolved dark theme background for contrast', async () => {
  const core = createFakeCore();
  const theme = { ...THEME, accent: { r: 0.85, g: 0.78, b: 0.95, a: 1 }, background: 'dark-surface' };

  const { root } = await renderTree(DEFAULT_QA_CONFIG, DEFAULT_QA_AGENTS, { importCore: async () => core, theme });

  assert.equal(getTitleTextNode(root).props.fg, 'dark-surface');
});

test('light RGBA accent badge falls back to RGBA.fromInts(0,0,0) when no usable theme background exists', async () => {
  const core = createFakeCore();
  const theme = { ...THEME, accent: { r: 0.85, g: 0.78, b: 0.95, a: 1 }, background: undefined };

  const { root } = await renderTree(DEFAULT_QA_CONFIG, DEFAULT_QA_AGENTS, { importCore: async () => core, theme });

  assert.deepEqual(getTitleTextNode(root).props.fg, core.RGBA.fromInts(0, 0, 0));
});

test('dark RGBA accent badge picks a resolved light theme text color for contrast', async () => {
  const core = createFakeCore();
  const theme = { ...THEME, accent: { r: 0.05, g: 0.05, b: 0.2, a: 1 }, text: 'light-ink' };

  const { root } = await renderTree(DEFAULT_QA_CONFIG, DEFAULT_QA_AGENTS, { importCore: async () => core, theme });

  assert.equal(getTitleTextNode(root).props.fg, 'light-ink');
});

test('dark RGBA accent badge falls back to RGBA.fromInts(255,255,255) when no usable theme text exists', async () => {
  const core = createFakeCore();
  const theme = { ...THEME, accent: { r: 0.05, g: 0.05, b: 0.2, a: 1 }, text: undefined };

  const { root } = await renderTree(DEFAULT_QA_CONFIG, DEFAULT_QA_AGENTS, { importCore: async () => core, theme });

  assert.deepEqual(getTitleTextNode(root).props.fg, core.RGBA.fromInts(255, 255, 255));
});

test('missing accent or unavailable core falls back to theme text without hardcoded colors', async () => {
  const core = createFakeCore();
  const themeNoAccent = { ...THEME, accent: undefined };

  const withoutAccent = await renderTree(DEFAULT_QA_CONFIG, DEFAULT_QA_AGENTS, { importCore: async () => core, theme: themeNoAccent });
  assert.equal(getTitleTextNode(withoutAccent.root).props.fg, THEME.text);

  const withoutCore = await renderTree(DEFAULT_QA_CONFIG, DEFAULT_QA_AGENTS, { importCore: async () => null });
  assert.equal(getTitleTextNode(withoutCore.root).props.fg, THEME.text);
});
