# SyberMem Index

This file summarizes all project changes, decisions, requirements, and bug records.

---

## Key Conclusions

<!-- One-line core conclusion per record. Format: [id] #topic1 #topic2 — description (date) -->
<!-- add new conclusions here -->
- [change-5abf095ac5524443a5d7a9038a01a1e8] #qa-guardian #security #concurrency — 修复 review-work 发现的阻塞项——命令作者授权 fail-closed、N=1 原子锁+心跳续租、spawn 去 shell、回调 timestamp/去重/体积硬化，消除“任意评论可批准 HIGH 方案”授权漏洞与租约竞态，121/121 测试通过。 (2026-08-18)

## Archived Conclusions

<!-- Not injected at session start; findable via /sybermem-search -->
<!-- Suffix each line with: [superseded by <id>] or [compressed in <id>] or [archived] -->
<!-- add new archived conclusions here -->

---

## Phase Digests

| Number | Date | Title | Status | Coverage | Link |
|--------|------|-------|--------|----------|------|
<!-- add new digest records here -->

---

## Theme Digests

| Number | Date | Theme | Status | Coverage | Link |
|--------|------|-------|--------|----------|------|
<!-- add new theme digest records here -->

---

## Feature Changes

| ID | Date | Title | Status | Link |
|----|------|-------|--------|------|
<!-- add new records here -->
| change-5abf095ac5524443a5d7a9038a01a1e8 | 2026-08-18 | QA Guardian 安全+并发修复第一批（授权/锁/去 shell/回调硬化） | done | [link](changes/2026-08-18-change-5abf095ac5524443a5d7a9038a01a1e8-guardian-security-concurrency-batch1.md) |

## Technical Decisions

| ID | Date | Title | Status | Link |
|----|------|-------|--------|------|
<!-- add new records here -->

## Requirements / Discussions

| ID | Date | Title | Source | Priority | Link |
|----|------|-------|--------|----------|------|
<!-- add new records here -->

## Bug Fix Records

| ID | Date | Title | Severity | Link |
|----|------|-------|----------|------|
<!-- add new records here -->

## Usage

- **changes/**: Record all feature changes
- **decisions/**: Record important technical decisions and their rationale
- **requirements/**: Record discussion processes, requirement sources, and design reasoning
- **bugs/**: Record bug analysis and fix approaches
- **analysis/phase-index.md**: Persistent project phase analysis state used to track candidates, confirmed phases, and incremental analysis progress

`.sybermem/INDEX.md` is derived from canonical record files. Use `sybermem project index build` to regenerate it and `sybermem project index check` to verify it is current.

---

## Topic Index

<!-- Auto-maintained: maps topic tags to record IDs for fast lookup -->
- concurrency: change-5abf095ac5524443a5d7a9038a01a1e8
- qa-guardian: change-5abf095ac5524443a5d7a9038a01a1e8
- security: change-5abf095ac5524443a5d7a9038a01a1e8
