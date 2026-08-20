// Durable investigation artifact store (Phase 3).
// Per-issue artifacts live under .qa/guardian/<issue>/ and are written atomically enough for a
// single scheduler writer. Legacy flat state files remain supported by state.mjs.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readJsonFile } from './runtime-io.mjs';

export function artifactDir(guardianDir, issue) {
  return path.join(guardianDir, String(Number(issue)));
}

function atomicWriteJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temp, file);
}

export function artifactJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function hashArtifact(value) {
  return `sha256:${createHash('sha256').update(artifactJson(value), 'utf8').digest('hex')}`;
}

export function artifactIdentity({ dossier, plan }) {
  return {
    dossier_hash: dossier ? hashArtifact(dossier) : null,
    plan_hash: plan ? hashArtifact(plan) : null,
    dossier_revision: dossier?.investigation_id ?? null,
    plan_revision: plan?.investigation_id ?? null,
  };
}

const JSON_ARTIFACTS = Object.freeze(['issue-data', 'dossier', 'plan', 'qa-verdict']);
const MARKDOWN_ARTIFACTS = Object.freeze(['pr-summary', 'qa-acceptance']);

export function writeArtifact(guardianDir, issue, name, value) {
  if (!JSON_ARTIFACTS.includes(name)) throw new Error(`unsupported artifact: ${name}`);
  const file = path.join(artifactDir(guardianDir, issue), `${name}.json`);
  atomicWriteJson(file, value);
  return file;
}

export function readArtifact(guardianDir, issue, name) {
  if (!JSON_ARTIFACTS.includes(name)) throw new Error(`unsupported artifact: ${name}`);
  const file = path.join(artifactDir(guardianDir, issue), `${name}.json`);
  if (!existsSync(file)) return null;
  return readJsonFile(file);
}

export function writeMarkdownArtifact(guardianDir, issue, name, value) {
  if (!MARKDOWN_ARTIFACTS.includes(name)) throw new Error(`unsupported markdown artifact: ${name}`);
  const dir = artifactDir(guardianDir, issue);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.md`);
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${String(value ?? '').trim()}\n`, 'utf8');
  renameSync(temp, file);
  return file;
}

export function readMarkdownArtifact(guardianDir, issue, name) {
  if (!MARKDOWN_ARTIFACTS.includes(name)) throw new Error(`unsupported markdown artifact: ${name}`);
  const file = path.join(artifactDir(guardianDir, issue), `${name}.md`);
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf8');
}

export function readArtifactPair(guardianDir, issue) {
  const dossier = readArtifact(guardianDir, issue, 'dossier');
  const plan = readArtifact(guardianDir, issue, 'plan');
  if (!dossier || !plan) return { complete: false, dossier, plan, reason: 'missing-pair' };
  if (dossier.investigation_id && plan.investigation_id && dossier.investigation_id !== plan.investigation_id) {
    return { complete: false, dossier, plan, reason: 'revision-mismatch' };
  }
  return { complete: true, dossier, plan, reason: null };
}

export function quarantineArtifacts(guardianDir, issue) {
  const dir = artifactDir(guardianDir, issue);
  const moved = [];
  for (const name of ['dossier', 'plan']) {
    const file = path.join(dir, `${name}.json`);
    if (!existsSync(file)) continue;
    const target = `${file}.invalid-${randomUUID()}`;
    renameSync(file, target);
    moved.push(target);
  }
  return moved;
}

export function artifactPaths(guardianDir, issue) {
  const dir = artifactDir(guardianDir, issue);
  return {
    issue_data_path: path.join(dir, 'issue-data.json'),
    dossier_path: path.relative(path.dirname(guardianDir), path.join(dir, 'dossier.json')),
    plan_path: path.relative(path.dirname(guardianDir), path.join(dir, 'plan.json')),
  };
}
