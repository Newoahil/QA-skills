// UTF-8 markdown transport for GitHub CLI bodies. The callback runs while the file exists.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function withGithubBodyFile(body, callback, {
  fsOps = { mkdtempSync, rmSync, writeFileSync },
  tempRoot = tmpdir(),
} = {}) {
  const dir = fsOps.mkdtempSync(path.join(tempRoot, 'qa-guardian-gh-body-'));
  const file = path.join(dir, 'body.md');
  try {
    fsOps.writeFileSync(file, String(body), 'utf8');
    return callback(file);
  } finally {
    try {
      fsOps.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Cleanup is best effort and must not hide the gh/callback result.
    }
  }
}
