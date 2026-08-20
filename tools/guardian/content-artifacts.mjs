import { readMarkdownArtifact } from './artifacts.mjs';
import { assertMarkerIsNotCommand } from './verdict-comment.mjs';

const CJK = /[\u3400-\u9fff]/;
const SECRET_LIKE = /(?:ghp_|github_pat_|AKIA|BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|password\s*=|token\s*=|secret\s*=)/i;

export const PR_SUMMARY_SECTIONS = Object.freeze([
  '## PR 概述',
  '## 本次变更内容',
  '## SQL / 数据库影响',
  '## 关联脚本与配置文件',
  '## 测试与验证说明',
]);

export const QA_ACCEPTANCE_SECTIONS = Object.freeze([
  '## QA 验收结论',
  '## 验收依据',
  '## 风险与未覆盖项',
  '## 下一步',
]);

function assertChineseMarkdown(name, text, sections) {
  const content = String(text ?? '').trim();
  if (content.length === 0) throw new Error(`${name} artifact is empty`);
  if (!CJK.test(content)) throw new Error(`${name} artifact must be written in Chinese`);
  for (const section of sections) {
    if (!content.includes(section)) throw new Error(`${name} artifact missing section: ${section}`);
  }
  if (SECRET_LIKE.test(content)) throw new Error(`${name} artifact contains secret-like text`);
  assertMarkerIsNotCommand(content);
  return content;
}

export function readRequiredPrSummary(guardianDir, issue) {
  const content = readMarkdownArtifact(guardianDir, issue, 'pr-summary');
  if (content === null) throw new Error(`missing required pr-summary artifact for issue #${Number(issue)}`);
  return assertChineseMarkdown('pr-summary', content, PR_SUMMARY_SECTIONS);
}

export function readRequiredQaAcceptance(guardianDir, issue) {
  const content = readMarkdownArtifact(guardianDir, issue, 'qa-acceptance');
  if (content === null) throw new Error(`missing required qa-acceptance artifact for issue #${Number(issue)}`);
  return assertChineseMarkdown('qa-acceptance', content, QA_ACCEPTANCE_SECTIONS);
}
