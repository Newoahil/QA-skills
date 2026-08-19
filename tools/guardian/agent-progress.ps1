#requires -Version 5.1
<##
.SYNOPSIS
  Shows the real-time JSON-event progress stream for one QA Guardian specialist.
##>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$TargetRepo,

  [Parameter(Mandatory = $true)]
  [int]$Issue,

  [Parameter(Mandatory = $true)]
  [ValidateSet('guardian-code', 'guardian-business', 'guardian-runtime')]
  [string]$Agent,

  [Parameter(Mandatory = $true)]
  [string]$ProgressDir
)

$ErrorActionPreference = "Continue"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$Host.UI.RawUI.WindowTitle = "QA Guardian #$Issue $Agent Progress"
$logFile = Join-Path $ProgressDir "$Agent.log"

Write-Host "QA Guardian #$Issue - $Agent" -ForegroundColor Cyan
Write-Host "Repo : $TargetRepo"
Write-Host "Log  : $logFile"
Write-Host "Waiting for real OpenCode JSON events..." -ForegroundColor Yellow
Write-Host "Close this window or press Ctrl+C to stop viewing (does not stop the agent)." -ForegroundColor DarkGray

while (-not (Test-Path -LiteralPath $logFile)) { Start-Sleep -Milliseconds 500 }
Get-Content -LiteralPath $logFile -Wait -Tail 200
