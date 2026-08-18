#requires -Version 5.1
<#
.SYNOPSIS
  One-shot bootstrap for QA Guardian (MVP, Windows PowerShell).

.DESCRIPTION
  Idempotently prepares everything the QA Guardian single-issue chain (§15.2) needs,
  EXCEPT the two things only you can do: install/authenticate `gh`, and label a real
  GitHub issue. Specifically it:
    1. Verifies prerequisites (node, opencode, gh) and reports what is missing.
    2. Installs the three QA agents into the global opencode agents dir.
    3. Installs the qa-skill into the global opencode skills dir.
    4. Ensures opencode.json has subagent_depth >= 2 (for guardian -> qa -> qa-facet).
    5. Bootstraps .qa/guardian/ + a config.json template (webhook optional) in the TARGET repo.
    6. Runs the deterministic test suite so you get a green signal before any live run.

  Re-running is safe: existing files are refreshed, existing config is preserved.

.PARAMETER TargetRepo
  The repository you want Guardian to watch (where .qa/guardian/ is created).
  Defaults to the current directory.

.PARAMETER NotifyWebhook
  Optional. A Slack/webhook URL; written into .qa/guardian/config.json. If omitted,
  a template with an empty webhook is written (notifications degrade to issue comments).

.PARAMETER SkipTests
  Skip the `node --test` step (not recommended).

.EXAMPLE
  ./tools/guardian/bootstrap.ps1 -TargetRepo D:\my-service
  ./tools/guardian/bootstrap.ps1 -TargetRepo D:\my-service -NotifyWebhook https://hooks.slack.com/services/XXX
#>
[CmdletBinding()]
param(
  [string]$TargetRepo = (Get-Location).Path,
  [string]$NotifyWebhook = "",
  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
# This script lives in <repo>/tools/guardian/. Resolve the guardian source repo root.
$GuardianRepo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$AgentsSrc    = Join-Path $GuardianRepo "qa-skill\agents"
$SkillSrc     = Join-Path $GuardianRepo "qa-skill"
$OpencodeHome = Join-Path $env:USERPROFILE ".config\opencode"
$AgentsDst    = Join-Path $OpencodeHome "agents"
$SkillDst     = Join-Path $OpencodeHome "skills\qa-skill"

function Write-Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok($m)   { Write-Host "    [ok] $m" -ForegroundColor Green }
function Write-Warn2($m){ Write-Host "    [warn] $m" -ForegroundColor Yellow }

Write-Step "QA Guardian bootstrap"
Write-Host "    guardian source: $GuardianRepo"
Write-Host "    target repo    : $TargetRepo"

# --- 1. Prerequisite checks -----------------------------------------------------------
Write-Step "Checking prerequisites"
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) { Write-Ok "node: $($node.Source)" } else { throw "node not found on PATH — install Node.js (>=18) first." }

$opencode = Get-Command opencode -ErrorAction SilentlyContinue
if ($opencode) { Write-Ok "opencode: $($opencode.Source)" } else { Write-Warn2 "opencode not on PATH — you'll need it to run the guardian agent (npm i -g opencode)." }

$gh = Get-Command gh -ErrorAction SilentlyContinue
$ghReady = $false
if ($gh) {
  Write-Ok "gh: $($gh.Source)"
  $authOut = & gh auth status 2>&1
  if ($LASTEXITCODE -eq 0) { $ghReady = $true; Write-Ok "gh authenticated" }
  else { Write-Warn2 "gh is installed but NOT authenticated — run: gh auth login" }
} else {
  Write-Warn2 "gh NOT installed — the GitHub read/write chain cannot run until you install + authenticate it."
  Write-Warn2 "  Install: winget install GitHub.cli   (then: gh auth login)"
}

if (-not (Test-Path -LiteralPath $TargetRepo)) { throw "TargetRepo does not exist: $TargetRepo" }

# --- 2. Install agents globally -------------------------------------------------------
Write-Step "Installing QA agents -> $AgentsDst"
New-Item -ItemType Directory -Force -Path $AgentsDst | Out-Null
foreach ($a in @("qa-guardian.md","qa.md","qa-facet.md")) {
  $src = Join-Path $AgentsSrc $a
  if (-not (Test-Path -LiteralPath $src)) { throw "missing agent source: $src" }
  Copy-Item -Force -LiteralPath $src -Destination (Join-Path $AgentsDst $a)
  Write-Ok "agent installed: $a"
}

# --- 3. Install skill globally --------------------------------------------------------
Write-Step "Installing qa-skill -> $SkillDst"
New-Item -ItemType Directory -Force -Path $SkillDst | Out-Null
Copy-Item -Force -Recurse -Path (Join-Path $SkillSrc "*") -Destination $SkillDst
Write-Ok "qa-skill installed"

# --- 4. Ensure subagent_depth >= 2 ----------------------------------------------------
# Guardian -> qa -> qa-facet is a 3-level chain; opencode needs subagent_depth >= 2.
# We patch the TARGET repo's opencode.json (project config wins for a project run).
# JSON is handled by node (not PS ConvertFrom-Json) so behavior is identical to bootstrap.sh
# and immune to PowerShell 5.1 hashtable quirks.
Write-Step "Ensuring subagent_depth >= 2 in target repo opencode.json"
$targetOpencodeJson = Join-Path $TargetRepo "opencode.json"
$depthPatch = @'
const fs = require('fs');
const p = process.argv[1];
let cfg = {};
if (fs.existsSync(p)) {
  try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { console.log('WARN invalid-json'); process.exit(0); }
}
if (!((cfg.subagent_depth ?? 0) >= 2)) {
  if (!cfg['$schema']) cfg['$schema'] = 'https://opencode.ai/config.json';
  cfg.subagent_depth = 2;
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
  console.log('OK set-depth-2');
} else { console.log('OK already-depth-2'); }
'@
$depthResult = & node -e $depthPatch $targetOpencodeJson
if ($depthResult -match "invalid-json") { Write-Warn2 "existing opencode.json is not valid JSON; leaving it untouched. Set subagent_depth: 2 manually." }
elseif ($depthResult -match "already-depth-2") { Write-Ok "subagent_depth already >= 2" }
else { Write-Ok "set subagent_depth: 2 in $targetOpencodeJson" }

# --- 5. Bootstrap .qa/guardian/ + config.json ----------------------------------------
Write-Step "Bootstrapping .qa/guardian/ in target repo"
$guardianDir = Join-Path $TargetRepo ".qa\guardian"
New-Item -ItemType Directory -Force -Path $guardianDir | Out-Null
Write-Ok "created $guardianDir"

$configPath = Join-Path $guardianDir "config.json"
# config.json is also handled by node for cross-version JSON safety + parity with bootstrap.sh.
$configPatch = @'
const fs = require('fs');
const p = process.argv[1];
const webhook = process.argv[2] || '';
if (fs.existsSync(p)) {
  const existing = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (webhook) { existing.notify_webhook = webhook; fs.writeFileSync(p, JSON.stringify(existing, null, 2) + '\n'); console.log('OK updated-webhook'); }
  else { console.log('OK preserved'); }
} else {
  const cfg = { notify_webhook: webhook, base_branch: 'dev', lease_ms: 1800000 };
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
  console.log('OK wrote-template webhook=' + Boolean(webhook));
}
'@
$configResult = & node -e $configPatch $configPath $NotifyWebhook
if ($configResult -match "preserved") { Write-Ok "config.json already exists — preserved" }
elseif ($configResult -match "updated-webhook") { Write-Ok "config.json preserved; updated notify_webhook" }
else { Write-Ok "wrote config.json template ($configResult)" }

# --- 6. Run deterministic tests -------------------------------------------------------
if (-not $SkipTests) {
  Write-Step "Running deterministic test suite (gh/curl stubbed)"
  Push-Location $GuardianRepo
  try {
    & node --test "tests/guardian/*.test.mjs"
    if ($LASTEXITCODE -eq 0) { Write-Ok "all guardian tests passed" }
    else { Write-Warn2 "tests reported failures (exit $LASTEXITCODE) — inspect output above." }
  } finally { Pop-Location }
}

# --- Summary --------------------------------------------------------------------------
Write-Step "Bootstrap complete"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
if (-not $ghReady) {
  Write-Host "  1. Install + authenticate gh (REQUIRED for the live chain):" -ForegroundColor Yellow
  Write-Host "       winget install GitHub.cli"
  Write-Host "       gh auth login"
}
Write-Host "  2. Label a real bug issue in your repo with:  qa-guardian"
Write-Host "  3. Run the single-issue chain (§15.2):"
Write-Host "       opencode run --agent qa-guardian --dir `"$TargetRepo`" ``" -ForegroundColor Gray
Write-Host "         `"Watch GitHub issue #<n>: investigate root cause, assess risk, dispatch read-only qa, open a dev PR, stop at gate 2.`"" -ForegroundColor Gray
Write-Host "  4. If it stops at gate 1 (high-risk), reply on the issue:  /guardian approve"
Write-Host "       (only logins in config command_authors are honored; unset = no command works)" -ForegroundColor Gray
Write-Host ""
Write-Host "  Poll routing check (no live run):" -ForegroundColor Cyan
Write-Host "       node `"$GuardianRepo\tools\guardian\poll.mjs`" --repo `"$TargetRepo`" --issue <n>" -ForegroundColor Gray
Write-Host ""
Write-Host "  Unattended watch mode + Feishu (see tools/guardian/DEPLOY.md):" -ForegroundColor Cyan
Write-Host "    - Set command_authors (REQUIRED), poll_interval_ms, notify_webhook/notify_channel in .qa/guardian/config.json" -ForegroundColor Gray
Write-Host "    - Resident scheduler (this machine): node `"$GuardianRepo\tools\guardian\scheduler.mjs`" --repo `"$TargetRepo`"" -ForegroundColor Gray
Write-Host "    - Feishu callback service (cloud): deploy tools/guardian/docker-compose.yml on Dokploy; DEPLOY.md has env + callback URL setup" -ForegroundColor Gray
