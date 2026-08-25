---
type: digest
kind: phase
date: 2026-08-18
number: 002
title: QA Guardian docs, ops readiness & one-click scheduler launchers
status: completed
source_records:
  - changes/2026-08-18-change-39d97b0a4c854e3893e13ba9e9a5859d-guardian-docs-batch3.md
  - changes/2026-08-18-change-5abf095ac5524443a5d7a9038a01a1e8-guardian-security-concurrency-batch1.md
  - changes/2026-08-18-change-c4f7796c3fa940589c4c90921c26455c-guardian-notify-wiring-deploy-batch2.md
  - changes/2026-08-18-change-c783251f5b134af9b8bd7e15628fc7c6-guardian-oneclick-start-target-injection.md
  - changes/2026-08-18-change-d4732a411e254c618517828d62e5ed70-guardian-init-and-bat-launcher.md
  - changes/2026-08-18-change-6ff6c658477b423eae1d6e18a33f92b9-runtime-logging.md
  - changes/2026-08-18-change-66dd4c4f08114b48899480c39d8052a7-new-open-followup.md
  - changes/2026-08-18-change-c79535dd171745ee98a74bae8ca3c2ba-followup-review-regression.md
  - changes/2026-08-18-change-c9452e10a1264645a06915267c49e44d-followup-review-fixes.md
  - changes/2026-08-18-change-386571099b534df8bf7ef7ae67be6c86-feishu-ws-local-runtime.md
  - bugs/2026-08-18-bug-1a88afaf58fe4f13859d209b49b49027-dokploy-port-collision.md
  - bugs/2026-08-18-bug-541a9d6211594221-bat-chinese-output.md
  - bugs/2026-08-18-bug-9df5a75c67504f4fac0d315dd7cef2dd-bat-fallthrough.md
  - bugs/2026-08-18-bug-addaeb3484574da4898bc2d0d5a022d6-target-repo-fallback.md
coverage:
  from: 2026-08-18
  to: 2026-08-18
coverage_hash: 811cf4d6ceaa74bb46a00a2e83907205e2372e70fe5d690d01797e28510ea508
---

## Phase Scope
Turning the plan-gated Guardian core into something a new operator can actually deploy and run: security/concurrency fixes from independent review, notification delivery wired into the scheduler tick, deploy docs, the Feishu WebSocket channel, and the first generation of one-click Windows/PowerShell launchers with target-repo injection.

## Core Conclusions
- Command-author authorization is **fail-closed** and the scheduler holds an **N=1 atomic lock with heartbeat renewal**; the earlier "any comment can approve a HIGH plan" authorization hole and the lease race were closed, and `spawn` was de-shelled.
- Notification delivery (`notify-io.mjs`: `gh` comment + curl webhook) is wired into the scheduler tick with idempotent `last_notified_state` persistence, satisfying FR-21 so a resident scheduler and Feishu callback can be deployed by a new user.
- The **target business repository is resolved by three-tier injection**: CLI `--repo` > env `QA_GUARDIAN_REPO` > side-placed `scheduler.config.json` > cwd, with `resolveRepoDir` extracted for testability.
- The Feishu channel uses the **official Feishu Node SDK WebSocket** (`card.action.trigger`) with a shared action executor; one guardian-runtime process starts one scheduler + one WS, and the HTTP callback path is retained for compatibility.
- `watch_mode=new-open` auto-discovers issues created after the watcher starts; DONE / GATE_2_WAIT issues are not silently re-processed, and `/guardian followup` opens a new acceptance round.
- Runtime I/O is **BOM-safe**: unified JSON reads tolerate PowerShell-written BOM configs, structured JSONL stderr logging never leaks secrets, and a DEVer banner improves first-run experience.
- Windows launcher bugs are a recurring hazard class: Dokploy port collision (host `8787` hardcoded → expose-only + reverse proxy), bat fall-through re-invoking PowerShell, CJK encoding requiring UTF-8 BOM scripts + `chcp 65001`, and a wrong-`target_repo` fallback when double-clicked from the tools dir.

## Key Decisions and Changes
- `scheduler-start.ps1`/`.sh` one-click start (auto-PATH, node resolution, `command_authors` validation) plus `-Init`/`-CommandAuthors`/`-BaseBranch` one-step config creation (BOM-free UTF-8) and a `scheduler-start.bat` double-click entry.
- Security+concurrency batch (fail-closed authorization, N=1 atomic lock + heartbeat, de-shelled spawn, callback timestamp/dedupe/size hardening).
- Notify-io wiring + DEPLOY.md + bootstrap; `.env.example` and Dokploy/local-compose callback deployment checklist.
- Feishu WebSocket runtime + shared action executor; DONE-followup empty-input and Gate-1/Gate-2 notification-reachability fixes with UC-L regression.
- Docs batch 3 aligned README/acceptance-cases/design with delivered scheduler + authorization + Feishu callback scope.

## Current State
Guardian is deployable by a new operator on Windows (double-click) and on a Dokploy host, with notifications, Feishu callbacks, and target-repo injection working. Test counts across the batches landed in the 128–153 range. The Windows launcher story continues and matures in digest-005.

## Recommended Next Reads
- digest-005 — the next generation of Windows launcher / worktree / PowerShell fixes.
- digest-001 — the plan-gated core these ops layers wrap.
- digest-007 — later runtime reliability (provider resilience, deadlines, locks).

## Source Coverage
14 records (10 changes + 4 bugs), all dated 2026-08-18, covering docs/ops readiness, notifications, the Feishu channel, and first-generation launchers.
