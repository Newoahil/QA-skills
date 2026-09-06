import { createHash } from 'node:crypto';

import { canonicalizeJson, sha256CanonicalJson } from './case-manifest.mjs';

export const RESOLVED_CPA_CONFIG_PROFILE_V1_SCHEMA_VERSION = 'qa-cr-resolved-cpa-config-profile-v1';
export const CREDENTIAL_READINESS_ATTESTATION_V1_SCHEMA_VERSION = 'qa-cr-credential-readiness-attestation-v1';
export const CREDENTIAL_READINESS_ATTESTATION_V3_ID = 'qa-cr-b2-parent-export-v3-cpa-models';
export const CPA_PROVIDER_ID = 'cpa';
export const REQUIRED_MODEL_ID = 'gpt-5.5';
export const READINESS_METHOD = 'GET';
export const READINESS_PATH_SUFFIX = '/models';
export const READINESS_REQUIRED_STATUS = 200;
export const READINESS_MAX_AGE_MS = 60000;
export const READINESS_TIMEOUT_MS = 15000;
export const READINESS_MAX_BODY_BYTES = 2097152;
export const RESOLVER_TIMEOUT_MS = 10000;
export const RESOLVER_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

export const CREDENTIAL_READINESS_V3_ERROR_CODES = Object.freeze({
  SPAWN_ERROR: 'credential_readiness_v3_spawn_error',
  EXIT_NONZERO: 'credential_readiness_v3_exit_nonzero',
  SIGNAL: 'credential_readiness_v3_signal',
  TIMEOUT: 'credential_readiness_v3_timeout',
  STDERR_NOT_EMPTY: 'credential_readiness_v3_stderr_not_empty',
  JSON_INVALID: 'credential_readiness_v3_json_invalid',
  CONFIG_INVALID: 'credential_readiness_v3_config_invalid',
  BASE_URL_INVALID: 'credential_readiness_v3_base_url_invalid',
  FETCH_ERROR: 'credential_readiness_v3_fetch_error',
  READINESS_TIMEOUT: 'credential_readiness_v3_readiness_timeout',
  REDIRECT: 'credential_readiness_v3_redirect',
  HTTP_STATUS: 'credential_readiness_v3_http_status',
  CONTENT_TYPE: 'credential_readiness_v3_content_type',
  BODY_TOO_LARGE: 'credential_readiness_v3_body_too_large',
  BODY_INVALID: 'credential_readiness_v3_body_invalid',
  MODEL_LIST_INVALID: 'credential_readiness_v3_model_list_invalid',
  REQUIRED_MODEL_MISSING: 'credential_readiness_v3_required_model_missing',
  ATTESTATION_INVALID: 'credential_readiness_v3_attestation_invalid',
  ATTESTATION_HASH_MISMATCH: 'credential_readiness_v3_attestation_hash_mismatch',
  ATTESTATION_EXPIRED: 'credential_readiness_v3_attestation_expired',
});

const RESOLVER_ENV_ALLOWLIST = Object.freeze([
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'NO_COLOR',
  'FORCE_COLOR',
  'CI',
]);
const NPM_PACKAGE_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/i;
const URLISH_KEY_RE = /(url|uri|endpoint)$/i;
const ABSOLUTE_HOST_PATH_RE = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;
const SHA256_RE = /^[a-f0-9]{64}$/;

function isHttpUrlString(value) {
  try {
    const parsed = new URL(value);
    return /^https?:$/i.test(parsed.protocol);
  } catch {
    return false;
  }
}

function isAbsoluteHostPathString(value) {
  return ABSOLUTE_HOST_PATH_RE.test(value);
}

function addSensitiveStringVariants(value, sink) {
  if (typeof value !== 'string' || value === '') return;
  const variants = new Set([value, value.trim()]);
  if (isHttpUrlString(value.trim())) {
    try {
      const parsed = new URL(value.trim());
      variants.add(parsed.toString());
      variants.add(`${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${parsed.pathname}${parsed.search}${parsed.hash}`);
    } catch {}
  }
  if (isAbsoluteHostPathString(value.trim())) {
    const trimmed = value.trim();
    variants.add(trimmed.replace(/\\/g, '/'));
    variants.add(trimmed.replace(/\//g, '\\'));
    variants.add(trimmed.toLowerCase());
    variants.add(trimmed.replace(/\\/g, '/').toLowerCase());
  }
  for (const variant of variants) {
    if (typeof variant === 'string' && variant !== '') sink.push(variant);
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalizeTrailingSlashPathname(pathname) {
  if (pathname === '' || pathname === '/') return '/';
  const withoutTrailing = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return withoutTrailing.startsWith('/') ? withoutTrailing : `/${withoutTrailing}`;
}

function safeIso(now) {
  const date = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function canonicalizeProviderNpm(npm) {
  if (typeof npm !== 'string' || npm === '') return null;
  if (npm !== npm.trim()) return null;
  if (!NPM_PACKAGE_RE.test(npm)) return null;
  return npm;
}

function canonicalizeBaseURL(baseURL) {
  if (typeof baseURL !== 'string' || baseURL.trim() === '') return null;
  let url;
  try {
    url = new URL(baseURL);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if ((url.pathname || '/').includes('//')) return null;
  const protocol = url.protocol.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  const isDefaultPort = (protocol === 'https:' && url.port === '443') || (protocol === 'http:' && url.port === '80');
  const port = url.port === '' || isDefaultPort ? '' : `:${url.port}`;
  const pathname = normalizeTrailingSlashPathname(url.pathname || '/');
  const canonicalBaseURL = `${protocol}//${hostname}${port}${pathname}`;
  return Object.freeze({
    canonicalBaseURL,
    originPathSha256: createHash('sha256').update(canonicalBaseURL).digest('hex'),
    modelsURL: pathname === '/' ? `${canonicalBaseURL}models` : `${canonicalBaseURL}/models`,
  });
}

function buildCanonicalProviderProjection(provider) {
  if (!isPlainObject(provider) || !isPlainObject(provider.options)) return null;
  const npm = canonicalizeProviderNpm(provider.npm);
  const endpoint = canonicalizeBaseURL(provider.options.baseURL);
  if (!npm || !endpoint) return null;
  if (typeof provider.options.apiKey !== 'string' || provider.options.apiKey.trim() === '') return null;
  return Object.freeze({
    npm,
    options: Object.freeze({
      baseURL: endpoint.canonicalBaseURL,
      apiKey: provider.options.apiKey,
    }),
    endpoint,
  });
}

function buildConfigProfile(selectedConfig) {
  const canonicalProvider = buildCanonicalProviderProjection(selectedConfig?.provider?.cpa);
  if (!canonicalProvider) return null;
  return Object.freeze({
    schemaVersion: RESOLVED_CPA_CONFIG_PROFILE_V1_SCHEMA_VERSION,
    source: 'opencode-debug-config-pure',
    selection: '$schema+provider.cpa',
    providerId: CPA_PROVIDER_ID,
    providerNpm: canonicalProvider.npm,
    modelId: REQUIRED_MODEL_ID,
    credentialPresent: true,
    providerEndpointOriginPathSha256: canonicalProvider.endpoint.originPathSha256,
  });
}

function validateSelectedConfigRoot(parsed) {
  if (!isPlainObject(parsed)) return null;
  if (typeof parsed.$schema !== 'string' || parsed.$schema.trim() === '') return null;
  if (!isPlainObject(parsed.provider) || !isPlainObject(parsed.provider.cpa)) return null;
  const provider = parsed.provider.cpa;
  if (!isPlainObject(provider.options)) return null;
  if (typeof provider.options.baseURL !== 'string' || provider.options.baseURL.trim() === '') return null;
  if (typeof provider.options.apiKey !== 'string' || provider.options.apiKey.trim() === '') return null;
  if (typeof provider.npm !== 'string' || provider.npm.trim() === '') return null;
  return provider;
}

function collectSensitiveStrings(value, keyName, sink) {
  if (typeof value === 'string') {
    const key = typeof keyName === 'string' ? keyName.toLowerCase() : '';
    if (['apikey', 'key', 'token', 'authtoken', 'secret', 'password', 'access', 'refresh', 'authorization', 'credential'].includes(key) && value !== '') sink.push(value);
    if (URLISH_KEY_RE.test(key) && value !== '') addSensitiveStringVariants(value, sink);
    if (isHttpUrlString(value.trim()) || isAbsoluteHostPathString(value.trim())) addSensitiveStringVariants(value, sink);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectSensitiveStrings(entry, keyName, sink);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [childKey, childValue] of Object.entries(value)) collectSensitiveStrings(childValue, childKey, sink);
}

function buildSensitiveValues(selectedConfig, selectedConfigContent, rawProvider = selectedConfig?.provider?.cpa) {
  const sink = [];
  const apiKey = selectedConfig.provider.cpa.options.apiKey;
  const canonicalBaseURL = String(selectedConfig.provider.cpa.options.baseURL ?? '');
  const rawBaseURL = String(rawProvider?.options?.baseURL ?? canonicalBaseURL);
  const endpoint = canonicalizeBaseURL(canonicalBaseURL);
  sink.push(apiKey, selectedConfigContent, selectedConfig.$schema, rawBaseURL, canonicalBaseURL);
  if (endpoint) {
    sink.push(endpoint.canonicalBaseURL, endpoint.modelsURL);
    try {
      const parsed = new URL(canonicalBaseURL);
      sink.push(parsed.origin, `${parsed.origin}${normalizeTrailingSlashPathname(parsed.pathname || '/')}`);
    } catch {}
  }
  collectSensitiveStrings(rawProvider, null, sink);
  return Object.freeze([...new Set(sink)]);
}

function hasForbiddenStructuredValue(value, keyName = null) {
  if (typeof value === 'string') {
    if (ABSOLUTE_HOST_PATH_RE.test(value)) return value !== '/models';
    try {
      const parsed = new URL(value);
      if (/^https?:$/.test(parsed.protocol)) return true;
    } catch {}
    return false;
  }
  if (Array.isArray(value)) return value.some((entry) => hasForbiddenStructuredValue(entry, keyName));
  if (!isPlainObject(value)) return false;
  for (const [childKey, childValue] of Object.entries(value)) {
    if (URLISH_KEY_RE.test(childKey) && typeof childValue === 'string' && childValue !== '/models') return true;
    if (hasForbiddenStructuredValue(childValue, childKey)) return true;
  }
  return false;
}

export function validateNoPersistedSecretsOrPathsV3(value) {
  return hasForbiddenStructuredValue(value) ? { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.ATTESTATION_INVALID } : { ok: true };
}

export function buildResolverEnvV3(baseEnv = {}) {
  const next = {};
  for (const key of RESOLVER_ENV_ALLOWLIST) {
    if (Object.prototype.hasOwnProperty.call(baseEnv, key) && baseEnv[key] != null) next[key] = baseEnv[key];
  }
  return next;
}

export async function resolveSelectedCpaConfigV3({ opencodeExecutable, cwd, baseEnv = {}, spawnDebug }) {
  const env = buildResolverEnvV3(baseEnv);
  let result;
  try {
    result = await spawnDebug(opencodeExecutable, ['debug', 'config', '--pure'], {
      cwd,
      env,
      shell: false,
      timeout: RESOLVER_TIMEOUT_MS,
      maxBuffer: RESOLVER_MAX_BUFFER_BYTES,
      encoding: 'utf8',
    });
  } catch {
    return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.SPAWN_ERROR };
  }
  if (result?.error) return { ok: false, code: result.error?.code === 'ETIMEDOUT' ? CREDENTIAL_READINESS_V3_ERROR_CODES.TIMEOUT : CREDENTIAL_READINESS_V3_ERROR_CODES.SPAWN_ERROR };
  if (result?.signal) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.SIGNAL };
  if (result?.status !== 0) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.EXIT_NONZERO };
  if (result?.stderr !== '') return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.STDERR_NOT_EMPTY };

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.JSON_INVALID };
  }

  const selectedProvider = validateSelectedConfigRoot(parsed);
  if (!selectedProvider) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.CONFIG_INVALID };

  const canonicalProvider = buildCanonicalProviderProjection(selectedProvider);
  if (!canonicalProvider) {
    const npm = canonicalizeProviderNpm(selectedProvider?.npm);
    return { ok: false, code: npm ? CREDENTIAL_READINESS_V3_ERROR_CODES.BASE_URL_INVALID : CREDENTIAL_READINESS_V3_ERROR_CODES.CONFIG_INVALID };
  }

  const selectedConfig = {
    $schema: parsed.$schema,
    provider: {
      cpa: {
        npm: canonicalProvider.npm,
        options: {
          baseURL: canonicalProvider.options.baseURL,
          apiKey: canonicalProvider.options.apiKey,
        },
      },
    },
  };
  const configProfile = buildConfigProfile(selectedConfig);
  if (!configProfile) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.CONFIG_INVALID };
  const selectedConfigContent = canonicalizeJson(selectedConfig);
  const apiKey = selectedConfig.provider.cpa.options.apiKey;
  return {
    ok: true,
    status: 'resolved',
    selectedConfig,
    selectedConfigContent,
    apiKey,
    configProfile,
    configProfileSha256: sha256CanonicalJson(configProfile),
    sensitiveValues: buildSensitiveValues(selectedConfig, selectedConfigContent, parsed.provider.cpa),
  };
}

async function readLimitedUtf8Body(responseBody, maxBytes, signal) {
  if (!responseBody) return '';
  const chunks = [];
  let total = 0;
  const ensureNotAborted = () => {
    if (signal?.aborted) {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }
  };
  const push = (chunk) => {
    ensureNotAborted();
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(typeof chunk === 'string' ? chunk : chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
    total += buffer.byteLength;
    if (total > maxBytes) throw new Error(CREDENTIAL_READINESS_V3_ERROR_CODES.BODY_TOO_LARGE);
    chunks.push(buffer);
  };
  if (typeof responseBody[Symbol.asyncIterator] === 'function') {
    for await (const chunk of responseBody) push(chunk);
    ensureNotAborted();
    return Buffer.concat(chunks).toString('utf8');
  }
  if (typeof responseBody.getReader === 'function') {
    const reader = responseBody.getReader();
    for (;;) {
      ensureNotAborted();
      const { done, value } = await reader.read();
      if (done) break;
      push(value);
    }
    ensureNotAborted();
    return Buffer.concat(chunks).toString('utf8');
  }
  throw new Error(CREDENTIAL_READINESS_V3_ERROR_CODES.BODY_INVALID);
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) return value;
  }
  return null;
}

function parseModelIds(body) {
  if (!isPlainObject(body) || !Array.isArray(body.data)) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.MODEL_LIST_INVALID };
  const seen = new Set();
  for (const entry of body.data) {
    if (!isPlainObject(entry) || typeof entry.id !== 'string' || entry.id.trim() === '') return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.MODEL_LIST_INVALID };
    if (seen.has(entry.id)) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.MODEL_LIST_INVALID };
    seen.add(entry.id);
  }
  if (seen.size === 0) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.MODEL_LIST_INVALID };
  if (!seen.has(REQUIRED_MODEL_ID)) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.REQUIRED_MODEL_MISSING };
  return { ok: true, count: seen.size };
}

export async function checkCpaCredentialReadinessV3({ selectedConfig, fetchImpl, now }) {
  const configProfile = buildConfigProfile(selectedConfig);
  if (!configProfile) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.CONFIG_INVALID };
  const endpoint = canonicalizeBaseURL(selectedConfig?.provider?.cpa?.options?.baseURL);
  const apiKey = selectedConfig?.provider?.cpa?.options?.apiKey;
  if (!endpoint || typeof apiKey !== 'string' || apiKey.trim() === '') return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.CONFIG_INVALID };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), READINESS_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(endpoint.modelsURL, {
      method: READINESS_METHOD,
      redirect: 'error',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
    });
    if (response?.redirected === true || response?.type === 'opaqueredirect' || (response?.status >= 300 && response?.status < 400)) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.REDIRECT };
    if (response?.status !== READINESS_REQUIRED_STATUS) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.HTTP_STATUS };
    const contentLength = headerValue(response.headers, 'content-length');
    if (contentLength != null) {
      const parsedLength = Number(contentLength);
      if (Number.isFinite(parsedLength) && parsedLength > READINESS_MAX_BODY_BYTES) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.BODY_TOO_LARGE };
    }
    const contentType = headerValue(response.headers, 'content-type');
    if (typeof contentType !== 'string' || !/application\/json/i.test(contentType)) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.CONTENT_TYPE };
    const text = await readLimitedUtf8Body(response.body, READINESS_MAX_BODY_BYTES, controller.signal);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.BODY_INVALID };
    }
    const parsed = parseModelIds(body);
    if (!parsed.ok) return { ok: false, code: parsed.code };
    const checkedAt = safeIso(now);
    if (checkedAt == null) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.ATTESTATION_INVALID };
    return {
      ok: true,
      attestation: {
        schemaVersion: CREDENTIAL_READINESS_ATTESTATION_V1_SCHEMA_VERSION,
        attestationId: CREDENTIAL_READINESS_ATTESTATION_V3_ID,
        configProfile,
        configProfileSha256: sha256CanonicalJson(configProfile),
        check: {
          method: READINESS_METHOD,
          pathSuffix: READINESS_PATH_SUFFIX,
          httpStatus: READINESS_REQUIRED_STATUS,
          authenticated: true,
          modelCount: parsed.count,
          requiredModelId: REQUIRED_MODEL_ID,
          requiredModelAvailable: true,
        },
        checkedAt,
      },
    };
  } catch (error) {
    if (error?.name === 'AbortError') return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.READINESS_TIMEOUT };
    if (error?.code === 'ERR_BODY_TOO_LARGE') return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.BODY_TOO_LARGE };
    if (error?.cause?.code === 'ERR_FR_REDIRECTION_FAILURE' || error?.code === 'ERR_FR_REDIRECTION_FAILURE') return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.REDIRECT };
    if (error?.message === CREDENTIAL_READINESS_V3_ERROR_CODES.BODY_TOO_LARGE) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.BODY_TOO_LARGE };
    return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.FETCH_ERROR };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function validateCredentialReadinessAttestationV3(attestation, { profileSha256, now, maxAgeMs = READINESS_MAX_AGE_MS } = {}) {
  if (!isPlainObject(attestation)) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.ATTESTATION_INVALID };
  const topKeys = Object.keys(attestation).sort();
  if (JSON.stringify(topKeys) !== JSON.stringify(['attestationId', 'check', 'checkedAt', 'configProfile', 'configProfileSha256', 'schemaVersion'])) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.ATTESTATION_INVALID };
  if (attestation.schemaVersion !== CREDENTIAL_READINESS_ATTESTATION_V1_SCHEMA_VERSION || attestation.attestationId !== CREDENTIAL_READINESS_ATTESTATION_V3_ID) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.ATTESTATION_INVALID };
  if (!isPlainObject(attestation.configProfile) || !isPlainObject(attestation.check)) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.ATTESTATION_INVALID };
  const computedProfileSha256 = sha256CanonicalJson(attestation.configProfile);
  if (attestation.configProfileSha256 !== computedProfileSha256 || (profileSha256 && attestation.configProfileSha256 !== profileSha256)) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.ATTESTATION_HASH_MISMATCH };
  const profileKeys = Object.keys(attestation.configProfile).sort();
  if (JSON.stringify(profileKeys) !== JSON.stringify(['credentialPresent', 'modelId', 'providerEndpointOriginPathSha256', 'providerId', 'providerNpm', 'schemaVersion', 'selection', 'source'])) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.ATTESTATION_INVALID };
  const checkKeys = Object.keys(attestation.check).sort();
  if (JSON.stringify(checkKeys) !== JSON.stringify(['authenticated', 'httpStatus', 'method', 'modelCount', 'pathSuffix', 'requiredModelAvailable', 'requiredModelId'])) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.ATTESTATION_INVALID };
  if (attestation.configProfile.schemaVersion !== RESOLVED_CPA_CONFIG_PROFILE_V1_SCHEMA_VERSION || attestation.configProfile.source !== 'opencode-debug-config-pure' || attestation.configProfile.selection !== '$schema+provider.cpa' || attestation.configProfile.providerId !== CPA_PROVIDER_ID || typeof attestation.configProfile.providerNpm !== 'string' || !NPM_PACKAGE_RE.test(attestation.configProfile.providerNpm) || attestation.configProfile.modelId !== REQUIRED_MODEL_ID || attestation.configProfile.credentialPresent !== true || typeof attestation.configProfile.providerEndpointOriginPathSha256 !== 'string' || !SHA256_RE.test(attestation.configProfile.providerEndpointOriginPathSha256)) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.ATTESTATION_INVALID };
  const checkedAtMs = Date.parse(attestation.checkedAt);
  const currentDate = now instanceof Date ? now : new Date(now ?? Date.now());
  const currentMs = currentDate.getTime();
  if (!Number.isFinite(checkedAtMs) || !Number.isFinite(currentMs) || attestation.check.method !== READINESS_METHOD || attestation.check.pathSuffix !== READINESS_PATH_SUFFIX || attestation.check.httpStatus !== READINESS_REQUIRED_STATUS || attestation.check.authenticated !== true || !Number.isInteger(attestation.check.modelCount) || attestation.check.modelCount < 1 || attestation.check.requiredModelId !== REQUIRED_MODEL_ID || attestation.check.requiredModelAvailable !== true) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.ATTESTATION_INVALID };
  if (!validateNoPersistedSecretsOrPathsV3(attestation).ok) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.ATTESTATION_INVALID };
  const ageMs = currentMs - checkedAtMs;
  if (ageMs < 0 || ageMs > maxAgeMs) return { ok: false, code: CREDENTIAL_READINESS_V3_ERROR_CODES.ATTESTATION_EXPIRED };
  return { ok: true };
}
