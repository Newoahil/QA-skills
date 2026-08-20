#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { guardianDirFor, hasGuardianDir } from './dashboard-model.mjs';
import { guidedError } from './dashboard-errors.mjs';
import { fetchTranscript, formatTranscript, resolveSessionId } from './session-transcript.mjs';
import { resolveViewerRepo } from './worktree-binding.mjs';

const DEFAULT_BASE_URL = process.env.OPENCODE_BASE_URL ?? 'http://localhost:3000';

function usage() {
  return `QA Guardian 会话查看器（只读）

用法:
  node tools/guardian/session-view.mjs --session <ses_xxx>
  node tools/guardian/session-view.mjs --repo <项目> --issue <编号> --agent <角色>

参数:
  --session <id>       直接查看 OpenCode session
  --repo <path>        目标项目路径，用于从 .qa/guardian 状态查找 session
  --issue <n>          GitHub issue 编号
  --agent <role>       角色：fixer、qa，或专家角色名（如 code/business/runtime/docs/history/plan-critic）
  --base-url <url>     OpenCode 服务地址；默认读取 OPENCODE_BASE_URL，否则 ${DEFAULT_BASE_URL}
  --full               显示完整内容，包括工具结果，不截断长文本
  --json               输出原始消息 JSON
  --help               显示本帮助

示例:
  node tools/guardian/session-view.mjs --repo D:\\项目 --issue 42 --agent fixer
  node tools/guardian/session-view.mjs --session ses_abc123 --full
`;
}

function parseCli(argv) {
  return parseArgs({
    args: argv,
    options: {
      session: { type: 'string' },
      repo: { type: 'string' },
      issue: { type: 'string' },
      agent: { type: 'string' },
      'base-url': { type: 'string' },
      full: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  }).values;
}

async function main() {
  const args = parseCli(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  let sessionId = args.session;
  let issue = args.issue ? Number(args.issue) : null;
  let role = args.agent ?? '';
  if (!sessionId) {
    if (!args.repo || !issue || !args.agent) {
      console.error(guidedError('missing-argument', { reason: '请提供 --session，或同时提供 --repo、--issue、--agent。' }));
      process.exit(2);
    }
    const requestedRepo = path.resolve(args.repo);
    const repoDir = resolveViewerRepo(requestedRepo, path.join(path.dirname(fileURLToPath(import.meta.url)), 'scheduler.config.json'));
    if (!hasGuardianDir(repoDir)) {
      console.error(guidedError('no-guardian-dir'));
      process.exit(2);
    }
    const resolved = resolveSessionId(guardianDirFor(repoDir), issue, args.agent);
    if (resolved.kind === 'missing-issue') {
      console.error(guidedError('no-issue-state', { issue }));
      process.exit(2);
    }
    if (resolved.kind === 'missing-session') {
      console.error(guidedError('no-session', { issue, role: resolved.role, state: resolved.record.state }));
      process.exit(2);
    }
    sessionId = resolved.sessionId;
    role = resolved.role;
  }
  const result = await fetchTranscript(sessionId, { baseUrl: args['base-url'] ?? DEFAULT_BASE_URL });
  if (result.kind !== 'ok') {
    console.error(result.error);
    process.exit(1);
  }
  if (args.json) {
    console.log(JSON.stringify(result.messages, null, 2));
    return;
  }
  console.log(formatTranscript(result.messages, { sessionId, issue, role, full: args.full }));
}

if (process.argv[1]?.endsWith('session-view.mjs')) {
  main().catch((error) => {
    const reason = error instanceof Error ? error.message : '未知错误';
    console.error(guidedError('session-fetch-error', { kind: reason }));
    process.exit(1);
  });
}
