# Functional Validation Harness

This directory holds the opt in functional validation harness for the current `qa-skill` pack and the Phase 2 real project benchmark. The draft corpus is frozen at `benchmarks/real-projects/manifest.json` and `C:\Users\lhw\AppData\Local\Temp\opencode\qa-skill-real-project-corpus`. Three real campaigns have been attempted, but none provides valid Skill-vs-Baseline effectiveness evidence: the first had invalid provider reasoning configuration, the second was invalidated by certificate failures and obsolete scoring behavior, and the third correctly failed closed on the same external certificate instability.

## Deterministic Tests

Run the contract checks for the frozen corpus and the CLI contract:

```powershell
node --test tests/functional-validation/real-project-benchmark-contracts.test.mjs
node --test tests/functional-validation/real-project-benchmark.test.mjs
```

These tests verify the frozen draft manifest, strict opt in parsing, fixed manifest backed model, agent, and timeout values, direct argv execution, no retry policy, redacted evidence, and assessor only oracle handling.

## Real Project Benchmark

The real benchmark is disabled unless you opt in with either `QA_SKILL_PHASE2_BENCHMARK_RUNS=1` or `--allow-real-project-benchmark`.

The CLI contract is fixed.

1. `QA_SKILL_OPENCODE_BIN` points to a direct OpenCode executable.
2. `--provider-config C:\Users\lhw\.config\opencode\opencode.json` or `QA_SKILL_BENCHMARK_PROVIDER_CONFIG_PATH` selects the isolated provider config.
3. `--manifest` reads the frozen manifest.
4. `--corpus-root` points at the external corpus root.
5. `--artifact-root` points outside the corpus root.
6. `--comparison-threshold` is explicit.
7. Optional `--pair` narrows to one pair.
8. Optional `--snapshot` narrows to one snapshot.

The manifest itself pins `model`, `agent`, and `timeoutMs` in `runConfig`. There are no env knobs for those values now.

The benchmark consumes direct Node or Python argv arrays as plain argv. It does not add qa runtime adapters or language adapters.

The harness reads only the local provider config file, extracts the provider definition matching manifest model `cpa`, and passes only that provider definition through `OPENCODE_CONFIG_CONTENT`. Host plugins, MCPs, skills, other providers, and credential values are excluded from the isolated config path; provider values are redacted in artifacts.

The current draft corpus has 2 real Node PR pairs and 1 Python public fix pair. It is still draft, so it cannot support approved effectiveness claims.

### Future fresh-campaign command

This command is the PowerShell template to use only after the external certificate issue is resolved. It will consume model cost and must use a new empty artifact root rather than overwrite any of the existing campaign evidence.

```powershell
$env:QA_SKILL_PHASE2_BENCHMARK_RUNS = '1'
$env:QA_SKILL_OPENCODE_BIN = 'C:\path\to\opencode.exe'
$env:QA_SKILL_BENCHMARK_PROVIDER_CONFIG_PATH = 'C:\Users\lhw\.config\opencode\opencode.json'
node tests/functional-validation/real-project-benchmark.mjs --allow-real-project-benchmark --provider-config C:\Users\lhw\.config\opencode\opencode.json --manifest benchmarks/real-projects/manifest.json --corpus-root C:\Users\lhw\AppData\Local\Temp\opencode\qa-skill-real-project-corpus --artifact-root C:\works\QA-skills\test-results\real-project-benchmark-NEW-CAMPAIGN --comparison-threshold 5
```

Add `--pair <pairId>` or `--snapshot <snapshotId>` when you want a narrower scoped primary execution. Those filters do not change the frozen corpus. Existing run identity directories are never overwritten, so a new evidence cycle must use a new artifact root.

## Artifacts

Each run writes redacted evidence under the external artifact root, plus an assessor only `oracle.json`.

Successful per-run evidence includes `manifest.json`, `prompt-metadata.json`, `terminal.json`, `raw-stdout.jsonl`, `stderr.txt`, `events.json`, `final-message.md`, `final-report.md`, command/topology/authority evidence, assessor-only `oracle.json`, `postflight.json`, `scorecard.json`, and `cleanup.json`. Infrastructure failures fail closed and retain available `terminal.json`, `raw-stdout.jsonl`, `stderr.txt`, `events.json`, `failure.json`, and `cleanup.json`; they do not produce a normal scorecard or comparison.

Each evidence cycle also writes `corpus-manifest.json`, `run-order.json`, `scorecards/`, per snapshot `comparison.json` and `comparison.md`, per pair `comparison.json` and `comparison.md`, `benchmark-summary.md`, and `limitations.md`.

`corpus-manifest.json` and `oracle.json` are assessor only. They record corpus truth and post run checks, not model input.
