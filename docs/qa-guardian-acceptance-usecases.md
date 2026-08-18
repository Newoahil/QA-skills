# QA Guardian 验收使用用例

> 配套实现:`qa-skill/agents/qa-guardian.md` + `tools/guardian/*` + `tests/guardian/*`
> 设计来源:[`qa-guardian-requirements-and-design.md`](./qa-guardian-requirements-and-design.md) §8 验收标准
> 本文把 §8 的 28 条验收标准落成**可执行的用例**,分成两层:L1 无需 gh 现在就能跑,L2 需要 gh + 真实 issue。

---

## 分层总览

| 层 | 依赖 | 覆盖验收项 | 现在能跑? |
|---|---|---|---|
| **L1 确定性逻辑** | 仅 node | 9–12, 14, 19–26(分级/状态机/闸门恢复/通知的判定) | ✅ 是 |
| **L2 真实端到端** | gh 认证 + 打标签的 issue + opencode | 1–8, 13, 15–18, 27–28(整条 issue→PR 链路) | 需先 bootstrap |

---

## 准备:一键 bootstrap

```powershell
# Windows(注意 ExecutionPolicy)
powershell -NoProfile -ExecutionPolicy Bypass -File tools\guardian\bootstrap.ps1 -TargetRepo <你的仓库> [-NotifyWebhook https://...]
```
```bash
# Linux / macOS
tools/guardian/bootstrap.sh --target <你的仓库> [--webhook https://...]
```

bootstrap 会:装 3 个 agent 到全局、装 qa-skill、给目标仓库写 `subagent_depth:2`、建 `.qa/guardian/` + `config.json`、跑一遍 L1 测试。它**不会**替你装/认证 gh,也不会替你打 issue 标签(这两件只有你能做)。

---

## L1:确定性逻辑用例(现在就能跑,零 GitHub)

一条命令跑全部:

```powershell
node --test "tests/guardian/*.test.mjs"
# 预期:tests 59 / pass 59 / fail 0
```

对应验收项映射:

| 用例 | 验证什么 | 验收项 | 对应测试 |
|---|---|---|---|
| U1 明确低风险 → LOW | 全部白名单命中才 LOW | §8-12 | `risk-grading` clear-low |
| U2 信息不足 → HIGH | fail-safe,拿不准默认高 | §8-11 | `risk-grading` fail-safe |
| U3 碰权限/金额 → HIGH | 任一高危面强制 HIGH | §8-10 | `risk-grading` every-surface |
| U4 单个白名单缺失 → HIGH | AND 语义,漏一条即高 | §5A | `risk-grading` each-missing-clause |
| U5 issue 要求扩大范围 → HIGH | 注入防护 | §12 | `risk-grading` scope-expansion |
| U6 GATE_1 + approve → FIXING | 闸门1续跑 | §8-19 | `state-router` approve |
| U7 GATE_1 + reject → HANDED_BACK | 拒绝转终态 | §8-20 | `state-router` reject |
| U8 HANDED_BACK 默认永久跳过 | 不反复骚扰 | §8-20 | `state-router` handed-back-skip |
| U9 HANDED_BACK + retry → INVESTIGATING | 显式重进清 fix_rounds | §8-21 | `state-router` retry |
| U10 GATE_2 + rework → FIXING | 闸门2打回 | §8-22 | `state-router` rework |
| U11 GATE_2 + issue closed → DONE | 人 merge 触发关闭 | §8-9 | `state-router` merged-closed |
| U12 错状态指令被忽略 | 幂等/状态守卫 | §8-23 | `commands` wrong-state |
| U13 已消费指令不重复触发 | 幂等消费 | §8-23 | `commands` idempotent + absent-id |
| U14 `<方案>` 当数据不执行 | 注入防护 | §8-23 | `commands` data-tail-not-executed |
| U15 活跃态租约过期 → STALLED | 静默卡死兜底 | §8-25 | `state-router` lease-expired |
| U16 STALLED 超重试上限 → HANDED_BACK(stalled) | 不无限烧钱 | §8-25 | `state-router` stall-retry |
| U17 活跃态心跳新鲜 → SKIP | 去重不重复接手 | §8-14 | `state-router` fresh-lease |
| U18 通知双通道 + 缺 webhook 降级 | §11B.5 | §8-26 | `notify` dual-channel/degrade |
| U19 同状态不重复推 | 通知幂等 | §8-26 | `notify` idempotent |
| U20 通知 body 无代码/密钥 | 联网豁免边界 | §8-28 | `notify` safe-body |
| U21 状态文件全字段 round-trip | 持久化正确 | §11A.3 | `state` round-trip |

### L1 手动单点验证(可选,直观看路由结论)

不连 GitHub,直接看某个状态下 poller 的决策 —— 用桩数据:

```powershell
# 例:GATE_1_WAIT 且有人评论了 /guardian approve → 应输出 RESUME/FIXING
# (poll.mjs 默认会调真 gh;要纯路由请跑上面的 node --test,或临时写桩脚本)
```

---

## L2:真实端到端用例(需 gh + 真实 issue)

前置:`gh auth status` 通过;目标仓库你有 push 权限、存在 `dev` 分支;已 bootstrap。

### UC-A 低风险全自动到 PR(§8 项 1,4,5,7,8,9,12)

1. 造一个明确低风险 bug issue(例:某处日志文案/注释错误),打标签 `qa-guardian`。
2. 运行:
   ```bash
   opencode run --agent qa-guardian --dir <repo> \
     "Watch GitHub issue #<n>: investigate root cause, assess risk, dispatch read-only qa, open a dev PR, stop at gate 2."
   ```
3. **预期观察点:**
   - issue 评论出现**诊断 + 判 LOW 的理由**(命中白名单哪几条),但**不停闸门1**。
   - 新分支 `fix/issue-<n>`,只有最小改动。
   - 有一次**独立 `qa` 子 session**(只读)自验,评论里带 `Overall Status: PASS`。
   - `gh pr create --base dev` 出了 PR,正文含诊断+QA结论+风险等级;commit message 含 `fixes #<n>`。
   - issue 追踪评论含 PR 链接 + commit sha + 风险等级。
   - **停在闸门2**:未 merge、未 close issue。
4. **通过判据:**上述全部出现,且 Guardian 进程已退出(未继续动代码)。

### UC-B 高风险停闸门1(§8 项 3,10)

1. 造一个明显高风险 issue(触碰权限/金额/核心链路),打标签。
2. 运行同上命令。
3. **预期:** 诊断评论出现,判 `HIGH`,**停在闸门1**,`git log` 显示**未产生任何 fix commit**、无分支改动。
4. 你评论 `/guardian approve` → 再次运行/等下一轮 → 从 FIXING 续跑,后续同 UC-A。
5. **通过判据:** 未确认前零代码改动;确认后才继续。

### UC-C 信息不足默认高风险(§8 项 11,27)

1. 造一个模糊/信息不足的 issue(只说"有点问题",无法复现)。
2. 运行。
3. **预期:** Guardian **不冒进判 LOW**;要么判 `HIGH` 停闸门1,要么落 `HANDED_BACK(reason=needs-clarification)` + 评论 + 通知 + 退出 —— **绝不停在活跃态干等**。
4. **通过判据:** `.qa/guardian/<n>.json` 的 `state` 是显式等待态/终态,不是卡在 `INVESTIGATING`。

### UC-D 修-验循环上限(§8 项 6)

1. 造一个 Guardian 修不对、`qa` 会持续 FAIL 的 issue。
2. **预期:** FIXING↔VERIFYING 最多 1–2 轮;超限 → `HANDED_BACK(reason=fix-rounds-exceeded)`;**FAIL 状态下从不提 PR**。

### UC-E 去重与并发(§8 项 13,14,15)

1. 对一个已在 `GATE_2_WAIT`/已出 PR 的 issue 再跑一次轮询。
2. **预期:** `poll.mjs` 输出 `SKIP`,不重复接手;每 issue 独立分支;MVP N=1 串行。
   ```bash
   node tools/guardian/poll.mjs --repo <repo> --issue <n>
   # → {"action":"SKIP","reason":"gate2-waiting",...}
   ```

### UC-F 机制不被削弱(§8 项 16,17,18,28)

1. 全链路跑完后核查:
   - 无 `qa` 直接 edit 产品文件 / commit 的记录(qa 只读焊死)。
   - issue ↔ commit(`fixes #<n>`)↔ PR 三向可追溯。
   - **任何风险等级下都没有** `gh pr merge` / `gh issue close`。
   - Guardian 只向配置的 `notify_webhook` 发过 `curl`,`webfetch/websearch` 全程零调用。

### UC-G STALLED 真实触发(§8 项 25)

1. 人为让一个 issue 的 Guardian 进程中途死在 `INVESTIGATING`(如强杀)。
2. 等超过 `lease_ms`(默认 30 分钟)后再轮询。
3. **预期:** `poll.mjs` 判 `STALLED`;`INVESTIGATING`(只读幂等)自动重跑 1 次;仍卡则 `HANDED_BACK(reason=stalled)` + 通知。不被当"处理中"无限跳过。

---

## 验收结论模板

跑完后按此勾选:

```
L1 确定性逻辑:  node --test → [ ] 59/59 pass
L2 端到端:
  UC-A 低风险到PR停闸门2       [ ]
  UC-B 高风险停闸门1零改动      [ ]
  UC-C 信息不足不冒进+显式态    [ ]
  UC-D 修-验上限+FAIL不进PR     [ ]
  UC-E 去重/独立分支            [ ]
  UC-F 只读独立性+无merge/close [ ]
  UC-G STALLED兜底             [ ]
总判定: PASS / 待修
```
