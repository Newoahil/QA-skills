import { resolveActivePreset, resolveSidebarAgentNames, type QaSkillConfig, type QaSkillPreset } from './config';

export type SidebarSegmentTone = 'accent' | 'muted' | 'normal' | 'strong';

export type SidebarSegment = {
  text: string;
  tone: SidebarSegmentTone;
};

export type SidebarLine = {
  segments: SidebarSegment[];
};

export type SidebarRow = {
  agentName: string;
  model: string;
  variant?: string;
};

export type SidebarView = {
  header: SidebarLine[];
  sectionLabel: SidebarLine;
  rows: SidebarLine[][];
  emptyLabel?: SidebarLine;
};

export type SidebarAgentConfig = {
  model?: unknown;
  variant?: unknown;
};

export function buildSidebarView({
  qaConfig,
  agents,
  width,
  version = '0.1.0',
}: {
  qaConfig: QaSkillConfig;
  agents: Record<string, SidebarAgentConfig | undefined>;
  width: number;
  version?: string;
}): SidebarView {
  const safeWidth = normalizeWidth(width);
  const rows = resolveSidebarRows({ qaConfig, agents });
  return {
    header: formatHeaderLines(qaConfig.sidebar?.title ?? 'QA-Agents', `v${version}`, safeWidth),
    sectionLabel: { segments: [{ text: 'Agents', tone: 'strong' }] },
    rows: rows.map((row) => formatRowLines(row, safeWidth)),
    emptyLabel: rows.length === 0 ? { segments: [{ text: 'No QA agents loaded', tone: 'muted' }] } : undefined,
  };
}

export function resolveSidebarRows({
  qaConfig,
  agents,
}: {
  qaConfig: QaSkillConfig;
  agents: Record<string, SidebarAgentConfig | undefined>;
}): SidebarRow[] {
  const activePreset = resolveActivePreset(qaConfig).preset;
  const availableAgentNames = Object.keys(agents);
  const desiredNames = resolveSidebarAgentNames(qaConfig, availableAgentNames);
  const rows: SidebarRow[] = [];

  for (const agentName of desiredNames) {
    const resolved = resolveEffectiveAgent(agentName, agents[agentName], activePreset, qaConfig.compactSidebar !== false);
    if (!resolved) continue;
    rows.push(resolved);
  }

  return rows;
}

export function stripProviderPrefix(model: string): string {
  const slashIndex = model.indexOf('/');
  return slashIndex === -1 ? model : model.slice(slashIndex + 1);
}

export function resolveEffectiveAgent(
  agentName: string,
  currentAgent: SidebarAgentConfig | undefined,
  activePreset: QaSkillPreset,
  compactSidebar: boolean,
): SidebarRow | null {
  const presetEntry = activePreset[agentName];
  if (presetEntry === null) return null;
  const rawModel = normalizeMaybeString(currentAgent?.model) ?? normalizeMaybeString(presetEntry?.model);
  const rawVariant = normalizeMaybeString(currentAgent?.variant) ?? normalizeMaybeString(presetEntry?.variant);
  if (!rawModel && !rawVariant) return null;
  return {
    agentName,
    model: rawModel ? (compactSidebar ? stripProviderPrefix(rawModel) : rawModel) : '',
    ...(rawVariant ? { variant: rawVariant } : {}),
  };
}

export function formatHeaderLines(title: string, version: string, width: number): SidebarLine[] {
  const safeWidth = normalizeWidth(width);
  if (title.length + 1 + version.length <= safeWidth) {
    return [{
      segments: [
        { text: title, tone: 'accent' },
        { text: ' '.repeat(Math.max(1, safeWidth - title.length - version.length)), tone: 'normal' },
        { text: version, tone: 'muted' },
      ],
    }];
  }

  return [
    { segments: [{ text: truncateText(title, safeWidth), tone: 'accent' }] },
    { segments: [{ text: truncateText(version, safeWidth), tone: 'muted' }] },
  ];
}

export function formatRowLines(row: SidebarRow, width: number): SidebarLine[] {
  const safeWidth = normalizeWidth(width);
  const separator = '·';
  const lines: SidebarLine[] = [];
  const model = row.model;

  if (model) {
    if (row.agentName.length + 3 + model.length <= safeWidth) {
      lines.push({
        segments: [
          { text: row.agentName, tone: 'muted' },
          { text: ` ${separator} `, tone: 'accent' },
          { text: ' '.repeat(safeWidth - row.agentName.length - 3 - model.length), tone: 'normal' },
          { text: model, tone: 'normal' },
        ],
      });
    } else {
      lines.push({ segments: [{ text: truncateText(row.agentName, safeWidth), tone: 'muted' }] });
      lines.push({
        segments: [
          { text: `${separator} `, tone: 'accent' },
          { text: truncateText(model, Math.max(1, safeWidth - 2)), tone: 'normal' },
        ],
      });
    }
  } else {
    lines.push({ segments: [{ text: truncateText(row.agentName, safeWidth), tone: 'muted' }] });
  }

  if (row.variant) {
    lines.push({
      segments: [{ text: truncateText(`variant: ${row.variant}`, safeWidth), tone: 'muted' }],
    });
  }

  return lines;
}

function truncateText(text: string, width: number): string {
  const safeWidth = normalizeWidth(width);
  if (text.length <= safeWidth) return text;
  if (safeWidth <= 1) return '…';
  return `${text.slice(0, safeWidth - 1)}…`;
}

function normalizeWidth(width: number): number {
  return Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 24;
}

function normalizeMaybeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
