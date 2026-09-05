import type { TuiPlugin, TuiPluginModule } from '@opencode-ai/plugin/tui';
import { loadQaSkillConfig } from './config';
import { resolveSidebarRows, type SidebarRow } from './sidebar-model';

export * from './sidebar-model';

type SolidRuntime<Node> = {
  readonly createElement: (tag: string) => Node;
  readonly insert: (parent: Node, child: Node | string) => unknown;
  readonly setProp: (node: Node, name: string, value: unknown) => unknown;
};

type RGBAColor = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
};

type OpenTuiCoreModule = {
  readonly parseColor: (input: unknown) => RGBAColor;
  readonly RGBA: {
    readonly fromInts: (r: number, g: number, b: number, a?: number) => RGBAColor;
  };
};

type SlotRegistration<Node> = {
  readonly order: number;
  readonly slots: {
    readonly sidebar_content: () => Node;
  };
};

type TuiFactoryOptions = {
  loadConfig?: typeof loadQaSkillConfig;
  importSolid?: () => Promise<SolidRuntime<unknown> | null>;
  importCore?: () => Promise<OpenTuiCoreModule | null>;
};

export function createQaSkillTuiPlugin(options: TuiFactoryOptions = {}): TuiPlugin {
  const loadConfig = options.loadConfig ?? loadQaSkillConfig;
  const importSolid = options.importSolid ?? (async () => {
    try {
      return await import('@opentui/solid') as SolidRuntime<unknown>;
    } catch {
      return null;
    }
  });
  const importCore = options.importCore ?? (async () => {
    try {
      return await import('@opentui/core') as unknown as OpenTuiCoreModule;
    } catch {
      return null;
    }
  });

  return async (api, _pluginOptions, meta) => {
    const solid = await importSolid();
    if (!solid) return;
    const core = await importCore();

    const directory = api.state.path.directory;
    const loaded = loadConfig({ directory });
    const qaConfig = loaded.config;
    const version = meta.version ?? '0.1.0';
    const title = qaConfig.sidebar?.title ?? 'QA-Agents';
    const compactSidebar = qaConfig.compactSidebar !== false;

    const renderSidebar = () => materializeSidebar({
      rows: resolveSidebarRows({ qaConfig, agents: api.state.config.agent ?? {} }),
      title,
      version,
      compactSidebar,
      solid,
      theme: api.theme.current,
      core,
    });

    const registration: SlotRegistration<unknown> = {
      order: 900,
      slots: {
        sidebar_content: renderSidebar,
      },
    };

    api.slots.register(registration as never);
    api.renderer.requestRender();
  };
}

export const tui = createQaSkillTuiPlugin();

const module: TuiPluginModule = {
  id: 'qa-skill:tui',
  tui,
};

export default module;

function materializeSidebar<Node>(params: {
  rows: SidebarRow[];
  title: string;
  version: string;
  compactSidebar: boolean;
  solid: SolidRuntime<Node>;
  theme: Record<string, unknown>;
  core: OpenTuiCoreModule | null;
}): Node {
  const { rows, title, version, compactSidebar, solid, theme, core } = params;

  const root = solid.createElement('box');
  solid.setProp(root, 'width', '100%');
  solid.setProp(root, 'flexDirection', 'column');
  solid.setProp(root, 'paddingTop', 1);
  solid.setProp(root, 'paddingBottom', 1);
  solid.setProp(root, 'paddingLeft', 1);
  solid.setProp(root, 'paddingRight', 1);

  solid.insert(root, buildHeader(title, version, solid, theme, core));
  solid.insert(root, buildHeadingWrapper('Agents', solid, theme));

  if (rows.length === 0) {
    const empty = createText(solid, 'No QA agents loaded', { fg: theme.textMuted });
    solid.insert(root, empty);
    return root;
  }

  for (const row of rows) {
    solid.insert(root, compactSidebar
      ? buildCompactRow(row, solid, theme)
      : buildDetailRow(row, solid, theme));
  }

  return root;
}

function buildHeader<Node>(title: string, version: string, solid: SolidRuntime<Node>, theme: Record<string, unknown>, core: OpenTuiCoreModule | null): Node {
  const header = solid.createElement('box');
  solid.setProp(header, 'width', '100%');
  solid.setProp(header, 'flexDirection', 'row');
  solid.setProp(header, 'justifyContent', 'space-between');
  solid.setProp(header, 'alignItems', 'center');

  const titleBadge = solid.createElement('box');
  solid.setProp(titleBadge, 'paddingLeft', 1);
  solid.setProp(titleBadge, 'paddingRight', 1);
  solid.setProp(titleBadge, 'backgroundColor', theme.accent);
  const titleText = createText(solid, title, { fg: resolveContrastForeground(theme.accent, theme.text, theme.background, core) });
  solid.insert(titleBadge, titleText);
  solid.insert(header, titleBadge);

  const versionText = createText(solid, `v${version}`, { fg: theme.textMuted });
  solid.insert(header, versionText);

  return header;
}

function buildHeadingWrapper<Node>(label: string, solid: SolidRuntime<Node>, theme: Record<string, unknown>): Node {
  const wrapper = solid.createElement('box');
  solid.setProp(wrapper, 'width', '100%');
  solid.setProp(wrapper, 'marginTop', 1);
  solid.insert(wrapper, createText(solid, label, { fg: theme.text }));
  return wrapper;
}

function buildCompactRow<Node>(row: SidebarRow, solid: SolidRuntime<Node>, theme: Record<string, unknown>): Node {
  const wrapper = solid.createElement('box');
  solid.setProp(wrapper, 'width', '100%');
  solid.setProp(wrapper, 'flexDirection', 'column');

  const line = solid.createElement('box');
  solid.setProp(line, 'width', '100%');
  solid.setProp(line, 'flexDirection', 'row');
  solid.setProp(line, 'justifyContent', 'space-between');

  const left = solid.createElement('box');
  solid.setProp(left, 'width', 16);
  solid.setProp(left, 'flexShrink', 0);
  solid.setProp(left, 'flexDirection', 'row');

  const label = createText(solid, row.agentName, { fg: theme.textMuted });
  solid.setProp(label, 'width', 14);
  solid.insert(left, label);

  // Two-character cell reserved for a future activity indicator/separator.
  // This plugin does not track activity yet, so it stays blank on purpose.
  const indicator = createText(solid, '', {});
  solid.setProp(indicator, 'width', 2);
  solid.insert(left, indicator);

  solid.insert(line, left);

  const modelText = createText(solid, row.model, { fg: theme.textMuted });
  solid.setProp(modelText, 'wrapMode', 'none');
  solid.setProp(modelText, 'truncate', true);
  solid.setProp(modelText, 'flexShrink', 1);
  solid.insert(line, modelText);

  solid.insert(wrapper, line);

  if (row.variant) {
    const variantLine = createText(solid, `variant: ${row.variant}`, { fg: theme.textMuted });
    solid.setProp(variantLine, 'marginLeft', 2);
    solid.insert(wrapper, variantLine);
  }

  return wrapper;
}

function buildDetailRow<Node>(row: SidebarRow, solid: SolidRuntime<Node>, theme: Record<string, unknown>): Node {
  const wrapper = solid.createElement('box');
  solid.setProp(wrapper, 'width', '100%');
  solid.setProp(wrapper, 'flexDirection', 'column');

  solid.insert(wrapper, createText(solid, row.agentName, { fg: theme.text }));

  const slashIndex = row.model.indexOf('/');
  const provider = slashIndex === -1 ? undefined : row.model.slice(0, slashIndex);
  const model = slashIndex === -1 ? row.model : row.model.slice(slashIndex + 1);

  if (provider) solid.insert(wrapper, buildDetailLine('provider', provider, solid, theme));
  if (model) solid.insert(wrapper, buildDetailLine('model', model, solid, theme));
  if (row.variant) solid.insert(wrapper, buildDetailLine('variant', row.variant, solid, theme));

  return wrapper;
}

function buildDetailLine<Node>(label: string, value: string, solid: SolidRuntime<Node>, theme: Record<string, unknown>): Node {
  const line = solid.createElement('box');
  solid.setProp(line, 'width', '100%');
  solid.setProp(line, 'flexDirection', 'row');
  solid.setProp(line, 'marginLeft', 2);

  const labelText = createText(solid, `${label}:`, { fg: theme.textMuted });
  solid.setProp(labelText, 'width', 10);
  solid.insert(line, labelText);

  const valueText = createText(solid, value, { fg: theme.textMuted });
  solid.setProp(valueText, 'wrapMode', 'none');
  solid.setProp(valueText, 'truncate', true);
  solid.setProp(valueText, 'flexShrink', 1);
  solid.insert(line, valueText);

  return line;
}

function createText<Node>(solid: SolidRuntime<Node>, value: string, props: Record<string, unknown>): Node {
  const text = solid.createElement('text');
  for (const [name, propValue] of Object.entries(props)) {
    if (propValue === undefined) continue;
    solid.setProp(text, name, propValue);
  }
  solid.insert(text, value);
  return text;
}

function resolveContrastForeground(
  accent: unknown,
  themeText: unknown,
  themeBackground: unknown,
  core: OpenTuiCoreModule | null,
): unknown {
  if (!accent || !core) return themeText;
  try {
    const rgba = core.parseColor(accent);
    const luminance = 0.299 * rgba.r + 0.587 * rgba.g + 0.114 * rgba.b;
    if (luminance > 0.6) {
      return isUsableThemeColor(themeBackground) ? themeBackground : core.RGBA.fromInts(0, 0, 0);
    }
    return isUsableThemeColor(themeText) ? themeText : core.RGBA.fromInts(255, 255, 255);
  } catch {
    return themeText;
  }
}

function isUsableThemeColor(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.toLowerCase() !== 'transparent';
  }
  if (typeof value === 'object') {
    const alpha = (value as { a?: unknown }).a;
    return typeof alpha === 'number' ? alpha > 0 : true;
  }
  return true;
}
