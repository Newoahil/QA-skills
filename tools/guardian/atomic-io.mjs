// Small filesystem primitives for replacing recovery/state files without exposing a partial file.

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const realFs = Object.freeze({ mkdirSync, renameSync, rmSync, writeFileSync });

function tempPathFor(file, makeId) {
  return path.join(path.dirname(file), `.${path.basename(file)}.${makeId()}.tmp`);
}

export function atomicWriteText(file, text, { fsOps = realFs, makeId = randomUUID } = {}) {
  fsOps.mkdirSync(path.dirname(file), { recursive: true });
  const temp = tempPathFor(file, makeId);
  try {
    fsOps.writeFileSync(temp, text, 'utf8');
    fsOps.renameSync(temp, file);
  } catch (error) {
    try {
      fsOps.rmSync(temp, { force: true });
    } catch {
      // Preserve the original write/rename error; cleanup is best effort.
    }
    throw error;
  }
}

export function atomicWriteJson(file, value, options = {}) {
  return atomicWriteText(file, `${JSON.stringify(value, null, 2)}\n`, options);
}
