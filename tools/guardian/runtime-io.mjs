// Shared runtime I/O: BOM-safe JSON, structured stderr logs, and CLI startup presentation.

import { existsSync, readFileSync } from 'node:fs';

export function stripUtf8Bom(text) {
  return String(text).replace(/^\uFEFF/, '');
}

export function readJsonFile(file, { required = true } = {}) {
  if (!existsSync(file)) {
    if (required) throw new Error(`JSON file not found: ${file}`);
    return {};
  }
  try {
    return JSON.parse(stripUtf8Bom(readFileSync(file, 'utf8')));
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid JSON';
    throw new Error(`invalid JSON file ${file}: ${reason}`);
  }
}

function safeValue(value) {
  if (value instanceof Error) return { error_name: value.name, error_message: value.message };
  if (value === undefined || value === null) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

export function createLogger({ component, sink = process.stderr, now = () => new Date().toISOString() }) {
  const write = (level, event, fields = {}) => {
    const entry = { ts: now(), level, component, event };
    for (const [key, value] of Object.entries(fields)) {
      const safe = safeValue(value);
      if (value instanceof Error) {
        entry.error_name = safe.error_name;
        entry.error_message = safe.error_message;
      } else {
        entry[key] = safe;
      }
    }
    sink.write(`${JSON.stringify(entry)}\n`);
  };
  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}

export function resolveBannerMode(env = process.env) {
  const mode = String(env.QA_GUARDIAN_BANNER_MODE ?? 'auto').toLowerCase();
  if (mode === 'ascii' || mode === 'unicode') return mode;
  return process.platform === 'win32' ? 'ascii' : 'unicode';
}

export function renderStartupBanner(mode = resolveBannerMode()) {
  return mode === 'unicode' ? '◇ QA Guardian / DEVer' : '<> QA Guardian / DEVer';
}

export function printStartupBanner({ sink = process.stderr, env = process.env } = {}) {
  const mode = resolveBannerMode(env);
  sink.write(`${renderStartupBanner(mode)}\n`);
  return mode;
}
