// Machine-gated PR creation. The write-capable agent prepares/pushes a branch; scheduler owns
// gh pr create and calls this only after qa-gate PASS.

import { spawnSync } from 'node:child_process';
import { assertActorMayPerform, EFFECTS } from './actor-routing.mjs';
import { withGithubBodyFile } from './github-body-file.mjs';

export function createPullRequest({ actor, repoDir, head, base, title, body, run = spawnSync }) {
  assertActorMayPerform(actor, EFFECTS.PR_CREATE);
  const existing = findPullRequest({ repoDir, head, base, run });
  if (existing) return existing.url;
  const result = withGithubBodyFile(body, (bodyFile) => run('gh', [
    'pr', 'create', '--base', base, '--head', head, '--title', title, '--body-file', bodyFile,
  ], { cwd: repoDir, encoding: 'utf8', shell: false, windowsHide: true }));
  if (result.status !== 0 && isDuplicatePullRequestError(result.stderr ?? result.stdout ?? '')) {
    const createdElsewhere = findPullRequest({ repoDir, head, base, run });
    if (createdElsewhere) return createdElsewhere.url;
  }
  if (result.status !== 0) throw new Error(`gh pr create failed: ${result.stderr || 'unknown'}`);
  return String(result.stdout).trim();
}

function findPullRequest({ repoDir, head, base, run }) {
  const result = run('gh', [
    'pr', 'list', '--head', head, '--base', base, '--state', 'open', '--json', 'number,url,headRefName,baseRefName,state,isDraft',
  ], { cwd: repoDir, encoding: 'utf8', shell: false, windowsHide: true });
  if (result.status !== 0) throw new Error(`gh pr list failed: ${result.stderr || 'unknown'}`);
  const prs = JSON.parse(result.stdout || '[]');
  if (!Array.isArray(prs)) return null;
  return prs.find((pr) => pr?.url && pr.headRefName === head && pr.baseRefName === base) ?? null;
}

function isDuplicatePullRequestError(message) {
  return /pull request already exists|already exists/i.test(String(message));
}

export function currentBranch(repoDir, run = spawnSync) {
  const result = run('git', ['branch', '--show-current'], {
    cwd: repoDir, encoding: 'utf8', shell: false, windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`git branch --show-current failed: ${result.stderr || 'unknown'}`);
  return String(result.stdout).trim();
}
