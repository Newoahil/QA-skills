import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import jsoncParser from 'jsonc-parser';

const { applyEdits, format, modify, parse } = jsoncParser;

const DEFAULT_QA_SKILL_TEMPLATE = `{
  "$schema": "./qa-skill.schema.json",
  // Shared QA preset/model overrides.
  "preset": "default",
  "compactSidebar": true,
  "sidebar": {
    "title": "QA-Agents",
    "agents": ["qa", "qa-cr", "qa-e2e"]
  },
  "presets": {
    "default": {
      "qa": { "model": "cpa/gpt-5.6-sol" },
      "qa-cr": { "model": "cpa/gpt-5.5" },
      "qa-e2e": { "model": "cpa/gpt-5.5" },
      "qa-guardian": { "model": "cpa/gpt-5.6-sol" },
      "guardian-business": { "model": "cpa/gpt-5.5" },
      "guardian-code": { "model": "cpa/gpt-5.5" },
      "guardian-docs": { "model": "cpa/gpt-5.6-sol" },
      "guardian-history": { "model": "cpa/gpt-5.5" },
      "guardian-plan-critic": { "model": "cpa/gpt-5.5" },
      "guardian-runtime": { "model": "cpa/gpt-5.5" }
    }
  }
}
`;

export async function installQaPlugin(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? path.resolve(fileURLToPath(new URL('../../', import.meta.url))));
  const packageDir = path.resolve(options.packageDir ?? path.join(repoRoot, 'packages', 'qa-opencode-plugin'));
  const distDir = path.join(packageDir, 'dist');
  const configDir = resolveConfigDir(options);
  const dryRun = Boolean(options.dryRun);
  const build = options.build !== false;
  const logger = options.logger ?? console;

  if (build) buildQaPlugin({ repoRoot });

  if (!dryRun) await mkdir(configDir, { recursive: true });

  const packageSpec = pathToFileURL(path.join(distDir, 'server.js')).href;
  const tuiSpec = pathToFileURL(path.join(distDir, 'tui.js')).href;

  const opencodeResult = await ensurePluginConfig({
    filePath: pickConfigFile(configDir, 'opencode'),
    managedSpec: packageSpec,
    dryRun,
    logger,
    schema: 'https://opencode.ai/config.json',
  });

  const tuiResult = await ensurePluginConfig({
    filePath: pickConfigFile(configDir, 'tui'),
    managedSpec: tuiSpec,
    dryRun,
    logger,
  });

  const qaConfigPath = path.join(configDir, 'qa-skill.jsonc');
  const schemaSourcePath = path.join(packageDir, 'qa-skill.schema.json');
  const schemaTargetPath = path.join(configDir, 'qa-skill.schema.json');
  const qaConfigCreated = await ensureQaSkillConfigFile({ qaConfigPath, schemaTargetPath, schemaSourcePath, dryRun });

  return {
    configDir,
    packageSpec,
    tuiSpec,
    dryRun,
    updated: {
      opencode: opencodeResult,
      tui: tuiResult,
      qaConfigCreated,
      schemaCopied: existsSync(schemaSourcePath),
    },
  };
}

export async function ensurePluginConfig({ filePath, managedSpec, dryRun = false, logger = console, schema }) {
  const existingText = existsSync(filePath) ? await readFile(filePath, 'utf8') : null;
  const nextText = updatePluginConfigText(existingText, managedSpec, { schema, filePath });
  const changed = existingText !== nextText;
  if (changed && !dryRun) await atomicWrite(filePath, nextText);
  if (changed) logger.log?.(`[qa-skill-opencode-plugin] ${dryRun ? 'Would update' : 'Updated'} ${filePath}`);
  return { filePath, changed, created: existingText === null };
}

export function updatePluginConfigText(existingText, managedSpec, options = {}) {
  if (existingText == null) {
    const next = {};
    if (options.schema) next.$schema = options.schema;
    next.plugin = [managedSpec];
    return `${JSON.stringify(next, null, 2)}\n`;
  }

  const errors = [];
  const parsed = parse(existingText, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) return existingText;
  const root = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  const nextPlugin = mergeManagedPluginEntry(root.plugin, managedSpec, options.filePath);
  let updatedText = existingText;
  const edits = modify(updatedText, ['plugin'], nextPlugin, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
    isArrayInsertion: false,
  });
  updatedText = applyEdits(updatedText, edits);

  if (options.schema && (root.$schema === undefined || root.$schema === null || root.$schema === '')) {
    updatedText = applyEdits(updatedText, modify(updatedText, ['$schema'], options.schema, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    }));
  }

  const formatted = applyEdits(updatedText, format(updatedText, undefined, { insertSpaces: true, tabSize: 2, eol: '\n' }));
  return formatted.endsWith('\n') ? formatted : `${formatted}\n`;
}

export function mergeManagedPluginEntry(pluginValue, managedSpec, packageHint = '') {
  const plugins = Array.isArray(pluginValue) ? pluginValue : [];
  const kept = plugins.filter((entry) => !isManagedEntry(entry, managedSpec, packageHint));
  kept.push(managedSpec);
  return kept;
}

export async function ensureQaSkillConfigFile({ qaConfigPath, schemaTargetPath, schemaSourcePath, dryRun = false }) {
  let created = false;
  if (!existsSync(qaConfigPath)) {
    created = true;
    if (!dryRun) await atomicWrite(qaConfigPath, DEFAULT_QA_SKILL_TEMPLATE);
  }
  if (existsSync(schemaSourcePath) && !dryRun) {
    await atomicWrite(schemaTargetPath, await readFile(schemaSourcePath, 'utf8'));
  }
  return created;
}

function buildQaPlugin({ repoRoot }) {
  const npmCommand = process.platform === 'win32'
    ? { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', 'npm.cmd', 'run', 'build', '--workspace', 'qa-skill-opencode-plugin'] }
    : { file: 'npm', args: ['run', 'build', '--workspace', 'qa-skill-opencode-plugin'] };
  const result = spawnSync(npmCommand.file, npmCommand.args, {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    const detail = result.error ? `: ${result.error.message}` : '';
    throw new Error(`qa-skill plugin build failed with exit code ${result.status ?? 'unknown'}${detail}`);
  }
}

function resolveConfigDir(options) {
  if (options.configDir) return path.resolve(options.configDir);
  if (options.homeDir) return path.join(path.resolve(options.homeDir), '.config', 'opencode');
  if (process.env.OPENCODE_CONFIG_DIR) return path.resolve(process.env.OPENCODE_CONFIG_DIR);
  if (process.env.XDG_CONFIG_HOME) return path.resolve(process.env.XDG_CONFIG_HOME, 'opencode');
  return path.join(os.homedir(), '.config', 'opencode');
}

function pickConfigFile(configDir, stem) {
  const jsoncPath = path.join(configDir, `${stem}.jsonc`);
  if (existsSync(jsoncPath)) return jsoncPath;
  const jsonPath = path.join(configDir, `${stem}.json`);
  if (existsSync(jsonPath)) return jsonPath;
  return jsoncPath;
}

function isManagedEntry(entry, managedSpec, packageHint) {
  const spec = typeof entry === 'string'
    ? entry
    : Array.isArray(entry) && typeof entry[0] === 'string'
      ? entry[0]
      : null;
  if (!spec) return false;
  if (spec === managedSpec) return true;
  if (!spec.startsWith('file:')) return false;

  try {
    const candidatePath = normalizeFileLikeSpec(spec);
    const segments = candidatePath.split(/[\\/]+/).filter(Boolean);
    const last = segments.at(-1);
    const secondLast = segments.at(-2);
    const thirdLast = segments.at(-3);
    return last === 'qa-opencode-plugin'
      || (last === 'tui' && secondLast === 'qa-opencode-plugin')
      || (thirdLast === 'qa-opencode-plugin' && secondLast === 'dist' && (last === 'server.js' || last === 'tui.js'));
  } catch {
    return false;
  }
}

function normalizeFileLikeSpec(spec) {
  try {
    return path.normalize(fileURLToPath(spec));
  } catch {
    const url = new URL(spec);
    return decodeURIComponent(url.pathname || '');
  }
}

async function atomicWrite(filePath, text) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, text, 'utf8');
  await rename(tempPath, filePath);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--skip-build') options.build = false;
    else if (arg === '--config-dir') options.configDir = argv[++index];
    else if (arg === '--home-dir') options.homeDir = argv[++index];
    else if (arg === '--repo-root') options.repoRoot = argv[++index];
    else if (arg === '--package-dir') options.packageDir = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  installQaPlugin(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
