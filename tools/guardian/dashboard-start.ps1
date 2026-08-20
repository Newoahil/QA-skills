#requires -Version 5.1
<#
.SYNOPSIS
  一键启动只读 QA Guardian Dashboard。

.PARAMETER TargetRepo
  要观察的目标项目。未指定时按 QA_GUARDIAN_REPO、已配置的当前目录或交互输入解析。
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

function Canonical-LauncherPath([string]$Value) {
  if (-not $Value) { return "" }
  return ([IO.Path]::GetFullPath($Value)).TrimEnd('\').ToLowerInvariant()
}

function Read-LauncherConfig([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json } catch { return $null }
}

function Select-LauncherBinding($Config, [string]$CanonicalTarget) {
  if (-not $Config) { return $null }
  $canonical = Canonical-LauncherPath $CanonicalTarget
  if ($Config.projects) {
    foreach ($property in $Config.projects.PSObject.Properties) {
      if ((Canonical-LauncherPath ([string]$property.Name)) -eq $canonical) { return $property.Value }
    }
  }
  # Legacy v1 is readable only for its exact canonical target; it is never a fallback for another project.
  if ((Canonical-LauncherPath ([string]$Config.canonical_target_path)) -eq $canonical) { return $Config }
  return $null
}

function Resolve-ControlRepo([string]$CanonicalRepo) {
  $bindingPath = Join-Path $GuardianRepo "tools\guardian\scheduler.config.json"
  $binding = Select-LauncherBinding (Read-LauncherConfig $bindingPath) (Resolve-Path $CanonicalRepo).Path
  if ($binding -and $binding.mode -eq 'worktree' -and $binding.control_worktree_path) {
    return [string]$binding.control_worktree_path
  }
  return $CanonicalRepo
}

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

if (-not $TargetRepo) {
  Write-Host "    Each start requires an explicit target project. Dashboard is read-only and will not write state or GitHub." -ForegroundColor Yellow
  $TargetRepo = Read-Host "    Enter target repo path (example: D:\tuantuanrent, empty to cancel)"
  if (-not $TargetRepo) { throw "Cancelled: target repo is required." }
  $TargetRepo = $TargetRepo.Trim([char]34)
}
if (-not (Test-Path -LiteralPath $TargetRepo)) { throw "Target repo does not exist: $TargetRepo" }

$nodeExe = Find-Node
Write-Host "==> QA Guardian read-only Dashboard" -ForegroundColor Cyan
Write-Host "    Node       : $nodeExe"
Write-Host "    Tools      : $GuardianRepo"
Write-Host "    Target     : $TargetRepo"
Write-Host "    Tip        : Press Ctrl+C to stop refreshing." -ForegroundColor Gray
Write-Host ("    Session    : node tools/guardian/session-view.mjs --repo " + $TargetRepo + " --issue ISSUE --agent fixer") -ForegroundColor Gray

$controlRepo = Resolve-ControlRepo $TargetRepo
Write-Host "    Control    : $controlRepo"
& $nodeExe (Join-Path $GuardianRepo "tools\guardian\dashboard.mjs") --repo $controlRepo --watch 5
