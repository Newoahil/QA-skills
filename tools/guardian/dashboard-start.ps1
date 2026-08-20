#requires -Version 5.1
<#
.SYNOPSIS
  One-click read-only QA Guardian Dashboard launcher.

.PARAMETER TargetRepo
  Target repository to observe. If omitted, resolved from QA_GUARDIAN_REPO, current directory when
  it already contains .qa/guardian/config.json, or an interactive prompt.
#>
[CmdletBinding()]
param(
  [string]$TargetRepo = ""
)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$GuardianRepo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

function Find-Node {
  $c = Get-Command node -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $cands = @(
    "$env:ProgramFiles\nodejs\node.exe",
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
  )
  $nvm = Join-Path $env:LOCALAPPDATA "nvm"
  if (Test-Path -LiteralPath $nvm) {
    Get-ChildItem -LiteralPath $nvm -Directory -Filter "v*" -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      ForEach-Object { $cands += (Join-Path $_.FullName "node.exe") }
  }
  foreach ($p in $cands) { if (Test-Path -LiteralPath $p) { return $p } }
  throw "node not found. Install Node.js >= 18 or run from a terminal with node on PATH."
}

if (-not $TargetRepo) { $TargetRepo = $env:QA_GUARDIAN_REPO }
if (-not $TargetRepo) {
  $cwd = (Get-Location).Path
  if (Test-Path -LiteralPath (Join-Path $cwd ".qa\guardian\config.json")) {
    $TargetRepo = $cwd
  }
}
if (-not $TargetRepo) {
  Write-Host "Target repo is not set. Dashboard is read-only; it will not start scheduler or write state/GitHub." -ForegroundColor Yellow
  $TargetRepo = Read-Host "Enter target repo path (example: D:\tuantuanrent, empty to cancel)"
  if (-not $TargetRepo) { throw "Cancelled: target repo is required." }
  $TargetRepo = $TargetRepo.Trim([char]34)
}
if (-not (Test-Path -LiteralPath $TargetRepo)) { throw "Target repo does not exist: $TargetRepo" }

$nodeExe = Find-Node
Write-Host "==> QA Guardian read-only Dashboard" -ForegroundColor Cyan
Write-Host "    Node    : $nodeExe"
Write-Host "    Tools   : $GuardianRepo"
Write-Host "    Target  : $TargetRepo"
Write-Host "    Tip     : Press Ctrl+C to stop refreshing." -ForegroundColor Gray
Write-Host "    Session : node tools/guardian/session-view.mjs --repo `"$TargetRepo`" --issue <number> --agent fixer" -ForegroundColor Gray

& $nodeExe (Join-Path $GuardianRepo "tools\guardian\dashboard.mjs") --repo $TargetRepo --watch 5
