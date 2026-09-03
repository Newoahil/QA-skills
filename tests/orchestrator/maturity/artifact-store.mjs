import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const RUN_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;
const SAFE_KIND_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/i;
const SHA256_RE = /^[a-f0-9]{64}$/;
const SECRET_KEY_RE = /^(?:authorization|cookie|set-cookie|token|access[-_]?token|refresh[-_]?token|secret|api[-_]?key|password)$/i;
const TOKEN_TEXT_RE = /\b(?:bearer\s+[A-Za-z0-9._~+/=-]{8,}|(?:token|secret|api[-_]?key|password)\s*[:=]\s*[A-Za-z0-9._~+/=-]{6,})/gi;
const SECRET_FIELD_VALUE = '[REDACTED]';

function fail(code) {
  throw new Error(code);
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safeHash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function assertNoReparseComponent(targetPath) {
  const resolved = path.resolve(targetPath);
  const root = path.parse(resolved).root;
  let current = root;
  for (const segment of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) fail('unsafe_reparse_component');
  }
  return realpathSync.native ? realpathSync.native(resolved) : realpathSync(resolved);
}

function validateArtifactRoot(artifactRoot) {
  const stat = statSync(artifactRoot);
  if (!stat.isDirectory()) fail('artifact_root_not_directory');
  return assertNoReparseComponent(artifactRoot);
}

function validateRunId(runId) {
  if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) fail('unsafe_run_id');
  return runId;
}

function validateRelativeArtifactPath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) fail('unsafe_artifact_path');
  if (relativePath.includes('\\')) fail('unsafe_artifact_path');
  if (path.isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath) || /^\\/.test(relativePath)) fail('unsafe_artifact_path');
  const segments = relativePath.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) fail('unsafe_artifact_path');
  return segments.join('/');
}

function validateInventoryEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('invalid_inventory_entry');
  const keys = Object.keys(entry).sort();
  if (JSON.stringify(keys) !== JSON.stringify(['bytes', 'kind', 'path', 'sha256'])) fail('invalid_inventory_keys');
  validateRelativeArtifactPath(entry.path);
  if (entry.path === 'envelope.json') fail('envelope_inventoried');
  if (typeof entry.kind !== 'string' || !SAFE_KIND_RE.test(entry.kind)) fail('invalid_inventory_kind');
  if (typeof entry.sha256 !== 'string' || !SHA256_RE.test(entry.sha256)) fail('invalid_inventory_sha256');
  if (!Number.isInteger(entry.bytes) || entry.bytes < 0) fail('invalid_inventory_bytes');
}

function replaceKnownSecrets(text, sensitiveValues) {
  let redacted = String(text);
  for (const value of sensitiveValues) {
    if (typeof value !== 'string' || value.length === 0) continue;
    redacted = redacted.split(value).join('[REDACTED_SECRET]');
  }
  return redacted.replace(TOKEN_TEXT_RE, SECRET_FIELD_VALUE);
}

function redactJsonValue(value, sensitiveValues) {
  if (typeof value === 'string') return replaceKnownSecrets(value, sensitiveValues);
  if (Array.isArray(value)) return value.map((item) => redactJsonValue(item, sensitiveValues));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      SECRET_KEY_RE.test(key) ? SECRET_FIELD_VALUE : redactJsonValue(entry, sensitiveValues),
    ]));
  }
  return value;
}

function maybeParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

function assertSecretsAbsent(bytes, sensitiveValues) {
  const text = Buffer.from(bytes).toString('utf8');
  for (const value of sensitiveValues) {
    if (typeof value === 'string' && value.length > 0 && text.includes(value)) fail('secret_persisted');
  }
}

export function createRedactor({ sensitiveValues = [] }) {
  const secrets = [...new Set((Array.isArray(sensitiveValues) ? sensitiveValues : []).filter((value) => typeof value === 'string' && value.length > 0))];
  return Object.freeze({
    redactText(text) {
      const source = Buffer.isBuffer(text) ? text.toString('utf8') : String(text);
      const parsed = maybeParseJson(source);
      if (parsed.ok) return JSON.stringify(redactJsonValue(parsed.value, secrets), null, 2);
      return replaceKnownSecrets(source, secrets);
    },
    redactJson(value) {
      return redactJsonValue(value, secrets);
    },
    scan(bytes) {
      assertSecretsAbsent(bytes, secrets);
    },
    diagnostics() {
      return secrets.map((value) => ({ category: 'known-secret', length: value.length, sha256: safeHash(value) }));
    },
  });
}

function safeMkdirChain(rootReal, relativeDir) {
  const parts = relativeDir ? relativeDir.split('/') : [];
  let current = rootReal;
  for (const part of parts) {
    const next = path.join(current, part);
    try {
      const stat = lstatSync(next);
      if (stat.isSymbolicLink()) fail('unsafe_reparse_component');
      if (!stat.isDirectory()) fail('parent_component_not_directory');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      mkdirSync(next);
    }
    current = next;
  }
}

export function createImmutableRunStore({ artifactRoot, runId, redactor }) {
  if (!redactor || typeof redactor !== 'object') fail('invalid_redactor');
  if (typeof redactor.redactText !== 'function' || typeof redactor.redactJson !== 'function' || typeof redactor.scan !== 'function') fail('invalid_redactor');
  const rootReal = validateArtifactRoot(artifactRoot);
  const safeRunId = validateRunId(runId);
  const runDirectory = path.join(rootReal, safeRunId);
  try {
    mkdirSync(runDirectory);
  } catch (error) {
    if (error?.code === 'EEXIST') fail('existing_run_directory');
    throw error;
  }
  const inventory = [];
  const seen = new Set();
  let sealed = false;

  function assertWritable() {
    if (sealed) fail('run_store_sealed');
  }

  function prepareBytes(value, kind, mode) {
    if (typeof kind !== 'string' || !SAFE_KIND_RE.test(kind)) fail('invalid_inventory_kind');
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
    redactor?.scan?.(bytes, { mode, kind });
    return bytes;
  }

  function writeBuffer(relativePath, bytes, kind, inventoried = true) {
    assertWritable();
    const safePath = validateRelativeArtifactPath(relativePath);
    if (inventoried && seen.has(safePath)) fail('duplicate_artifact_path');
    const destination = path.join(runDirectory, ...safePath.split('/'));
    safeMkdirChain(runDirectory, path.posix.dirname(safePath) === '.' ? '' : path.posix.dirname(safePath));
    const fd = openSync(destination, 'wx');
    let wrote = false;
    try {
      writeFileSync(fd, bytes);
      wrote = true;
    } finally {
      try { closeSync(fd); } catch {}
      if (!wrote && existsSync(destination)) rmSync(destination, { force: true });
    }
    if (inventoried) {
      seen.add(safePath);
      inventory.push(Object.freeze({ path: safePath, kind, sha256: sha256Bytes(bytes), bytes: bytes.length }));
    }
    return destination;
  }

  return Object.freeze({
    runDirectory,
    writeText(relativePath, text, kind = 'text') {
      const redacted = redactor?.redactText ? redactor.redactText(text) : String(text);
      return writeBuffer(relativePath, prepareBytes(redacted, kind, 'text'), kind, true);
    },
    writeJson(relativePath, value, kind = 'json') {
      const redacted = redactor?.redactJson ? redactor.redactJson(value) : value;
      return writeBuffer(relativePath, prepareBytes(`${JSON.stringify(redacted, null, 2)}\n`, kind, 'json'), kind, true);
    },
    writeEnvelope(value) {
      return writeBuffer('envelope.json', prepareBytes(`${JSON.stringify(value, null, 2)}\n`, 'envelope', 'envelope'), 'envelope', false);
    },
    inventory() {
      return [...inventory].sort((a, b) => a.path.localeCompare(b.path));
    },
    markSealed() {
      sealed = true;
    },
  });
}

function safeListFiles(root, prefix = '') {
  const current = prefix ? path.join(root, prefix) : root;
  const entries = readdirSync(current, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const nativePath = path.join(root, ...rel.split('/'));
    const stat = lstatSync(nativePath);
    if (stat.isSymbolicLink()) fail('inventory_unsafe');
    if (entry.isDirectory()) out.push(...safeListFiles(root, rel));
    else out.push(rel);
  }
  return out.sort();
}

export function verifyArtifactInventory({ runDirectory, inventory }) {
  assertNoReparseComponent(runDirectory);
  const normalizedInventory = [...(Array.isArray(inventory) ? inventory : [])].sort((a, b) => String(a.path).localeCompare(String(b.path)));
  const seen = new Set();
  for (const entry of normalizedInventory) {
    validateInventoryEntry(entry);
    const safePath = validateRelativeArtifactPath(entry.path);
    if (seen.has(safePath)) fail('inventory_duplicate');
    seen.add(safePath);
    const filePath = path.join(runDirectory, ...safePath.split('/'));
    if (!existsSync(filePath)) fail('inventory_missing');
    const stat = lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) fail('inventory_non_file');
    const bytes = readFileSync(filePath);
    if (sha256Bytes(bytes) !== entry.sha256) fail('inventory_hash_mismatch');
    if (bytes.length !== entry.bytes) fail('inventory_bytes_mismatch');
  }
  const files = safeListFiles(runDirectory).filter((item) => item !== 'envelope.json');
  const extras = files.filter((item) => !seen.has(item));
  const missing = normalizedInventory.map((item) => item.path).filter((item) => !files.includes(item));
  if (extras.length) fail('inventory_extra');
  if (missing.length) fail('inventory_missing');
  return { ok: true, fileCount: normalizedInventory.length };
}
