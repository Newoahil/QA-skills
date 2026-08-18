// Durable investigation artifact store (Phase 3).
// Per-issue artifacts live under .qa/guardian/<issue>/ and are written atomically enough for a
// single scheduler writer. Legacy flat state files remain supported by state.mjs.

import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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

export function writeArtifact(guardianDir, issue, name, value) {
  if (!['dossier', 'plan'].includes(name)) throw new Error(`unsupported artifact: ${name}`);
  const file = path.join(artifactDir(guardianDir, issue), `${name}.json`);
  atomicWriteJson(file, value);
  return file;
}

export function readArtifact(guardianDir, issue, name) {
  if (!['dossier', 'plan'].includes(name)) throw new Error(`unsupported artifact: ${name}`);
  const file = path.join(artifactDir(guardianDir, issue), `${name}.json`);
  if (!existsSync(file)) return null;
  return readJsonFile(file);
}

export function artifactPaths(guardianDir, issue) {
  const dir = artifactDir(guardianDir, issue);
  return {
    dossier_path: path.relative(path.dirname(guardianDir), path.join(dir, 'dossier.json')),
    plan_path: path.relative(path.dirname(guardianDir), path.join(dir, 'plan.json')),
  };
}
