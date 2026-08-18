---
type: change
record_id: change-5abf095ac5524443a5d7a9038a01a1e8
date: 2026-08-18
title: QA Guardian 安全+并发修复第一批（授权/锁/去 shell/回调硬化）
status: done
source: review-work 5-agent 评审（3 名 oracle FAIL）
key_conclusion: 修复 review-work 发现的阻塞项——命令作者授权 fail-closed、N=1 原子锁+心跳续租、spawn 去 shell、回调 timestamp/去重/体积硬化，消除“任意评论可批准 HIGH 方案”授权漏洞与租约竞态，121/121 测试通过。
topics: [qa-guardian, security, concurrency]
author: Sisyphus
related_files: [tools/guardian/commands.mjs, tools/guardian/state-router.mjs, tools/guardian/poll.mjs, tools/guardian/scheduler.mjs, tools/guardian/lock.mjs, tools/guardian/feishu-callback.mjs, tools/guardian/callback-handler.mjs, tools/guardian/callback-server.mjs]
---

## Change Content

review-work 五路评审对 QA Guardian（分支 auto-qa）判 FAIL，本批修复第一优先级的安全与并发阻塞项：

1. 命令作者授权（安全红线）：`selectCommand` / `routeIssue` / `pollIssue` 新增 `trustedAuthors` 白名单，fail-closed（未配置则任何 `/guardian` 命令都不生效）。`poll.mjs` 的 gh reader 增加 comment `author`；config 新增 `command_authors`。
2. N=1 原子锁：新增 `lock.mjs`，用独占创建（open `wx`）原子获取、per-acquire token owner 校验、心跳续租（运行中每 30s renew）、只清自己的锁；`scheduler.mjs` 改用它，替换原“读后写”竞态锁。
3. spawn 去 shell：新增 `invocationArgvFor` 返回 argv 数组；`scheduler.mjs` 用 `spawn(cmd, args, {shell:false})`，消除 issue 派生 prompt 的 shell 注入面。
4. 回调硬化：`feishu-callback.mjs` 拒绝非正整数 timestamp（先于 skew 检查）；`callback-handler.mjs` 在 postComment 前原子占位 event_id、失败回滚；`callback-server.mjs` 请求体大小上限 → 413，且 500 不再回显 e.message。

## Reason for Change

3 名 oracle 评审一致指出：poller 把任意 issue 评论都当命令 → 被抓包/重放的 approve 或任意人手打 `/guardian approve` 可批准 HIGH 风险方案（授权漏洞，HIGH）；N=1 只靠租约不续租 → 长运行被判死、并发启动第二个 issue（分支冲突）；`spawn(shell:true)` 保留注入面；回调无体积上限、timestamp 校验不严、去重非原子且进程内。

## Impact Scope

QA Guardian 控制面与飞书回调服务：命令消费授权、调度并发、子进程启动、公网回调入口。不影响业务仓库代码。向后行为变更：未配置 `command_authors` 时命令一律不生效（安全默认），需在 `.qa/guardian/config.json` 配置可信作者。

## Implementation

见 related_files。新增 `lock.mjs` + `lock.test.mjs`；`commands.mjs`/`state-router.mjs`/`poll.mjs`/`scheduler.mjs` 串联 trustedAuthors；`poll.mjs` 增 `invocationArgvFor` + `readGuardianConfig`；回调三文件硬化。

## Test Verification

`node --test "tests/guardian/*.test.mjs"` → 121/121 pass（新增作者授权 6、lock 8、回调硬化/argv 若干）。全模块 `node --check` clean。回调服务端到端冒烟：healthz 200、url_verification challenge、无签名 401、超限 413 且服务存活。

## Notes

这是三批修复的第一批（安全+并发）。第二批：把通知投递接进 scheduler tick（FR-21）+ bootstrap/DEPLOY；第三批：文档（README/config/飞书/验收用例/设计）。全程保持在 auto-qa 分支。
