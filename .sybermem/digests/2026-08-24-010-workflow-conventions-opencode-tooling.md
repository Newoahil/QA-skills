---
type: digest
kind: phase
date: 2026-08-24
number: 010
title: Project workflow conventions & OpenCode tooling config
status: completed
source_records:
  - decisions/2026-08-21-decision-038091b9b1ca447db6c8a2d2a86719b4-commit-clean-after-every-edit.md
  - changes/2026-08-24-change-e7c66175f6064aa2af79e23ac1d22ff9-opencode-websearch-lsp-tooling.md
coverage:
  from: 2026-08-21
  to: 2026-08-24
coverage_hash: a01597cdd67d8e22e00922cde84a10cc617f8f1f62eb364d31757107c243f6d1
---

## Phase Scope
Cross-cutting project conventions and local development tooling that are not part of the Guardian feature arc but govern how work is done in this repository.

## Core Conclusions
- **Commit-clean-after-every-edit is a binding project rule**: every change in QA-skills (including SyberMem records and a rebuilt INDEX.md) must be committed to a clean working tree immediately, because the Guardian scheduler preflight requires the tools repo to be clean to start — a dirty tree directly blocks `guardian-start`.
- **OpenCode project tooling is configured for reliable local diagnostics**: the unauthenticated default websearch MCP is disabled and working TypeScript/Markdown LSP servers are configured, so local diagnostics no longer fail with SSE 405, missing `tsserver`, or Markdown-server startup errors.

## Key Decisions and Changes
- Decision: commit-clean discipline tied to Guardian preflight.
- Change: OpenCode websearch disabled + TypeScript/Markdown LSP configured.

## Current State
The repo has an enforced commit-clean workflow and a working local LSP/diagnostics setup. These conventions apply to all ongoing work regardless of phase.

## Recommended Next Reads
- digest-005 — the Guardian launcher/preflight that the commit-clean rule protects.
- digest-002 — deploy/ops readiness where tooling conventions first appear.

## Source Coverage
2 records (1 decision + 1 change), 2026-08-21 to 2026-08-24, covering project workflow conventions and OpenCode tooling.
