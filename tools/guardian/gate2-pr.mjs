import { readArtifactPair } from './artifacts.mjs';
import { readRequiredPrSummary } from './content-artifacts.mjs';
import { createPullRequest } from './pr-io.mjs';
import { buildGuardianPrBodyFromAgentSummary, collectCommitSummaries } from './pr-summary.mjs';

export function openGate2PullRequest(request, deps = {}) {
  const { repoDir, guardianDir, issue, issueTitle, baseBranch, currentBranch, verdict, actor } = request;
  const readPair = deps.readArtifactPair ?? readArtifactPair;
  const readPrSummary = deps.readRequiredPrSummary ?? readRequiredPrSummary;
  const collectCommits = deps.collectCommitSummaries ?? collectCommitSummaries;
  const buildBody = deps.buildGuardianPrBodyFromAgentSummary ?? buildGuardianPrBodyFromAgentSummary;
  const createPr = deps.createPullRequest ?? createPullRequest;
  const title = issueTitle ?? `修复 issue #${issue}`;
  const artifacts = readPair(guardianDir, issue);
  const summary = readPrSummary(guardianDir, issue);
  const commits = collectCommits({ repoDir, base: baseBranch, head: currentBranch });
  const body = buildBody({
    summary,
    issue,
    issueTitle,
    base: baseBranch,
    head: currentBranch,
    plan: artifacts.plan,
    dossier: artifacts.dossier,
    verdict,
    commits,
  });
  const url = createPr({
    repoDir,
    head: currentBranch,
    base: baseBranch,
    title,
    actor,
    body,
  });
  return { url, title };
}
