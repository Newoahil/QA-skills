---
type: change
record_id: change-f78313d32e614657bce29b72264e20fb
date: 2026-08-21
title: Guardian 只读 TUI 默认只显示当前值守队列
status: done
key_conclusion: Guardian 只读 TUI 默认用 current(active+waiting) 过滤，隐藏 DONE/交回等历史记录，避免误以为在监控已完成/远程已删除的 issue；历史仍保留可按 t 切到 all 审计。
topics: [guardian-tui, dashboard-filter, usability]
author: Sisyphus
related_files:
  - tools/guardian/dashboard-model.mjs
  - tools/guardian/dashboard-tui-model.mjs
  - tools/guardian/dashboard-tui-input.mjs
  - tools/guardian/dashboard-tui.mjs
  - tools/guardian/dashboard-tui-render.mjs
  - tests/guardian/dashboard-model.test.mjs
  - tests/guardian/dashboard-tui-model.test.mjs
  - tests/guardian/dashboard-tui-input.test.mjs
---

## Change Content
为 QA Guardian 只读 TUI 增加队列状态过滤，并把默认视图改为“当前需要关注的队列”：

- `filterByState()` 新增两个语义：`current`（active + waiting）和 `all`（全部，含 terminal）。
- TUI `createInitialUiState()` 新增 `stateFilter`，默认 `current`。
- 新增 `t` 键循环过滤：`current(关注中) → active(处理中) → waiting(等待人工) → all(全部历史)`（`f` 已被 transcript 完整模式占用，故用 `t`）。
- `reduceUiState` 处理 `cycle-state-filter`：切换过滤后清空选中、重置滚动、更新状态栏文案。
- `dashboard-tui.mjs` refresh 使用 `ui.stateFilter`（不再只读 `--state`），过滤变化时触发刷新；`--state` 仍可覆盖初始过滤。
- header / footer / help 显示当前过滤标签（关注中 / 处理中 / 等待人工 / 全部历史）与 `t` 键说明。

## Reason for Change
用户指定的本地项目对应远程仓库已删除 `#193`，但启动 TUI 仍显示 `#193 DONE HIGH`。根因是 TUI 从本地 authoritative control 的 `.qa/guardian/*.json` 读取全部历史状态渲染，而不是 GitHub 当前 open issue 列表；`193.json`（DONE, merged-closed）仍在磁盘。默认展示全部历史会让人误以为 Guardian 仍在监控已完成或远程已删除的 issue。方案是“默认隐藏历史、不删除历史”，保留本地审计记录（PR、QA verdict、diagnosis）。

## Impact Scope
仅影响 Guardian 只读仪表盘/TUI 的展示层与过滤逻辑：`dashboard-model.mjs`、`dashboard-tui-*.mjs`。不改 scheduler、不改状态机、不写 `.qa/guardian` 状态、不动 GitHub/git，只读边界不变。`filterByState(null)` 行为保持不变（返回全部），向后兼容 `active/waiting/terminal/具体状态` 过滤。

## Implementation
- `dashboard-model.mjs`: `filterByState` 增加 `all` 与 `current` 分支。
- `dashboard-tui-model.mjs`: 新增 `DEFAULT_STATE_FILTER='current'`、`STATE_FILTER_CYCLE`、`STATE_FILTER_LABELS`、`stateFilterLabel()`、`nextStateFilter()`；`createInitialUiState` 带入 `stateFilter`；reducer 新增 `cycle-state-filter`。
- `dashboard-tui-input.mjs`: `t/T` → `cycle-state-filter`。
- `dashboard-tui.mjs`: 初始 `stateFilter = args.state ?? DEFAULT_STATE_FILTER`；refresh 用 `ui.stateFilter`；过滤变化触发刷新；usage/键位文案更新。
- `dashboard-tui-render.mjs`: header 增加 `筛选=<label>`，help 与 footer 增加 `t` 说明。

## Test Verification
- 新增/更新单测：`filterByState current/all`、input `t/T` 映射、`createInitialUiState` 默认与 `nextStateFilter` 循环、`cycle-state-filter` reducer、`loadDashboardTuiSnapshot` 默认隐藏 terminal。
- focused（model/tui-model/input/render/cli）：37/37 passed。
- full Guardian suite：503/503 passed。
- `node --check` 全部通过；`git diff --check` 通过（仅 CRLF warning）。
- 真实只读验证（针对实际 control repo `D:\tuantuanrent.qa-guardian-control`）：默认 `current` 队列为空（`#193` 不再显示），`all` 仍返回 `193:DONE`。

## Notes
- `f` 键保留给 transcript 完整模式，故过滤键选 `t`。
- 已知可后续优化（非阻断）：队列滚动 `queueScroll` 未额外 clamp；`logFollow` 用魔法数 `99999` 表示滚到底；`DEFAULT_BASE_URL` 端口不匹配时 transcript 走只读降级提示。
- 该仓库 TypeScript/JS LSP 未安装（先前 declined），以 `node --check` + 全量测试 + 真实 snapshot 替代类型/语法验证。
