#requires -Version 5.1
<#
.SYNOPSIS
  Adds or refreshes a QA Guardian project binding without starting Guardian.

.DESCRIPTION
  This is the interactive switching/onboarding entrypoint. It delegates all binding and
  per-project .qa/guardian/config.json setup to scheduler-start.ps1 -Init -InitOnly, then exits.
  Use guardian-start.bat afterward to run the scheduler + TUI for the selected project.
#>
[CmdletBinding()]
param(
  [string]$TargetRepo = "",
  [string]$CommandAuthors = "",
  [string]$GitHubRepo = "",
  [string]$BaseBranch = "dev",
  [ValidateSet("new-open", "labeled")]
  [string]$WatchMode = "new-open",
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$schedulerScript = Join-Path $PSScriptRoot "scheduler-start.ps1"
if (-not (Test-Path -LiteralPath $schedulerScript)) { throw "scheduler-start.ps1 not found: $schedulerScript" }

Write-Host "==> QA Guardian project rebind" -ForegroundColor Cyan
Write-Host "    This updates the selected project's binding/config only; it will not start scheduler or TUI." -ForegroundColor Gray

if (-not $TargetRepo) {
  $TargetRepo = Read-Host -Prompt 'Target repo path (blank to cancel)'
  if (-not $TargetRepo) { throw "Cancelled: target repo is required." }
  $TargetRepo = $TargetRepo.Trim([char]34)
}

$arguments = @(
  '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $schedulerScript,
  '-TargetRepo', $TargetRepo,
  '-Init',
  '-InitOnly',
  '-BaseBranch', $BaseBranch,
  '-WatchMode', $WatchMode
)
if ($CommandAuthors) { $arguments += @('-CommandAuthors', $CommandAuthors) }
if ($GitHubRepo) { $arguments += @('-GitHubRepo', $GitHubRepo) }
if ($Yes) { $arguments += '-Yes' }

& powershell.exe @arguments
if ($LASTEXITCODE -ne 0) { throw "Guardian rebind failed. Review the error above." }

Write-Host "==> Rebind complete" -ForegroundColor Green
Write-Host "    Start with: tools\guardian\guardian-start.bat `"$TargetRepo`"" -ForegroundColor Gray
