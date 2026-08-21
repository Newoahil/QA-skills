---
type: change
record_id: change-2b02bc5e4e534535a15f2ef47dc9986d
date: 2026-08-21
title: Make Guardian model selection config-driven and portable
status: completed
source: manual
key_conclusion: Removed hardcoded cpa/gpt-5.5 models from Guardian agent definitions and made per-role model selection read from .qa/guardian/config.json models map (with default and OpenCode global-default fallback), so the repo no longer bakes in a private provider/model and runs out of the box on any user's provider.
topics: [guardian-runtime, opencode, model-config]
author: Sisyphus
related_files: [tools/guardian/investigation-coordinator.mjs, tools/guardian/scheduler.mjs, tools/guardian/investigation-process.mjs, tools/guardian/fixer-session-runner.mjs, tools/guardian/qa-session-runner.mjs, tools/guardian/README.md]
---

## Change Content

Reverted the portability regression introduced when per-role `model:` frontmatter was hardcoded (`cpa/gpt-5.5`, `cpa/gpt-5.4`, `cpa/gpt-5.6-luna`) into the nine Guardian agent markdown files. `cpa` is a user-local provider name and those model ids are user-specific, so another user cloning the repo could not run it. All nine `model:` lines were removed and re-synced to the installed agents dir.

Added `resolveModelForRole(config, role)` in `investigation-coordinator.mjs`: it reads `config.models[role]`, falls back to `config.models.default`, then to `undefined` (which lets OpenCode use the agent/global default). Empty/whitespace values are treated as unset. The scheduler now resolves a per-role model for specialists, plan builder (`plan` key), fixer (`fixer` key), and QA (`qa` key), and threads it through the runners into `opencodeClient.prompt({ model })`. `prompt` was generalized so the primary model is the resolved model, with `fallback_models` tried on provider cooldown.

The repo hardcodes no provider or model. `.qa/guardian/config.json` may set an optional `models` map keyed by role plus a `default`; when absent, Guardian uses the OpenCode global/agent default so it stays runnable on any provider. README documents the `models` and `fallback_models` keys with provider-neutral placeholders.

## Reason for Change

The user pointed out that hardcoding `cpa/gpt-5.5` in agent definitions makes the repository non-portable — other users have different provider names and model ids and would fail to run. Model selection must be user configuration, not repo-baked constants.

## Impact Scope

Affects how Guardian resolves the model for every role (specialist/plan/fixer/qa). It adds an optional config surface and removes hardcoded models; it does not change permissions, read-only boundaries, QA independence, the scheduler state machine, or the undici timeout fix. Behavior with no `models` config is the previous portable default (OpenCode global/agent model). A running serve must be restarted to drop the now-removed agent-md model frontmatter.

## Implementation

- Removed `model:` from 9 agent md files; re-synced to `~/.config/opencode/agents/`.
- Added `resolveModelForRole` (config-driven, portable, with fallbacks).
- Threaded per-role model through scheduler → specialist/plan/fixer/qa runners → `prompt({ model })`.
- Generalized `prompt` to take a primary `model` plus `fallbackModels`.
- Documented `models` / `fallback_models` in tools/guardian/README.md with provider-neutral placeholders.

## Test Verification

- `node --test "tests/guardian/*.test.mjs"` passed: 547/547.
- `node --check` passed for changed modules.
- Live smoke: config `models["guardian-code"]="cpa/gpt-5.5"` → resolveModelForRole returns it → prompt succeeds; with no models config, resolveModelForRole returns undefined (portable default path).

## Notes

Dify recall remained unavailable (`D:\QA-skills\.opencode\tools\dify_recall.py` missing). Users set their own models in `.qa/guardian/config.json`; the user's local models are only an example, never committed to the repo.
