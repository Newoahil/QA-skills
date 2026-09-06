# QA-CR B2 parent export v3 contract

## Scope

- Phase: V3-A profile / probe / contract / readiness layer only.
- This version preserves the frozen Phase A manifest, scope, fixture, and OpenCode provenance from v2.
- The prior v2 attempt is consumed; v3 introduces new config-resolution and credential-readiness gates only.

## Probe and authorization bindings

- Probe: `qa-cr-b2-probe-v3` / `qa-cr-b2-parent-export-v3` / `3.0.0` / `V3-A`.
- Canonical probe SHA-256: `49a9c6859936fc08c858db1e55ac224be27c474707c054df781fded85d1d8cef`.
- Authorization schema/id: `qa-cr-real-attempt-authorization-v2` / `qa-cr-b2-parent-export-v3-attempt-1`.
- Run prefix: `qa-cr-b2-parent-export-v3-a1-`.
- Artifact root hash: `d330e546c23907485eb1e47b4b2a27223bf8400421992e9c2336ab9c29ed2a0f`.
- Public execute is unconditional HOLD and the public authorization SHA is `null`.

## Config-resolution gate

- Source: `opencode debug config --pure` only.
- Selection: exact `$schema + provider.cpa` projection.
- Provider/model binding: `cpa` / `gpt-5.5`.
- `provider.cpa.npm` is canonical-and-exact: surrounding whitespace is rejected fail-closed, then the unchanged value must still satisfy the strict npm package regex.
- `provider.cpa.options.baseURL` is canonical launch state: accept only `http`/`https`; reject userinfo/query/fragment and repeated pathname separators such as `/v1//`; lower-case scheme/host; consistently omit default ports; normalize only the trailing slash; then write that exact canonical base URL into the selected config used for launch.
- Raw merged config, config-content hashes, and static provider config paths are forbidden.
- Persist only the reduced config profile fields: `schemaVersion`, `source`, `selection`, `providerId`, `providerNpm`, `modelId`, `credentialPresent`, `providerEndpointOriginPathSha256`.
- Exact launch shape is only `{ "$schema", "provider": { "cpa": { "npm", "options": { "baseURL", "apiKey" } } } }`.
- Unsupported resolved CPA fields such as `name`, `models`, headers, auth blobs, arbitrary options, URLs, and paths outside that exact shape are stripped and cannot affect launch.

## Credential-readiness gate

- Attestation schema/id: `qa-cr-credential-readiness-attestation-v1` / `qa-cr-b2-parent-export-v3-cpa-models`.
- Method/path: `GET` `/models`.
- Required status/model: `200` / `gpt-5.5`.
- Redirect policy: `error`.
- Timeout/body limits: `15000ms` / `2097152` bytes.
- The `/models` readiness URL is derived from the exact canonical launch `baseURL`, and `providerEndpointOriginPathSha256` hashes that same canonical launch base URL identity.
- Persist only the safe attestation summary; never persist model lists, URLs, headers, secrets, or absolute host paths.
- Recursive guards apply to nested objects and arrays; any persisted URL or absolute host path invalidates the artifact.

## Constraints

- No temp secret file.
- No raw merged config persistence.
- No secret or config-content hash persistence.
- No model list, URL, or header persistence.
- No absolute host-path persistence in probe, config profile, or readiness attestation.
- OpenCode provenance stays path-only in v3; repository URLs and per-source URLs are forbidden.
- Repeated readiness checks are allowed only before one-shot consumption.
- Consumption preflight checks canonical authorization occupancy before version/config/readiness/temp work.
- Simulation is transient and non-evidence only; it persists nothing and never returns replay/envelope/facts artifacts.

## Runtime and schema reuse

- Runtime: direct executable `1.18.19`, provider `cpa`, model `cpa/gpt-5.5`.
- Reused schemas: `qa-cr-run-telemetry-v2`, `qa-cr-score-input-facts-v2`, `qa-cr-evidence-envelope-v2`, `qa-cr-runtime-pin-v1`.
