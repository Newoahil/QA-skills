# Functional Validation Harness

This directory holds the opt in functional validation harness for the current `qa-skill` pack and the Phase 2 real project benchmark. The deterministic functional suite preserves the complete QA applicability matrix through Lite and Full exact relay, authority handling, and the same read-only four-status contract that the docs describe; the pack-contract suite separately enforces the complete declared Full-trigger matrix. The draft corpus is still frozen at `benchmarks/real-projects/manifest.json` and `C:\Users\lhw\AppData\Local\Temp\opencode\qa-skill-real-project-corpus`. Three real campaigns have been attempted, but none provides valid Skill-vs-Baseline effectiveness evidence: the first had invalid provider reasoning configuration, the second was invalidated by certificate failures and obsolete scoring behavior, and the third correctly failed closed on the same external certificate instability.

## Deterministic Tests

Run the deterministic contract checks for Lite, Full, and the frozen corpus contract:

```powershell
node --test tests/functional-validation/contracts.test.mjs
node --test tests/functional-validation/qa-plan-validator.test.mjs
node --test tests/functional-validation/real-project-benchmark-contracts.test.mjs
node --test tests/functional-validation/real-project-benchmark.test.mjs
```

These tests verify the triage-first QA-Lite contract, representative Full-route escalation behavior, the unchanged Full route contract, the frozen draft manifest, strict opt in parsing, fixed manifest backed model, agent, and timeout values, direct argv execution, no retry policy, redacted evidence, assessor only oracle handling, preservation of the full matrix through exact relay and authority selection, and the runtime `qa-plan/v1` planner contract. The full textual trigger matrix is validated by `tests/qa-skill-pack.test.mjs`.

## qa-plan/v1 Planner Validator

The planner sidecar is a two-stage JSON companion maintained by the same QA subagent. `plan` records `method`, `preconditions`, `expectedResult`, and `requiredEvidence`; `conclusion` adds `status`, `evidenceRefs`, and `conclusion`.

Plan-stage check:

```powershell
node "<resolved skill source path>\tools\validate-qa-plan.mjs" "<plan.json>" --json
```

Conclusion-stage check:

```powershell
node "<resolved skill source path>\tools\validate-qa-plan.mjs" "<plan.json>" --json --require-conclusion
```

Exit code `0` means valid, `1` means contract mismatch, and `2` means usage, load, or read failure. Success only means consistency, not product evidence, report authority, Human Gate approval, or release approval. If Node is unavailable, do not install anything. Use the same schema, rubric, and gate rules manually.

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

The manifest itself pins `model`, `agent`, and `timeoutMs` in `runConfig`. There are no env knobs for those values now, and the manifest semantics are unchanged by the Lite or Full routing docs.

The benchmark consumes direct Node or Python argv arrays as plain argv. It does not add qa runtime adapters or language adapters.

The harness reads only the local provider config file, extracts the provider definition matching manifest model `cpa`, and passes only that provider definition through `OPENCODE_CONFIG_CONTENT`. Host plugins, MCPs, skills, other providers, and credential values are excluded from the isolated config path; provider values are redacted in artifacts.

The current draft corpus has 2 real Node PR pairs and 1 Python public fix pair. It is still draft, so it cannot support approved effectiveness claims. The benchmark manifest and its scoring semantics stay frozen, and this README does not redefine them.

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
