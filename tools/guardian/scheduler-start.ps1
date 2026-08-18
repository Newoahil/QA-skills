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

.PARAMETER Init
  Create .qa/guardian/config.json for the target repo if it does not exist, then start. When the
  config is missing and -Init is not given, the script offers to create it interactively.

.PARAMETER CommandAuthors
  Comma/space-separated GitHub logins allowed to drive /guardian commands (written into config on
  init). Required for a non-interactive init.

.PARAMETER BaseBranch
  PR base branch written into config on init. Default: dev.

.EXAMPLE
  ./tools/guardian/scheduler-start.ps1 -TargetRepo D:\tuantuanrent
  ./tools/guardian/scheduler-start.ps1 -TargetRepo D:\tuantuanrent -Init -CommandAuthors goudaren0528
  $env:QA_GUARDIAN_REPO="D:\tuantuanrent"; ./tools/guardian/scheduler-start.ps1
#>
[CmdletBinding()]
param(
  [string]$TargetRepo = "",
  [switch]$Init,
  [string]$CommandAuthors = "",
  [string]$BaseBranch = "dev"
)

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

$packageRoot = Join-Path $GuardianRepo "package.json"
$sdkPath = Join-Path $GuardianRepo "node_modules\@larksuiteoapi\node-sdk"
if ((Test-Path $packageRoot) -and -not (Test-Path $sdkPath)) {
  Write-Host "    [warn] Feishu SDK not installed — run npm install in $GuardianRepo before enabling WS." -ForegroundColor Yellow
}

if (-not (Test-Path -LiteralPath $TargetRepo)) { throw "TargetRepo does not exist: $TargetRepo" }

# gh must be authenticated (the scheduler runs gh under the hood).
$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) { Write-Host "    [warn] gh not on PATH — install + 'gh auth login' first." -ForegroundColor Yellow }
else { & gh auth status *> $null; if ($LASTEXITCODE -ne 0) { Write-Host "    [warn] gh not authenticated — run 'gh auth login'." -ForegroundColor Yellow } }

# config + command_authors (fail-closed security key). If it already exists, start directly.
# If it is missing: create it via -Init (or an interactive prompt), then start.
$configPath = Join-Path $TargetRepo ".qa\guardian\config.json"
if (-not (Test-Path -LiteralPath $configPath)) {
  $authors = $CommandAuthors
  if (-not $Init -and -not $authors) {
    Write-Host "    config not found: $configPath" -ForegroundColor Yellow
    $ans = Read-Host "    Create it now? Enter trusted GitHub login(s) (comma/space separated), or blank to abort"
    if (-not $ans) { throw "Aborted: no config and no command_authors provided. See tools/guardian/DEPLOY.md." }
    $authors = $ans
  }
  if (-not $authors) {
    throw "Missing $configPath and no -CommandAuthors given. Re-run with: -Init -CommandAuthors <login>. See tools/guardian/DEPLOY.md."
  }
  $list = @($authors -split '[,\s]+' | Where-Object { $_ })
  $guardianDir = Join-Path $TargetRepo ".qa\guardian"
  New-Item -ItemType Directory -Force -Path $guardianDir | Out-Null
  $newCfg = [ordered]@{
    command_authors  = $list
    base_branch      = $BaseBranch
    poll_interval_ms = 60000
    lease_ms         = 1800000
  }
  # Write UTF-8 WITHOUT BOM — PowerShell 5.1 Set-Content -Encoding utf8 adds a BOM that breaks node JSON.parse.
  [System.IO.File]::WriteAllText($configPath, (($newCfg | ConvertTo-Json) + "`n"), (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "    [ok] created $configPath (command_authors: $($list -join ', '))" -ForegroundColor Green
}
$cfg = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if (-not $cfg.command_authors -or @($cfg.command_authors).Count -eq 0) {
  Write-Host "    [warn] config.command_authors is empty — NO /guardian command will be honored (fail-closed)." -ForegroundColor Yellow
} else {
  Write-Host "    command_authors: $($cfg.command_authors -join ', ')" -ForegroundColor Green
}

Write-Host "==> starting guardian runtime (scheduler + Feishu WS; Ctrl-C to stop)" -ForegroundColor Cyan
& $nodeExe (Join-Path $GuardianRepo "tools\guardian\guardian-runtime.mjs") --repo $TargetRepo
