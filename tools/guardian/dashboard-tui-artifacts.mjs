import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { artifactDir, readArtifact, readMarkdownArtifact } from './artifacts.mjs';

function splitLines(text) {
  return String(text ?? '').split(/\r?\n/);
}

function valueOrDash(value) {
  return value === undefined || value === null || value === '' ? '-' : String(value);
}

function readOptionalText(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf8');
}

function trimPreview(text, limit = 18) {
  const lines = splitLines(text).filter((line, index, source) => !(index === source.length - 1 && line === ''));
  if (lines.length <= limit) return lines;
  return [...lines.slice(0, limit), `... 共 ${lines.length} 行，已截断`];
}

function flattenObjectPreview(label, value) {
  const serialized = JSON.stringify(value, null, 2);
  return [`${label}:`, ...trimPreview(serialized, 14).map((line) => `  ${line}`)];
}

function artifactAbsolutePath(guardianDir, relativePath) {
  if (!relativePath) return null;
  return path.join(path.dirname(guardianDir), relativePath);
}

export function buildArtifactErrorLines(guardianDir, record) {
  if (!record) return ['暂无产物。'];
  const lines = ['错误与产物'];
  lines.push(`- last_error_class: ${valueOrDash(record.last_error_class)}`);
  if ((record.plan_validation_errors ?? []).length > 0) lines.push(`- plan_validation_errors: ${(record.plan_validation_errors ?? []).join(', ')}`);
  if ((record.specialist_failures ?? []).length > 0) lines.push(`- specialist_failures: ${(record.specialist_failures ?? []).join(', ')}`);
  lines.push('');

  const issueDir = artifactDir(guardianDir, record.issue);
  const dossier = readArtifact(guardianDir, record.issue, 'dossier');
  const plan = readArtifact(guardianDir, record.issue, 'plan');
  const verdict = readArtifact(guardianDir, record.issue, 'qa-verdict');
  const prSummary = readMarkdownArtifact(guardianDir, record.issue, 'pr-summary');
  const qaAcceptance = readMarkdownArtifact(guardianDir, record.issue, 'qa-acceptance');

  lines.push(`- issue 目录: ${issueDir}`);
  lines.push(`- dossier_path: ${valueOrDash(record.dossier_path)}`);
  lines.push(`- plan_path: ${valueOrDash(record.plan_path)}`);
  lines.push(`- qa_verdict_path: ${valueOrDash(record.qa_verdict_path)}`);
  lines.push('');

  if (dossier) {
    lines.push(...flattenObjectPreview('dossier.json', {
      investigation_id: dossier.investigation_id ?? '-',
      issue_class: dossier.issue_class ?? '-',
      selected_hypothesis: dossier.selected_hypothesis ?? '-',
      unresolved_facts: dossier.unresolved_facts?.length ?? 0,
      evidence: dossier.evidence?.length ?? 0,
    }));
  } else {
    lines.push('dossier.json: 缺失');
  }
  lines.push('');

  if (plan) {
    lines.push(...flattenObjectPreview('plan.json', {
      investigation_id: plan.investigation_id ?? '-',
      steps: plan.steps?.length ?? plan.plan_steps?.length ?? 0,
      risks: plan.risks?.length ?? 0,
      validation: plan.validation ?? '-',
    }));
  } else {
    lines.push('plan.json: 缺失');
  }
  lines.push('');

  if (verdict) lines.push(...flattenObjectPreview('qa-verdict.json', verdict));
  else lines.push('qa-verdict.json: 缺失');
  lines.push('');

  if (prSummary) {
    lines.push('pr-summary.md:');
    lines.push(...trimPreview(prSummary, 10).map((line) => `  ${line}`));
  } else {
    lines.push('pr-summary.md: 缺失');
  }
  lines.push('');

  if (qaAcceptance) {
    lines.push('qa-acceptance.md:');
    lines.push(...trimPreview(qaAcceptance, 10).map((line) => `  ${line}`));
  } else {
    lines.push('qa-acceptance.md: 缺失');
  }
  lines.push('');

  const extraFiles = existsSync(issueDir)
    ? readdirSync(issueDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort()
    : [];
  lines.push(`目录文件: ${extraFiles.length > 0 ? extraFiles.join(', ') : '无'}`);

  const dossierText = readOptionalText(artifactAbsolutePath(guardianDir, record.dossier_path));
  if (!dossier && dossierText) {
    lines.push('', 'dossier 原始文本预览:');
    lines.push(...trimPreview(dossierText, 8).map((line) => `  ${line}`));
  }
  return lines;
}
