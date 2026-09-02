# QA Skill

`qa-skill` 是面向单个 bounded requirement / fix / Diff 的**证据优先 QA prior**：它约束 verdict 边界与取证原则，不是固定 SOP，也不是“全项目 QA 模式”声明。

当前主入口与分工：

- `qa`：唯一 verdict owner，负责汇总证据并输出唯一 `Overall Status:`。
- `qa-cr`：静态、无 shell 的 CR evidence worker。
- `qa-api`：有界、非浏览器 HTTP/API runtime evidence worker。
- `qa-e2e`：浏览器 / 用户流 evidence worker。

## 当前行为边界

- **代码变更默认 CR-first**：先做 `qa-cr`（或 `qa` 的极小范围 inline CR-like review）。
- **唯一例外**：只有在建立 oracle / trigger / scope 所必需时，才允许先做一次**最小、有界** pre-CR runtime diagnostic。
- **load-bearing CR FAIL 会停止后续重型取证**：验证过的 CR `FAIL` 会直接阻断后续 API / e2e 重证据。
- **truthful boundary**：
  - `qa` / `qa-cr`：`edit` deny + `bash` deny。
  - `qa-api` / `qa-e2e`：`edit` / `task` / `web` deny，但因可用较宽 `bash`，它们的 repository read-only / local-only 只是**policy boundary**，不是完美沙箱。
- QA 不写产品代码、不代替 ship / release decision。

## 安装

安装时请带上当前主路径，不要只复制单个文件：

- `qa-skill/SKILL.md`
- `qa-skill/references/`
- `qa-skill/scripts/`
- `qa-skill/agents/qa.md`
- `qa-skill/agents/qa-cr.md`
- `qa-skill/agents/qa-api.md`
- `qa-skill/agents/qa-e2e.md`

放置到你的 OpenCode skills / agents 配置路径后，**修改 config 或 agent 文件后请重启 OpenCode**。

历史 / archive 文件仅供参考，**不是推荐安装路径**。

## 调用示例

- CLI：`opencode run --agent qa --dir <repo> "QA this bounded change: <expected behavior>"`
- TUI：`@qa`
- 作为子 agent：派发 `qa`

更多说明见 [`qa-skill/README.md`](qa-skill/README.md)。
设计与值守闭环开发文档见 [`docs/QA-skill值守闭环Agent开发文档.md`](docs/QA-skill值守闭环Agent开发文档.md)。

## 当前验证状态

- 当前验证证据：**61 total = 49 pass + 12 opt-in skipped**。
- `e2e-runner`：**10 / 10** 通过。
- 已有 **12 个 opt-in real paired scenarios**，且都带预期 outcome。
- real model evals **依赖环境**，不是所有环境都保证直接稳定复现。

这是当前 primary entry README；过时的 `qa-facet`、`using-qa`、full-project mode、以及机制层“[焊死]”宣称都不再作为这里的推荐表述。
