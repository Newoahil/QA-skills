---
type: bug
record_id: bug-19e5ffff30db46ccbca9f8ca73551ad1
source: Phase 11 final review
severity: high
status: partially-resolved
key_conclusion: Phase 11 发现生产镜像可能包含本地 secrets、unattended 默认 legacy 绕过 plan gate、stale lock takeover 非原子和 non-idempotent STALLED rerun 风险；本批已加 .dockerignore/env-only production loader、enforced 默认、原子 stale-lock takeover 和 stall guard，仍待 QA machine enforcement/timeout/state persistence。
topics: [qa-guardian, security, runtime]
---

## Bug Description

Strong Unattended Guardian final review 发现安全和可靠性阻塞项。

## Root Cause

生产 Dockerfile 的宽泛 COPY 可能把 ignored secrets 带入镜像；scheduler 默认 legacy；stale lock 通过 read-then-write takeover；FIXING/VERIFYING stalled 阶段无 clean-branch guard。

## Solution

已加 `.dockerignore`、production env-only secret loading、enforced 默认、atomic rename+exclusive stale lock takeover、non-idempotent STALLED 不自动 rerun。外部真实凭证仍需用户 rotate。

## Prevention Measures

生产 secrets 只用平台环境变量；无人值守默认 enforced；锁 takeover 必须原子；后续接入 child timeout、state failure persistence 和 machine-readable QA PASS。

## Related Changes

Review fixes on auto-qa after Phase 11; tests 192/192 pass。
