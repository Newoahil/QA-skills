#!/usr/bin/env node
// Read-only Phase 4 memory matcher: reads .qa/memory/index.yaml (source of truth),
// matches approved rule/pattern cards against the current change surface, applies the
// applies_when / do_not_apply_when gate, and emits qa_planning_inputs records
// (memory_regression_check / memory_historical_pattern). Planning-only: never PASS evidence.
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const MAX_INPUT_BYTES = 1 * 1024 * 1024;
const RETRIEVAL_CAP = 3;
const itemTypes = Object.freeze(['rule', 'pattern', 'rejected']);
const reviewStatuses = Object.freeze(['current', 'stale', 'under_review']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function sortedDiagnostics(diagnostics) {
  return [...diagnostics].sort((left, right) => left.location.localeCompare(right.location) || left.code.localeCompare(right.code));
}

function addDiagnostic(diagnostics, code, location, message) {
  diagnostics.push({ code, location, message });
}

// --- Minimal, deterministic YAML subset parser -------------------------------
// Supports the bounded shapes used by memory cards and index files:
// key: scalar | key: | nested maps by indent | "- scalar" and "- key: value" list items.
// It intentionally rejects anything it does not understand rather than guessing.

function stripComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "'" && !inDouble) inSingle = !inSingle;
    else if (character === '"' && !inSingle) inDouble = !inDouble;
    else if (character === '#' && !inSingle && !inDouble && (index === 0 || line[index - 1] === ' ' || line[index - 1] === '\t')) {
      return line.slice(0, index);
    }
  }
  return line;
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value.length === 0) return '';
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return Number.parseFloat(value);
  return value;
}

function tokenizeYaml(text, diagnostics) {
  const lines = text.split(/\r?\n/);
  const tokens = [];
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const rawLine = stripComment(lines[lineNumber]);
    if (rawLine.trim().length === 0) continue;
    if (rawLine.includes('\t')) {
      addDiagnostic(diagnostics, 'yamlTab', `line ${lineNumber + 1}`, 'tabs are not allowed in memory YAML indentation');
      return null;
    }
    const indent = rawLine.length - rawLine.trimStart().length;
    tokens.push({ indent, content: rawLine.trim(), line: lineNumber + 1 });
  }
  return tokens;
}

// parseBlock consumes every token whose indent is >= minIndent. The block level is set by
// the first such token's actual indent, so callers pass a minimum (parent indent + 1) and
// the real child column is discovered from the source rather than assumed to be a fixed step.
function parseBlock(tokens, position, minIndent, diagnostics) {
  if (position.index >= tokens.length) return { value: null, ok: true };
  const first = tokens[position.index];
  if (first.indent < minIndent) return { value: null, ok: true };
  const blockIndent = first.indent;

  if (first.content.startsWith('- ') || first.content === '-') {
    const list = [];
    while (position.index < tokens.length) {
      const token = tokens[position.index];
      if (token.indent < blockIndent) break;
      if (token.indent > blockIndent) {
        addDiagnostic(diagnostics, 'yamlIndent', `line ${token.line}`, 'unexpected indentation inside list');
        return { value: null, ok: false };
      }
      if (!(token.content.startsWith('- ') || token.content === '-')) break;
      const dashIndent = token.indent;
      const itemContent = token.content === '-' ? '' : token.content.slice(2).trim();
      if (itemContent.length === 0) {
        position.index += 1;
        const nested = parseBlock(tokens, position, dashIndent + 1, diagnostics);
        if (!nested.ok) return { value: null, ok: false };
        list.push(nested.value);
      } else if (/^[A-Za-z0-9_.-]+:(\s|$)/.test(itemContent)) {
        // "- key: value" begins a map item. Its sibling keys are indented deeper than the dash.
        // Rewrite the dash line to sit at that sibling column so the map parser sees one block;
        // when the item is a single line, use dashIndent + 2 as a synthetic column.
        let itemIndent = dashIndent + 2;
        if (position.index + 1 < tokens.length && tokens[position.index + 1].indent > dashIndent) {
          itemIndent = tokens[position.index + 1].indent;
        }
        tokens[position.index] = { indent: itemIndent, content: itemContent, line: token.line };
        const nested = parseBlock(tokens, position, itemIndent, diagnostics);
        if (!nested.ok) return { value: null, ok: false };
        list.push(nested.value);
      } else {
        list.push(parseScalar(itemContent));
        position.index += 1;
      }
    }
    return { value: list, ok: true };
  }

  const map = {};
  while (position.index < tokens.length) {
    const token = tokens[position.index];
    if (token.indent < blockIndent) break;
    if (token.indent > blockIndent) {
      addDiagnostic(diagnostics, 'yamlIndent', `line ${token.line}`, 'unexpected indentation inside map');
      return { value: null, ok: false };
    }
    if (token.content.startsWith('- ')) break;
    const colonIndex = token.content.indexOf(':');
    if (colonIndex === -1) {
      addDiagnostic(diagnostics, 'yamlMap', `line ${token.line}`, `expected "key: value" mapping, got "${token.content}"`);
      return { value: null, ok: false };
    }
    const key = token.content.slice(0, colonIndex).trim();
    const rest = token.content.slice(colonIndex + 1).trim();
    position.index += 1;
    if (rest.length > 0) {
      map[key] = parseScalar(rest);
    } else {
      const nested = parseBlock(tokens, position, blockIndent + 1, diagnostics);
      if (!nested.ok) return { value: null, ok: false };
      map[key] = nested.value === null ? null : nested.value;
    }
  }
  return { value: map, ok: true };
}

export function parseMemoryYaml(text, diagnostics = []) {
  const tokens = tokenizeYaml(text, diagnostics);
  if (tokens === null) return { value: null, ok: false };
  if (tokens.length === 0) return { value: {}, ok: true };
  const baseIndent = tokens[0].indent;
  const position = { index: 0 };
  const result = parseBlock(tokens, position, baseIndent, diagnostics);
  if (!result.ok) return { value: null, ok: false };
  if (position.index !== tokens.length) {
    addDiagnostic(diagnostics, 'yamlTrailing', `line ${tokens[position.index].line}`, 'unparsed trailing content');
    return { value: null, ok: false };
  }
  return { value: result.value, ok: true };
}

// --- Path safety -------------------------------------------------------------

function isSafeRelativeMemoryPath(value) {
  if (!isNonEmptyString(value)) return false;
  if (isAbsolute(value)) return false;
  if (/^[A-Za-z]:/.test(value)) return false; // drive-qualified
  if (value.startsWith('\\\\') || value.startsWith('//')) return false; // UNC
  const normalized = value.replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '..')) return false;
  if (segments.some((segment) => segment.includes('\0'))) return false;
  return true;
}

const allowedItemPrefixes = Object.freeze(['rules/', 'patterns/', 'rejected/']);

function pathAllowedForType(itemPath, type) {
  const normalized = itemPath.replaceAll('\\', '/');
  if (type === 'rule') return normalized.startsWith('rules/');
  if (type === 'pattern') return normalized.startsWith('patterns/');
  if (type === 'rejected') return normalized.startsWith('rejected/');
  return allowedItemPrefixes.some((prefix) => normalized.startsWith(prefix));
}

// --- Glob matching (bounded: **, *, ? on / separated paths) ------------------

function globToRegExp(glob) {
  const normalized = glob.replaceAll('\\', '/');
  let pattern = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '*') {
      if (normalized[index + 1] === '*') {
        // ** matches across path segments
        pattern += '.*';
        index += 1;
        if (normalized[index + 1] === '/') index += 1;
      } else {
        pattern += '[^/]*';
      }
    } else if (character === '?') {
      pattern += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(character)) {
      pattern += `\\${character}`;
    } else {
      pattern += character;
    }
  }
  pattern += '$';
  return new RegExp(pattern);
}

function pathMatchesGlob(candidatePath, glob) {
  return globToRegExp(glob).test(candidatePath.replaceAll('\\', '/'));
}

// --- Change surface normalization --------------------------------------------

export function normalizeChangeSurface(raw, diagnostics = []) {
  const surface = { paths: [], symbols: [], keywords: [] };
  if (!isRecord(raw)) {
    addDiagnostic(diagnostics, 'changeSurface', '/', 'change surface must be an object with paths/symbols/keywords');
    return { surface: null, ok: false };
  }
  for (const key of ['paths', 'symbols', 'keywords']) {
    const value = raw[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
      addDiagnostic(diagnostics, 'changeSurface', `/${key}`, `${key} must be an array of non-empty strings`);
      return { surface: null, ok: false };
    }
    surface[key] = value.map((entry) => entry.replaceAll('\\', '/'));
  }
  return { surface, ok: true };
}

// --- VCS change surface derivation ------------------------------------------
// Parse a unified `git diff` (or `git diff --name-only` list) into a change surface.
// paths come from the changed file headers; symbols/keywords are derived heuristically
// from added/removed lines and path segments so a rule's match block has something to hit.
// This is read-only text parsing; it never executes anything by itself.

const COMMON_STOP_WORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'import', 'export', 'from', 'class',
  'this', 'true', 'false', 'null', 'void', 'async', 'await', 'if', 'else', 'for',
  'while', 'new', 'type', 'interface', 'public', 'private', 'static', 'def', 'self',
]);

function addSurfaceKeyword(set, token) {
  if (typeof token !== 'string') return;
  const trimmed = token.trim();
  if (trimmed.length < 3 || trimmed.length > 60) return;
  const lower = trimmed.toLowerCase();
  if (COMMON_STOP_WORDS.has(lower)) return;
  set.add(trimmed);
}

export function parseGitDiffToChangeSurface(diffText) {
  const paths = new Set();
  const symbols = new Set();
  const keywords = new Set();
  const lines = typeof diffText === 'string' ? diffText.split(/\r?\n/) : [];

  const identifierPattern = /[A-Za-z_$][A-Za-z0-9_$]{2,}/g;

  for (const rawLine of lines) {
    const line = rawLine;
    // `git diff` file headers: "diff --git a/x b/y", "+++ b/path", "--- a/path", or plain name-only lines.
    let headerMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (headerMatch) {
      paths.add(headerMatch[1].replaceAll('\\', '/'));
      paths.add(headerMatch[2].replaceAll('\\', '/'));
      continue;
    }
    headerMatch = /^\+\+\+ (?:b\/)?(.+)$/.exec(line);
    if (headerMatch && headerMatch[1] !== '/dev/null') {
      paths.add(headerMatch[1].replaceAll('\\', '/'));
      continue;
    }
    headerMatch = /^--- (?:a\/)?(.+)$/.exec(line);
    if (headerMatch && headerMatch[1] !== '/dev/null') {
      paths.add(headerMatch[1].replaceAll('\\', '/'));
      continue;
    }
    if (line.startsWith('@@') || line.startsWith('index ') || line.startsWith('similarity ')
      || line.startsWith('rename ') || line.startsWith('new file') || line.startsWith('deleted file')
      || line.startsWith('old mode') || line.startsWith('new mode') || line.startsWith('Binary ')) {
      continue;
    }
    // Content lines: added/removed. Ignore context to keep the surface focused on the change.
    if ((line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---')) {
      const content = line.slice(1);
      const matches = content.match(identifierPattern);
      if (matches) {
        for (const token of matches) {
          symbols.add(token);
          addSurfaceKeyword(keywords, token);
        }
      }
      continue;
    }
    // A bare path list (`git diff --name-only`).
    if (/^[^\s@+-].*\.[A-Za-z0-9]+$/.test(line) && !line.includes(' ')) {
      paths.add(line.replaceAll('\\', '/'));
    }
  }

  // Derive keywords from path segments too (module/dir names are strong signals).
  for (const filePath of paths) {
    for (const segment of filePath.split('/')) {
      const base = segment.replace(/\.[A-Za-z0-9]+$/, '');
      addSurfaceKeyword(keywords, base);
    }
  }

  return {
    paths: [...paths].sort(),
    symbols: [...symbols].sort(),
    keywords: [...keywords].sort(),
  };
}

// --- Matching ----------------------------------------------------------------

function textIncludesKeyword(surface, keyword) {
  const needle = keyword.toLowerCase();
  return surface.keywords.some((entry) => entry.toLowerCase() === needle)
    || surface.paths.some((entry) => entry.toLowerCase().includes(needle))
    || surface.symbols.some((entry) => entry.toLowerCase().includes(needle));
}

function matchCard(card, surface) {
  const reasons = [];
  const match = isRecord(card.match) ? card.match : {};
  const matchPaths = Array.isArray(match.paths) ? match.paths.filter(isNonEmptyString) : [];
  const matchSymbols = Array.isArray(match.symbols) ? match.symbols.filter(isNonEmptyString) : [];
  const matchKeywords = Array.isArray(match.keywords) ? match.keywords.filter(isNonEmptyString) : [];

  for (const glob of matchPaths) {
    for (const changedPath of surface.paths) {
      if (pathMatchesGlob(changedPath, glob)) {
        reasons.push(`path ${changedPath} matched ${glob}`);
        break;
      }
    }
  }
  for (const symbol of matchSymbols) {
    if (surface.symbols.includes(symbol)) reasons.push(`symbol ${symbol} touched`);
  }
  for (const keyword of matchKeywords) {
    if (textIncludesKeyword(surface, keyword)) reasons.push(`keyword ${keyword} present`);
  }
  return reasons;
}

function generatedChecks(card) {
  const checks = [];
  const raw = card.checks;
  if (isRecord(raw)) {
    for (const entry of Array.isArray(raw.must) ? raw.must : []) {
      if (isNonEmptyString(entry)) checks.push({ level: 'Must Verify', check: entry });
    }
    for (const entry of Array.isArray(raw.should) ? raw.should : []) {
      if (isNonEmptyString(entry)) checks.push({ level: 'Should Verify', check: entry });
    }
  } else if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (isRecord(entry) && isNonEmptyString(entry.check)) {
        const level = entry.level === 'Should' || entry.level === 'Should Verify' ? 'Should Verify' : 'Must Verify';
        checks.push({ level, check: entry.check });
      }
    }
  }
  return checks;
}

export function matchMemory(index, cardsById, changeSurface, options = {}) {
  const diagnostics = [];
  const reviewItems = [];
  const planningInputs = [];

  const items = Array.isArray(index?.items) ? index.items : [];
  if (!Array.isArray(index?.items)) {
    addDiagnostic(diagnostics, 'indexShape', '/items', 'index.yaml must define an items list');
    return { valid: false, planningInputs, reviewItems, diagnostics: sortedDiagnostics(diagnostics), matched: 0, applicable: 0 };
  }

  const applicableCandidates = [];

  items.forEach((item, position) => {
    const location = `/items/${position}`;
    if (!isRecord(item)) {
      reviewItems.push({ id: null, reason: 'index item is not a mapping', location });
      return;
    }
    const { id, type, path: itemPath, review_status: reviewStatus } = item;
    if (!isNonEmptyString(id)) {
      reviewItems.push({ id: null, reason: 'index item missing id', location });
      return;
    }
    if (!itemTypes.includes(type)) {
      reviewItems.push({ id, reason: `invalid item type ${JSON.stringify(type)}`, location });
      return;
    }
    if (!isNonEmptyString(itemPath) || !isSafeRelativeMemoryPath(itemPath)) {
      reviewItems.push({ id, reason: 'unsafe or missing item path', location });
      return;
    }
    if (!pathAllowedForType(itemPath, type)) {
      reviewItems.push({ id, reason: `path ${itemPath} not allowed for type ${type}`, location });
      return;
    }
    if (reviewStatus !== undefined && !reviewStatuses.includes(reviewStatus)) {
      reviewItems.push({ id, reason: `invalid review_status ${JSON.stringify(reviewStatus)}`, location });
      return;
    }
    if (type === 'rejected') {
      // Rejected items are never applied and never count toward the cap; they only exist to suppress repeats.
      return;
    }
    if (reviewStatus === 'stale' || reviewStatus === 'under_review') {
      reviewItems.push({ id, reason: `${reviewStatus} item skipped for planning; surfaced for review`, location });
      return;
    }

    const card = cardsById.get(id);
    if (!card) {
      reviewItems.push({ id, reason: `index references ${itemPath} but card was not provided/loaded`, location });
      return;
    }
    if (card.__parseError) {
      reviewItems.push({ id, reason: `card ${itemPath} failed to parse`, location });
      return;
    }
    if (isNonEmptyString(card.id) && card.id !== id) {
      reviewItems.push({ id, reason: `card id ${card.id} does not match index id ${id}`, location });
      return;
    }

    const matchReasons = matchCard(card, changeSurface);
    if (matchReasons.length === 0) return;

    const doNotApply = Array.isArray(card.do_not_apply_when) ? card.do_not_apply_when.filter(isNonEmptyString) : [];
    const appliesWhen = Array.isArray(card.applies_when) ? card.applies_when.filter(isNonEmptyString) : [];

    applicableCandidates.push({
      id,
      path: itemPath,
      type,
      confidence: isNonEmptyString(card.confidence) ? card.confidence : 'medium',
      matchReasons,
      appliesWhen,
      doNotApply,
      checks: generatedChecks(card),
      card,
    });
  });

  const matched = applicableCandidates.length;

  // Deterministic ordering: more match reasons first, then higher confidence, then id.
  const confidenceRank = { high: 0, medium: 1, low: 2 };
  applicableCandidates.sort((left, right) => {
    if (right.matchReasons.length !== left.matchReasons.length) return right.matchReasons.length - left.matchReasons.length;
    const leftRank = confidenceRank[left.confidence] ?? 1;
    const rightRank = confidenceRank[right.confidence] ?? 1;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.id.localeCompare(right.id);
  });

  const selected = applicableCandidates.slice(0, RETRIEVAL_CAP);
  const overflow = applicableCandidates.slice(RETRIEVAL_CAP);
  for (const item of overflow) {
    reviewItems.push({ id: item.id, reason: 'relevant but beyond 0-3 retrieval cap; surfaced for review', location: item.path });
  }

  for (const candidate of selected) {
    const provenance = `${candidate.id} (.qa/memory/${candidate.path})`;
    if (candidate.type === 'pattern' && candidate.checks.length === 0) {
      planningInputs.push({
        source_type: 'memory',
        claim_type: 'memory_historical_pattern',
        claim: isNonEmptyString(candidate.card.pattern) ? candidate.card.pattern : `Reusable failure pattern ${candidate.id} may apply`,
        provenance,
        confidence: candidate.confidence,
        use_limit: 'planning_only',
        applies_when: candidate.appliesWhen,
        do_not_apply_when: candidate.doNotApply,
        match_reasons: candidate.matchReasons,
      });
      continue;
    }
    for (const check of candidate.checks) {
      planningInputs.push({
        source_type: 'memory',
        claim_type: 'memory_regression_check',
        claim: check.check,
        planned_level: check.level,
        provenance,
        confidence: candidate.confidence,
        use_limit: 'planning_only',
        applies_when: candidate.appliesWhen,
        do_not_apply_when: candidate.doNotApply,
        match_reasons: candidate.matchReasons,
      });
    }
    if (candidate.checks.length === 0) {
      reviewItems.push({ id: candidate.id, reason: 'matched rule has no generatable checks', location: candidate.path });
    }
  }

  return {
    valid: true,
    planningInputs,
    reviewItems,
    diagnostics: sortedDiagnostics(diagnostics),
    matched,
    applicable: selected.length,
  };
}

// --- CLI ---------------------------------------------------------------------

function usage() {
  return 'Usage: node qa-skill/tools/match-memory.mjs --index <index.yaml> (--change <surface.json> | --diff <diff-file> | --base <ref> --head <ref>) [--repo <dir>] [--json]';
}

function readTextFile(inputPath) {
  const literalStats = lstatSync(inputPath);
  const stats = statSync(inputPath);
  if (!literalStats.isFile() || !stats.isFile()) throw new Error(`not a regular file: ${inputPath}`);
  if (stats.size > MAX_INPUT_BYTES) throw new Error(`oversized input: maximum 1 MiB, got ${stats.size} bytes`);
  return readFileSync(inputPath, 'utf8');
}

function looksLikeGitRef(value) {
  // Conservative allowlist: refs, SHAs, and range/parent forms. Rejects options and shell metacharacters.
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && /^[A-Za-z0-9._\/~^@{}+-]+$/.test(value) && !value.startsWith('-');
}

function defaultRunGit(args, repo) {
  const run = spawnSync('git', args, { cwd: repo || process.cwd(), encoding: 'utf8', shell: false, maxBuffer: MAX_INPUT_BYTES });
  if (run.error) throw new Error(`git not available: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`git exited ${run.status}: ${(run.stderr || '').trim()}`);
  return run.stdout ?? '';
}

export function cli(argv, io = {}) {
  const readFile = io.readTextFile ?? readTextFile;
  const readCardsForIndex = io.readCardsForIndex;
  const runGit = io.runGit ?? defaultRunGit;
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: {
        index: { type: 'string' },
        change: { type: 'string' },
        diff: { type: 'string' },
        base: { type: 'string' },
        head: { type: 'string' },
        repo: { type: 'string' },
        json: { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    return { status: 2, stdout: '', stderr: `${usage()}\nUnknown flag or option: ${error.message}\n` };
  }
  if (!isNonEmptyString(parsed.values.index)) {
    return { status: 2, stdout: '', stderr: `${usage()}\n--index is required.\n` };
  }

  const hasChange = isNonEmptyString(parsed.values.change);
  const hasDiff = isNonEmptyString(parsed.values.diff);
  const hasRange = isNonEmptyString(parsed.values.base) || isNonEmptyString(parsed.values.head);
  const modeCount = [hasChange, hasDiff, hasRange].filter(Boolean).length;
  if (modeCount === 0) {
    return { status: 2, stdout: '', stderr: `${usage()}\nProvide exactly one change source: --change, --diff, or --base/--head.\n` };
  }
  if (modeCount > 1) {
    return { status: 2, stdout: '', stderr: `${usage()}\n--change, --diff, and --base/--head are mutually exclusive.\n` };
  }

  let indexText;
  try {
    indexText = readFile(parsed.values.index);
  } catch (error) {
    return { status: 2, stdout: '', stderr: `Input missing or unreadable: ${error.message}\n` };
  }

  const parseDiagnostics = [];
  const indexParse = parseMemoryYaml(indexText, parseDiagnostics);
  if (!indexParse.ok || !isRecord(indexParse.value)) {
    return { status: 2, stdout: '', stderr: `Invalid index.yaml: ${parseDiagnostics.map((d) => `${d.location} ${d.code}: ${d.message}`).join('; ') || 'not a mapping'}\n` };
  }

  const surfaceDiagnostics = [];
  let normalized;
  if (hasChange) {
    let changeText;
    try {
      changeText = readFile(parsed.values.change);
    } catch (error) {
      return { status: 2, stdout: '', stderr: `Input missing or unreadable: ${error.message}\n` };
    }
    let change;
    try {
      change = JSON.parse(changeText);
    } catch (error) {
      return { status: 2, stdout: '', stderr: `Invalid change surface JSON: ${error.message}\n` };
    }
    normalized = normalizeChangeSurface(change, surfaceDiagnostics);
  } else {
    let diffText;
    if (hasDiff) {
      try {
        diffText = readFile(parsed.values.diff);
      } catch (error) {
        return { status: 2, stdout: '', stderr: `Diff file missing or unreadable: ${error.message}\n` };
      }
    } else {
      const base = parsed.values.base;
      const head = parsed.values.head;
      if (!isNonEmptyString(base) || !isNonEmptyString(head)) {
        return { status: 2, stdout: '', stderr: `${usage()}\nBoth --base and --head are required for range mode.\n` };
      }
      if (!looksLikeGitRef(base) || !looksLikeGitRef(head)) {
        return { status: 2, stdout: '', stderr: `Unsafe git ref: refs must match [A-Za-z0-9._/~^@{}+-] and not start with '-'.\n` };
      }
      if (isNonEmptyString(parsed.values.repo) && (parsed.values.repo.includes('\0') || parsed.values.repo.startsWith('-'))) {
        return { status: 2, stdout: '', stderr: `Unsafe --repo value.\n` };
      }
      try {
        diffText = runGit(['diff', '--unified=0', '--no-color', `${base}...${head}`], parsed.values.repo);
      } catch (error) {
        return { status: 2, stdout: '', stderr: `git diff failed: ${error.message}\n` };
      }
    }
    const derived = parseGitDiffToChangeSurface(diffText);
    normalized = normalizeChangeSurface(derived, surfaceDiagnostics);
  }
  if (!normalized.ok) {
    return { status: 2, stdout: '', stderr: `Invalid change surface: ${surfaceDiagnostics.map((d) => `${d.location} ${d.code}: ${d.message}`).join('; ')}\n` };
  }

  // Load referenced cards. In production the caller supplies a reader rooted at .qa/memory;
  // tests inject readCardsForIndex. Without a reader, only index-level review items are produced.
  const cardsById = new Map();
  if (typeof readCardsForIndex === 'function') {
    const loaded = readCardsForIndex(indexParse.value);
    for (const [id, card] of loaded) cardsById.set(id, card);
  }

  const result = matchMemory(indexParse.value, cardsById, normalized.surface);
  if (parsed.values.json) {
    return {
      status: result.valid ? 0 : 1,
      stdout: `${JSON.stringify({
        valid: result.valid,
        matched: result.matched,
        applicable: result.applicable,
        qa_planning_inputs: result.planningInputs,
        review_items: result.reviewItems,
        diagnostics: result.diagnostics,
      }, null, 2)}\n`,
      stderr: '',
    };
  }
  if (!result.valid) {
    return { status: 1, stdout: '', stderr: result.diagnostics.map((d) => `${d.location} ${d.code}: ${d.message}`).join('\n') + '\n' };
  }
  const lines = result.planningInputs.map((input) => `${input.claim_type} [${input.planned_level ?? 'planning_only'}] ${input.claim} <- ${input.provenance}`);
  return { status: 0, stdout: `${result.matched} matched, ${result.applicable} applicable\n${lines.join('\n')}${lines.length ? '\n' : ''}`, stderr: '' };
}

if (import.meta.url === `file://${process.argv[1].replaceAll('\\', '/')}` || process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = cli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.status;
}

export { dirname, resolve };
