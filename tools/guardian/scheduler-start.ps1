#requires -Version 5.1
<#
.SYNOPSIS
  One-click launcher for the QA Guardian resident scheduler (Windows).

.DESCRIPTION
  Resolves node/gh/git onto PATH for this session (nvm layouts included), verifies the target
  repo + .qa/guardian/config.json exist with a command_authors whitelist (the security-required
  fail-closed key), then starts scheduler.mjs watching the target repo. No global PATH changes.

.PARAMETER TargetRepo
  The repository the scheduler watches. If omitted, resolved by precedence:
    1. -TargetRepo argument
    2. env QA_GUARDIAN_REPO
    3. tools/guardian/scheduler.config.json  { "target_repo": "..." }  (gitignored)
    4. current directory

.EXAMPLE
  ./tools/guardian/scheduler-start.ps1 -TargetRepo D:\tuantuanrent
  $env:QA_GUARDIAN_REPO="D:\tuantuanrent"; ./tools/guardian/scheduler-start.ps1
#>
[CmdletBinding()]
param([string]$TargetRepo = "")

$ErrorActionPreference = "Stop"
$GuardianRepo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

# Resolve target repo by precedence: param > env > sibling config file > cwd.
if (-not $TargetRepo) { $TargetRepo = $env:QA_GUARDIAN_REPO }
if (-not $TargetRepo) {
  $schedCfg = Join-Path $PSScriptRoot "scheduler.config.json"
  if (Test-Path -LiteralPath $schedCfg) {
    $sc = Get-Content -LiteralPath $schedCfg -Raw | ConvertFrom-Json
    if ($sc.target_repo) { $TargetRepo = $sc.target_repo }
  }
}
if (-not $TargetRepo) { $TargetRepo = (Get-Location).Path }

function Find-Node {
  $c = Get-Command node -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $cands = @(
    "$env:ProgramFiles\nodejs\node.exe",
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
  )
  # nvm-windows: newest version dir under AppData\Local\nvm
  $nvm = Join-Path $env:LOCALAPPDATA "nvm"
  if (Test-Path $nvm) {
    Get-ChildItem $nvm -Directory -Filter "v*" -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      ForEach-Object { $cands += (Join-Path $_.FullName "node.exe") }
  }
  foreach ($p in $cands) { if (Test-Path $p) { return $p } }
  throw "node not found. Install Node.js >= 18 or add it to PATH."
}

function Ensure-OnPath($dir) {
  if ($dir -and (Test-Path $dir) -and ($env:PATH -notlike "*$dir*")) {
    $env:PATH = "$dir;$env:PATH"
  }
}

$nodeExe = Find-Node
Ensure-OnPath (Split-Path $nodeExe -Parent)
Ensure-OnPath "C:\Program Files\GitHub CLI"
Ensure-OnPath "C:\Program Files\Git\cmd"
Ensure-OnPath "C:\Program Files\Git\bin"

Write-Host "==> QA Guardian scheduler" -ForegroundColor Cyan
Write-Host "    node        : $nodeExe"
Write-Host "    guardian src: $GuardianRepo"
Write-Host "    target repo : $TargetRepo"

if (-not (Test-Path -LiteralPath $TargetRepo)) { throw "TargetRepo does not exist: $TargetRepo" }

# gh must be authenticated (the scheduler runs gh under the hood).
$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) { Write-Host "    [warn] gh not on PATH — install + 'gh auth login' first." -ForegroundColor Yellow }
else { & gh auth status *> $null; if ($LASTEXITCODE -ne 0) { Write-Host "    [warn] gh not authenticated — run 'gh auth login'." -ForegroundColor Yellow } }

# config + command_authors (fail-closed security key) check.
$configPath = Join-Path $TargetRepo ".qa\guardian\config.json"
if (-not (Test-Path -LiteralPath $configPath)) {
  throw "Missing $configPath. Create it with at least: { `"command_authors`": [`"<your-github-login>`"] }. See tools/guardian/DEPLOY.md."
}
$cfg = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if (-not $cfg.command_authors -or @($cfg.command_authors).Count -eq 0) {
  Write-Host "    [warn] config.command_authors is empty — NO /guardian command will be honored (fail-closed)." -ForegroundColor Yellow
} else {
  Write-Host "    command_authors: $($cfg.command_authors -join ', ')" -ForegroundColor Green
}

Write-Host "==> starting scheduler (Ctrl-C to stop)" -ForegroundColor Cyan
& $nodeExe (Join-Path $GuardianRepo "tools\guardian\scheduler.mjs") --repo $TargetRepo
