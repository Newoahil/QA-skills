// Machine-gated PR creation. The write-capable agent prepares/pushes a branch; scheduler owns
// gh pr create and calls this only after qa-gate PASS.

import { spawnSync } from 'node:child_process';

export function createPullRequest({ repoDir, head, base, title, body, run = spawnSync }) {
  const result = run('gh', ['pr', 'create', '--base', base, '--head', head, '--title', title, '--body', body], {
    cwd: repoDir, encoding: 'utf8', shell: false, windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`gh pr create failed: ${result.stderr || 'unknown'}`);
  return String(result.stdout).trim();
}

export function currentBranch(repoDir, run = spawnSync) {
  const result = run('git', ['branch', '--show-current'], {
    cwd: repoDir, encoding: 'utf8', shell: false, windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`git branch --show-current failed: ${result.stderr || 'unknown'}`);
  return String(result.stdout).trim();
}
