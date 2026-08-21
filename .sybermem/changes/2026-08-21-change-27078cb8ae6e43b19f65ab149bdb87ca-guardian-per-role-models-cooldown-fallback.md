---
type: change
record_id: change-27078cb8ae6e43b19f65ab149bdb87ca
date: 2026-08-21
title: Guardian pins per-role models and adds provider cooldown fallback
status: completed
source: manual
key_conclusion: Guardian agents now pin explicit per-role models instead of inheriting the global default, and prompts auto-retry on the next fallback model when a provider cooldown (429) occurs, so a single model cooldown no longer bricks the whole investigation.
topics: [guardian-runtime, opencode, model-config]
author: Sisyphus
related_files: [qa-skill/agents/qa-guardian.md, qa-skill/agents/qa.md, qa-skill/agents/guardian-code.md, tools/guardian/opencode-client.mjs, tools/guardian/investigation-process.mjs, tools/guardian/scheduler.mjs]
---

## Change Content

Every runnable Guardian agent definition now declares an explicit `model:` in its frontmatter instead of silently inheriting the OpenCode global default (which was `cpa/gpt-5.3-codex-spark`, currently in provider cooldown). Model is assigned by role: fixer (`qa-guardian`), independent QA (`qa`, `qa-facet`), and the core investigation specialists (`guardian-code`, `guardian-business`, `guardian-runtime`) use `cpa/gpt-5.5`; the plan critic (`guardian-plan-critic`) uses `cpa/gpt-5.6-luna`; the retrieval-oriented specialists (`guardian-docs`, `guardian-history`) use `cpa/gpt-5.4`. `fixer-agent.md` is a role-contract document with no frontmatter and is intentionally left unchanged. The updated definitions were re-synced to `~/.config/opencode/agents/`.

The OpenCode client `prompt()` now accepts `fallbackModels` and retries the same session on the next model when a response is a provider error (e.g. HTTP 200 with `info.error` model cooldown / 429). The specialist runner, plan builder, and scheduler thread a configurable `fallback_models` list (from `.qa/guardian/config.json`) through to the prompt, so a cooldown on the primary model automatically downgrades to a backup model instead of failing the investigation.

## Reason for Change

Investigation #205 kept failing with `model_cooldown` because no Guardian layer specified a model; all agents fell back to the global default, which was rate-limited. The user expected `gpt-5.5` but nothing wrote it into the Guardian agents. Pinning per-role models makes behavior deterministic and portable for other installs, and provider fallback keeps a single model cooldown from bricking the whole run.

## Impact Scope

Affects Guardian agent model selection and the shared-server prompt path (specialist, plan, and by extension fixer/QA when configured). It only adds `model:` frontmatter and a `fallbackModels` option; it does not change permissions, read-only boundaries, QA independence, or the scheduler state machine. Non-Guardian agents and the global default are untouched. A running OpenCode serve must be restarted to pick up the new agent model frontmatter.

## Implementation

- Added `model:` to nine Guardian agent definitions by role and re-synced to the installed agents directory.
- Refactored `opencode-client.prompt()` into a single-attempt helper plus a fallback loop that retries only on `provider-error`, passing `model` in the message body per attempt.
- Added `fallbackModels` params to `processSpecialistRunner` and `processPlanBuilder`, forwarded to the prompt.
- Read `config.fallback_models` in the scheduler tick and passed it into both runners.

## Test Verification

- `node --test "tests/guardian/*.test.mjs"` passed: 539/539.
- `node --check` passed for changed Guardian modules.
- `git diff --check` reported only expected CRLF conversion warnings.
- Live smoke on the running OpenCode server: the cooldown session returned `provider-error / model_cooldown` without fallback, and returned `kind: ok` with `fallbackModels: ['cpa/gpt-5.5']`, proving automatic downgrade.

## Notes

Dify recall remained unavailable (`D:\QA-skills\.opencode\tools\dify_recall.py` missing). `fallback_models` is opt-in via `.qa/guardian/config.json`; when unset, behavior is unchanged except that agents now use their pinned models.
