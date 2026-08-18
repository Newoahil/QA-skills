# QA Guardian 部署指南（常驻值守 + 飞书回调）

本文覆盖两个可独立部署的组件：

1. **常驻 scheduler**（`scheduler.mjs`）——在有工作区的机器上轮询 issue、跑 `qa-guardian` agent、发通知。
2. **飞书回调服务**（`callback-server.mjs`）——部署到云（Dokploy/docker compose），把飞书卡片按钮点击翻译成 GitHub issue 的 `/guardian <verb>` 评论。

两者通过 **GitHub issue 评论解耦**，不直接互连：回调服务写评论 → 下一轮 scheduler poll 消费评论 → 驱动下一步。

---

## 前置条件

| 组件 | 依赖 |
|---|---|
| scheduler | node ≥ 18、`gh`（已认证）、`git`、目标仓库已 clone 到本地 |
| callback 服务 | Docker / Dokploy；公网 HTTPS 域名；飞书自建应用；仓库级 fine-grained PAT |

---

## 一、常驻 scheduler

### 1. 配置 `.qa/guardian/config.json`

在目标仓库根目录：

```json
{
  "poll_interval_ms": 60000,
  "lease_ms": 1800000,
  "base_branch": "dev",
  "command_authors": ["goudaren0528"],
  "notify_webhook": "https://open.feishu.cn/open-apis/bot/v2/hook/XXXX",
  "notify_channel": "feishu"
}
```

| 键 | 含义 | 默认 |
|---|---|---|
| `poll_interval_ms` | 轮询间隔（毫秒） | 60000 |
| `lease_ms` | N=1 锁租约（毫秒），运行中每 30s 心跳续租 | 1800000（30 分钟） |
| `base_branch` | PR 目标分支 | dev |
| `command_authors` | **可信命令作者白名单（安全必填）**。只有名单内 GitHub 登录名发的 `/guardian` 命令才生效；**未配置则任何命令都不生效（fail-closed）** | 无 |
| `notify_webhook` | 通知 webhook 地址（飞书自定义机器人或通用 webhook） | 无（降级为只发 issue 评论） |
| `notify_channel` | `generic`（原始 JSON）或 `feishu`（交互卡片） | generic |

> ⚠️ **`command_authors` 不配 = 所有 `/guardian` 命令失效**。这是有意的安全默认，防止任意评论（含伪造回调）批准 HIGH 风险方案。至少填入你自己的 GitHub 登录名。

### 2. 启动

```powershell
# Windows（PATH 若缺失先补）
$env:PATH = "C:\Users\ttx\AppData\Local\nvm\v24.19.0;C:\Program Files\GitHub CLI;C:\Program Files\Git\cmd;C:\Program Files\Git\bin;" + $env:PATH
node tools\guardian\scheduler.mjs --repo D:\你的项目
```

```bash
# Linux/macOS
node tools/guardian/scheduler.mjs --repo /path/to/repo
```

- N=1：同一时刻只跑一个活跃 issue（原子锁 + 心跳续租，长运行不会被误判过期）。
- gate/STALLED/HANDED_BACK 事件会自动发通知（幂等，同状态不重复推）。
- 优雅退出：Ctrl-C / SIGTERM；进程被强杀时锁按租约自动回收。

### 3. 常驻化（可选）

- Linux：systemd service 或 `pm2 start tools/guardian/scheduler.mjs -- --repo /path`。
- Windows：任务计划程序（开机启动）或 nssm 包装为服务。

---

## 二、飞书回调服务（Dokploy / docker compose）

### 1. 建飞书自建应用

飞书开放平台 → 创建企业自建应用 → 记录：
- App ID、App Secret
- 事件订阅：Verification Token、Encrypt Key
- 开通「接收消息卡片回传交互」相关权限

> 如果 App Secret 曾经泄露过，**先在控制台重置**，再填入部署环境。

### 2. 建 GitHub fine-grained PAT

- 仅授权目标仓库（如 `LambdaTheory/tuantuanrent`）
- 权限：**Issues → Read and write**（仅此，最小权限）

### 3. Dokploy 部署

用 `tools/guardian/docker-compose.yml`（build context = 仓库根），配置以下环境变量（**不要写进 git**）：

| 环境变量 | 值 |
|---|---|
| `FEISHU_VERIFICATION_TOKEN` | 飞书事件订阅 Verification Token |
| `FEISHU_ENCRYPT_KEY` | 飞书事件订阅 Encrypt Key |
| `GITHUB_TOKEN` | 上面的 fine-grained PAT |
| `GITHUB_REPO` | `owner/name`，如 `LambdaTheory/tuantuanrent` |
| `PORT` | 可选，默认 8787 |
| `CALLBACK_PATH` | 可选，默认 `/feishu/callback` |
| `MAX_BODY_BYTES` | 可选，请求体上限，默认 65536 |

部署后 Dokploy 会给一个公网 HTTPS 域名。

### 4. 回填飞书事件订阅回调地址

飞书应用 → 事件订阅 → 请求地址填：

```
https://<你的 dokploy 域名>/feishu/callback
```

飞书会发 `url_verification` challenge，服务校验 token 后回 challenge 完成握手。

### 5. 健康检查

```
GET https://<域名>/healthz  →  {"ok":true}
```

Dockerfile 内置 healthcheck 已指向该端点。

### 安全边界（已内建）

- 所有卡片回调**强制签名校验**（sha256 + 常量时间比较 + 5 分钟防重放 + 严格 timestamp）。
- verb 白名单：只允许 approve/revise/reject/rework/retry。
- 回调**只写 `/guardian <verb>` 评论**，绝不 merge/close/改代码。
- 请求体大小上限（超限 413），签名前不缓冲大 body。
- event_id 原子去重（发评论前占位，失败回滚）。
- **双重授权**：即使回调写了评论，scheduler 侧仍用 `command_authors` 校验评论作者——回调服务写评论用的 GitHub 身份必须在 `command_authors` 白名单里，命令才会被 poller 采纳。

---

## 本地开发（不部署）

密钥可放 gitignored 文件而非环境变量：

```
tools/guardian/secrets.json   （参考 secrets.example.json）
或 .qa/guardian/secrets.json
```

env 优先于文件。两者都不进 git。

---

## 端到端链路总览

```
飞书群 ──卡片按钮点击──▶ 回调服务(云) ──验签+白名单──▶ gh REST 写 /guardian <verb> 评论
                                                              │
GitHub issue ◀───────────────────────────────────────────────┘
     │
     └──轮询消费(作者授权校验)──▶ scheduler(本机) ──▶ opencode run qa-guardian ──▶ 下一步 + 通知回飞书
```
