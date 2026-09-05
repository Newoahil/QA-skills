import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import jsoncParser from 'jsonc-parser';

const { parse } = jsoncParser;

export type QaSkillAgentOverride = {
  model?: string | null;
  variant?: string | null;
};

export type QaSkillPreset = Record<string, QaSkillAgentOverride | null>;

export type QaSkillConfig = {
  $schema?: string;
  preset?: string;
  compactSidebar?: boolean;
  sidebar?: {
    title?: string;
    agents?: string[];
  };
  presets?: Record<string, QaSkillPreset>;
};

export type LoadedQaSkillConfig = {
  config: QaSkillConfig;
  warnings: string[];
  valid: boolean;
  sources: {
    user?: string;
    project?: string;
  };
};

type QaSkillConfigSource = {
  config: QaSkillConfig;
  warnings: string[];
  valid: boolean;
  filePath?: string;
};

type LoadQaSkillConfigOptions = {
  directory?: string;
  configDir?: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
};

type ResolveActivePresetResult = {
  name: string;
  preset: QaSkillPreset;
  warnings: string[];
};

const DEFAULT_PRESET_NAME = 'default';
const DEFAULT_SIDEBAR_TITLE = 'QA-Agents';
const DEFAULT_SIDEBAR_AGENTS = Object.freeze(['qa', 'qa-cr', 'qa-e2e']);
const DEFAULT_PRESETS = Object.freeze({
  [DEFAULT_PRESET_NAME]: Object.freeze({
    qa: Object.freeze({ model: 'cpa/gpt-5.6-sol' }),
    'qa-cr': Object.freeze({ model: 'cpa/gpt-5.5' }),
    'qa-e2e': Object.freeze({ model: 'cpa/gpt-5.5' }),
    'qa-guardian': Object.freeze({ model: 'cpa/gpt-5.6-sol' }),
    'guardian-business': Object.freeze({ model: 'cpa/gpt-5.5' }),
    'guardian-code': Object.freeze({ model: 'cpa/gpt-5.5' }),
    'guardian-docs': Object.freeze({ model: 'cpa/gpt-5.6-sol' }),
    'guardian-history': Object.freeze({ model: 'cpa/gpt-5.5' }),
    'guardian-plan-critic': Object.freeze({ model: 'cpa/gpt-5.5' }),
    'guardian-runtime': Object.freeze({ model: 'cpa/gpt-5.5' }),
  }),
}) satisfies Record<string, QaSkillPreset>;

export function loadQaSkillConfig(options: LoadQaSkillConfigOptions = {}): LoadedQaSkillConfig {
  const userPath = resolvePreferredConfigPath(resolveUserConfigDir(options), 'qa-skill');
  const projectPath = options.directory
    ? resolvePreferredConfigPath(path.join(options.directory, '.opencode'), 'qa-skill')
    : undefined;

  const user = readQaSkillConfigFile(userPath, 'user');
  const project = readQaSkillConfigFile(projectPath, 'project');
  const warnings = [...user.warnings, ...project.warnings];

  return {
    config: mergeQaSkillConfig(user.config, project.config),
    warnings,
    valid: user.valid && project.valid,
    sources: {
      user: user.filePath,
      project: project.filePath,
    },
  };
}

export function mergeQaSkillConfig(userConfig?: QaSkillConfig, projectConfig?: QaSkillConfig): QaSkillConfig {
  const result: QaSkillConfig = {
    preset: DEFAULT_PRESET_NAME,
    compactSidebar: true,
    sidebar: {
      title: DEFAULT_SIDEBAR_TITLE,
      agents: [...DEFAULT_SIDEBAR_AGENTS],
    },
    presets: clonePresetMap(DEFAULT_PRESETS),
  };

  for (const source of [userConfig, projectConfig]) {
    if (!source) continue;
    if (typeof source.$schema === 'string' && source.$schema.trim()) result.$schema = source.$schema;
    if (typeof source.preset === 'string' && source.preset.trim()) result.preset = source.preset.trim();
    if (typeof source.compactSidebar === 'boolean') result.compactSidebar = source.compactSidebar;

    const title = source.sidebar?.title;
    if (typeof title === 'string' && title.trim()) {
      result.sidebar = { ...(result.sidebar ?? {}), title: title.trim() };
    }

    const agents = source.sidebar?.agents;
    if (Array.isArray(agents) && agents.every((agent) => typeof agent === 'string' && agent.trim())) {
      result.sidebar = { ...(result.sidebar ?? {}), agents: dedupeStrings(agents) };
    }

    if (source.presets && typeof source.presets === 'object') {
      result.presets ??= {};
      for (const [presetName, presetAgents] of Object.entries(source.presets)) {
        if (!presetAgents || typeof presetAgents !== 'object' || Array.isArray(presetAgents)) continue;
        const existing = result.presets[presetName] ? { ...result.presets[presetName] } : {};
        for (const [agentName, override] of Object.entries(presetAgents)) {
          if (override === null) {
            existing[agentName] = null;
            continue;
          }
          if (!override || typeof override !== 'object' || Array.isArray(override)) continue;
          existing[agentName] = {
            ...(existing[agentName] && typeof existing[agentName] === 'object' ? existing[agentName] : {}),
            ...(Object.prototype.hasOwnProperty.call(override, 'model') ? { model: override.model as string | null | undefined } : {}),
            ...(Object.prototype.hasOwnProperty.call(override, 'variant') ? { variant: override.variant as string | null | undefined } : {}),
          };
        }
        result.presets[presetName] = existing;
      }
    }
  }

  return result;
}

export function resolveActivePreset(config?: QaSkillConfig): ResolveActivePresetResult {
  const warnings: string[] = [];
  const presetName = config?.preset?.trim() || DEFAULT_PRESET_NAME;
  const presets = config?.presets ?? clonePresetMap(DEFAULT_PRESETS);
  const preset = presets[presetName];

  if (preset && typeof preset === 'object') {
    return { name: presetName, preset, warnings };
  }

  warnings.push(`qa-skill preset "${presetName}" was not found; falling back to "${DEFAULT_PRESET_NAME}".`);
  return {
    name: DEFAULT_PRESET_NAME,
    preset: presets[DEFAULT_PRESET_NAME] ?? clonePreset(DEFAULT_PRESETS[DEFAULT_PRESET_NAME]),
    warnings,
  };
}

export function applyPresetToOpenCodeConfig(openCodeConfig: Record<string, any>, qaSkillConfig?: QaSkillConfig): { appliedAgents: string[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!openCodeConfig || typeof openCodeConfig !== 'object') {
    return { appliedAgents: [], warnings: ['OpenCode config was not an object.'] };
  }

  const agentConfig = openCodeConfig.agent;
  if (!agentConfig || typeof agentConfig !== 'object' || Array.isArray(agentConfig)) {
    return { appliedAgents: [], warnings };
  }

  const { preset, warnings: presetWarnings } = resolveActivePreset(qaSkillConfig);
  warnings.push(...presetWarnings);
  const appliedAgents: string[] = [];

  for (const [agentName, override] of Object.entries(preset)) {
    if (!isManagedOpenCodeAgent(agentName)) continue;
    if (!Object.prototype.hasOwnProperty.call(agentConfig, agentName)) continue;
    if (!override || typeof override !== 'object' || Array.isArray(override)) continue;

    const originalAgent = agentConfig[agentName];
    if (!originalAgent || typeof originalAgent !== 'object' || Array.isArray(originalAgent)) continue;

    const nextAgent = { ...originalAgent };
    let changed = false;

    if (Object.prototype.hasOwnProperty.call(override, 'model')) {
      changed = true;
      if (override.model === null) delete nextAgent.model;
      else if (typeof override.model === 'string') nextAgent.model = override.model;
      else changed = false;
    }

    if (Object.prototype.hasOwnProperty.call(override, 'variant')) {
      changed = true;
      if (override.variant === null) delete nextAgent.variant;
      else if (typeof override.variant === 'string') nextAgent.variant = override.variant;
      else changed = false;
    }

    if (changed) {
      agentConfig[agentName] = nextAgent;
      appliedAgents.push(agentName);
    }
  }

  return { appliedAgents, warnings };
}

export function resolveSidebarAgentNames(config?: QaSkillConfig, availableAgents?: readonly string[]): string[] {
  const configured = config?.sidebar?.agents?.length ? config.sidebar.agents : [...DEFAULT_SIDEBAR_AGENTS];
  const deduped = dedupeStrings(configured ?? DEFAULT_SIDEBAR_AGENTS);
  if (!availableAgents) return deduped;
  const available = new Set(availableAgents);
  return deduped.filter((name) => available.has(name));
}

function readQaSkillConfigFile(filePath: string | undefined, sourceLabel: 'user' | 'project'): QaSkillConfigSource {
  if (!filePath || !existsSync(filePath)) {
    return { config: {}, warnings: [], valid: true };
  }

  try {
    const text = stripBom(readFileSync(filePath, 'utf8'));
    const errors: Array<{ error: number; offset: number; length: number }> = [];
    const raw = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length > 0) {
      return {
        config: {},
        warnings: [`Failed to parse ${sourceLabel} qa-skill config at ${filePath}; leaving QA agent models unchanged.`],
        valid: false,
        filePath,
      };
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {
        config: {},
        warnings: [`${sourceLabel} qa-skill config at ${filePath} must be an object; leaving QA agent models unchanged.`],
        valid: false,
        filePath,
      };
    }

    const warnings: string[] = [];
    const config = sanitizeQaSkillConfig(raw as Record<string, unknown>, warnings, sourceLabel, filePath);
    return { config, warnings, valid: true, filePath };
  } catch (error) {
    return {
      config: {},
      warnings: [`Unable to read ${sourceLabel} qa-skill config at ${filePath}: ${String((error as Error)?.message ?? error)}`],
      valid: false,
      filePath,
    };
  }
}

function sanitizeQaSkillConfig(raw: Record<string, unknown>, warnings: string[], sourceLabel: string, filePath: string): QaSkillConfig {
  const config: QaSkillConfig = {};

  if (typeof raw.$schema === 'string') config.$schema = raw.$schema;
  if (typeof raw.preset === 'string' && raw.preset.trim()) config.preset = raw.preset.trim();
  else if (raw.preset !== undefined && raw.preset !== null) warnings.push(`Ignoring ${sourceLabel} preset in ${filePath}; expected a non-empty string.`);

  if (typeof raw.compactSidebar === 'boolean') config.compactSidebar = raw.compactSidebar;
  else if (raw.compactSidebar !== undefined) warnings.push(`Ignoring ${sourceLabel} compactSidebar in ${filePath}; expected a boolean.`);

  if (raw.sidebar !== undefined) {
    if (!raw.sidebar || typeof raw.sidebar !== 'object' || Array.isArray(raw.sidebar)) {
      warnings.push(`Ignoring ${sourceLabel} sidebar in ${filePath}; expected an object.`);
    } else {
      const sidebarRaw = raw.sidebar as Record<string, unknown>;
      const sidebar: NonNullable<QaSkillConfig['sidebar']> = {};
      if (typeof sidebarRaw.title === 'string' && sidebarRaw.title.trim()) sidebar.title = sidebarRaw.title.trim();
      else if (sidebarRaw.title !== undefined && sidebarRaw.title !== null) warnings.push(`Ignoring ${sourceLabel} sidebar.title in ${filePath}; expected a non-empty string.`);

      if (sidebarRaw.agents !== undefined) {
        if (!Array.isArray(sidebarRaw.agents) || sidebarRaw.agents.some((agent) => typeof agent !== 'string' || !agent.trim())) {
          warnings.push(`Ignoring ${sourceLabel} sidebar.agents in ${filePath}; expected an array of non-empty strings.`);
        } else {
          sidebar.agents = dedupeStrings(sidebarRaw.agents as string[]);
        }
      }
      if (Object.keys(sidebar).length > 0) config.sidebar = sidebar;
    }
  }

  if (raw.presets !== undefined) {
    if (!raw.presets || typeof raw.presets !== 'object' || Array.isArray(raw.presets)) {
      warnings.push(`Ignoring ${sourceLabel} presets in ${filePath}; expected an object.`);
    } else {
      const presets: Record<string, QaSkillPreset> = {};
      for (const [presetName, presetValue] of Object.entries(raw.presets as Record<string, unknown>)) {
        if (!presetValue || typeof presetValue !== 'object' || Array.isArray(presetValue)) {
          warnings.push(`Ignoring ${sourceLabel} preset "${presetName}" in ${filePath}; expected an object.`);
          continue;
        }
        const agents: QaSkillPreset = {};
        for (const [agentName, agentOverride] of Object.entries(presetValue as Record<string, unknown>)) {
          if (agentOverride === null) {
            agents[agentName] = null;
            continue;
          }
          if (!agentOverride || typeof agentOverride !== 'object' || Array.isArray(agentOverride)) {
            warnings.push(`Ignoring ${sourceLabel} override for ${presetName}.${agentName} in ${filePath}; expected an object or null.`);
            continue;
          }
          const next: QaSkillAgentOverride = {};
          const overrideRecord = agentOverride as Record<string, unknown>;
          if (Object.prototype.hasOwnProperty.call(overrideRecord, 'model')) {
            if (overrideRecord.model === null || typeof overrideRecord.model === 'string') next.model = overrideRecord.model;
            else warnings.push(`Ignoring non-string model for ${presetName}.${agentName} in ${filePath}.`);
          }
          if (Object.prototype.hasOwnProperty.call(overrideRecord, 'variant')) {
            if (overrideRecord.variant === null || typeof overrideRecord.variant === 'string') next.variant = overrideRecord.variant;
            else warnings.push(`Ignoring non-string variant for ${presetName}.${agentName} in ${filePath}.`);
          }
          agents[agentName] = next;
        }
        presets[presetName] = agents;
      }
      config.presets = presets;
    }
  }

  return config;
}

function resolveUserConfigDir(options: LoadQaSkillConfigOptions): string {
  if (options.configDir) return options.configDir;
  const env = options.env ?? process.env;
  if (env.OPENCODE_CONFIG_DIR) return env.OPENCODE_CONFIG_DIR;
  if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, 'opencode');
  return path.join(options.homeDir ?? env.HOME ?? env.USERPROFILE ?? os.homedir(), '.config', 'opencode');
}

function resolvePreferredConfigPath(directory: string | undefined, stem: string): string | undefined {
  if (!directory) return undefined;
  const jsoncPath = path.join(directory, `${stem}.jsonc`);
  if (existsSync(jsoncPath)) return jsoncPath;
  const jsonPath = path.join(directory, `${stem}.json`);
  if (existsSync(jsonPath)) return jsonPath;
  return jsoncPath;
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function clonePresetMap(presets: Record<string, QaSkillPreset>): Record<string, QaSkillPreset> {
  const result: Record<string, QaSkillPreset> = {};
  for (const [presetName, agents] of Object.entries(presets)) result[presetName] = clonePreset(agents);
  return result;
}

function clonePreset(preset: QaSkillPreset): QaSkillPreset {
  const result: QaSkillPreset = {};
  for (const [agentName, override] of Object.entries(preset)) {
    result[agentName] = override ? { ...override } : null;
  }
  return result;
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function isManagedOpenCodeAgent(name: string): boolean {
  return name === 'qa' || /^qa-/.test(name) || /^guardian-/.test(name);
}
