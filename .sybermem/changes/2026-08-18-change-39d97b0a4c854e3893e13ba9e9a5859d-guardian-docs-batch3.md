---
type: change
record_id: change-39d97b0a4c854e3893e13ba9e9a5859d
date: 2026-08-18
title: QA Guardian 文档收尾第三批（README/验收用例/设计文档对齐）
status: done
source: review-work 5-agent 评审（上下文挖掘 IMPORTANT：文档过时/缺口）
key_conclusion: 修复 review-work 文档缺口——README 更正 scheduler 已交付状态+补运行段+config 键表+作者授权安全项，验收用例新增 UC-H..UC-K（授权/N=1/通知/飞书回调）并把测试数更新到 128，设计文档 §11B.5-a 补记飞书通道/回调/command_authors/FR-21 接线为已交付范围，文档与代码对齐。
topics: [qa-guardian, documentation, deployment]
author: Sisyphus
related_files: [tools/guardian/README.md, docs/qa-guardian-acceptance-usecases.md, docs/qa-guardian-requirements-and-design.md]
related: [change-c4f7796c3fa940589c4c90921c26455c]
---

## Change Content

review-work 上下文挖掘判 IMPORTANT 的文档过时/缺口，本批（第三批，非阻塞收尾）修复：

1. `tools/guardian/README.md`：把「scheduler/cron 是 documented follow-up」的过时说明改为「已交付，两种运行方式」；「What's here」表补齐全部新模块（scheduler/scheduler-core/lock/notify-feishu/notify-io/feishu-callback/callback-*/github-comment/secrets）；Prerequisites 的 config 段扩成完整键表（含 `command_authors` fail-closed 必填提醒、`poll_interval_ms`/`lease_ms`/`base_branch`/`notify_channel`）；新增「Run the resident scheduler」段；安全模型补「命令作者授权 fail-closed」。
2. `docs/qa-guardian-acceptance-usecases.md`：新增 UC-H（命令作者授权 fail-closed）、UC-I（常驻 scheduler + 真实 N=1）、UC-J（通知投递真实发出 FR-21）、UC-K（飞书卡片回调→GitHub 评论端到端 + 安全核查）；验收结论模板测试数 59→128 并补 4 个勾选项。
3. `docs/qa-guardian-requirements-and-design.md`：§11B.5 后新增 §11B.5-a「已交付实现」，记录飞书通道、卡片按钮回调服务、command_authors 双重授权、FR-21 投递接线为超出原「通用 webhook」设计的落地范围。

## Reason for Change

评审指出：README 给运维错误的产品状态（说 scheduler 是未来工作，实际已 ship）且缺运行说明与 config 键文档；验收用例未覆盖 scheduler/N=1/飞书；设计文档 §11B.5 只写通用 webhook，飞书回调（按钮→GitHub 评论）与 command_authors 属 scope-beyond-design 未回写。文档与代码不一致会误导使用者。

## Impact Scope

纯文档，无代码/行为变更。使 README/验收/设计文档与第一、二批实现对齐。

## Implementation

见 related_files。均为 Markdown 内容更新；中文渲染已核查无 `????` 乱码。

## Test Verification

无代码改动;回归 `node --test "tests/guardian/*.test.mjs"` → 128/128 仍 pass。抽查关键中文段落（§11B.5-a、UC-K）存在;四个文档无 `????` 乱码。

## Notes

三批修复的第三批（文档收尾，非阻塞）。前置：第二批运维就绪（change-c4f7796c3fa940589c4c90921c26455c）、第一批安全+并发（change-5abf095ac5524443a5d7a9038a01a1e8）。至此 review-work 的阻塞项（安全/并发/运维）与非阻塞项（文档）三批全部修复完毕，全程 auto-qa 分支。
