#requires -Version 5.1
<##
.SYNOPSIS
  Live terminal monitor for one QA Guardian issue.

.DESCRIPTION
  Displays running agent roles, N=1 lock heartbeat, issue state, artifacts, and git status.
  This script is launched through powershell.exe -File so its commands never cross a nested
  -Command quoting boundary.
##>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$TargetRepo,

  [Parameter(Mandatory = $true)]
  [int]$Issue,

  [ValidateRange(1, 300)]
  [int]$RefreshSeconds = 5,

  [switch]$Once
)

$ErrorActionPreference = "Continue"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$Host.UI.RawUI.WindowTitle = "QA Guardian #$Issue Live Monitor"

$guardianDir = Join-Path $TargetRepo ".qa\guardian"
$lockFile = Join-Path $guardianDir ".scheduler.lock"
$stateFile = Join-Path $guardianDir "$Issue.json"
$artifactDir = Join-Path $guardianDir "$Issue"

function Find-Git {
  $command = Get-Command git -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  foreach ($candidate in @(
    'C:\Program Files\Git\cmd\git.exe',
    'C:\Program Files\Git\bin\git.exe'
  )) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  throw 'git executable not found'
}

$gitExe = Find-Git
do {
  Clear-Host
  Write-Host "QA Guardian #$Issue Live Monitor  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan

  Write-Host "`n[Running agents]" -ForegroundColor Yellow
  $agents = Get-CimInstance Win32_Process -Filter "Name='opencode.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*--agent*" -and $_.CommandLine -like "*$TargetRepo*" }
  if ($agents) {
    foreach ($agent in $agents) {
      $role = ($agent.CommandLine -split "--agent ")[1].Split(" ")[0]
      $elapsed = [math]::Round(((Get-Date) - $agent.CreationDate).TotalMinutes, 1)
      Write-Host "  $role  PID=$($agent.ProcessId)  elapsed=${elapsed}m"
    }
  } else {
    Write-Host "  none"
  }

  Write-Host "`n[N=1 lock]" -ForegroundColor Yellow
  if (Test-Path -LiteralPath $lockFile) {
    try {
      $lock = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json
      $renewed = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$lock.renewed_at).LocalDateTime.ToString("HH:mm:ss")
      Write-Host "  pid=$($lock.pid) renewed_at=$renewed"
    } catch {
      Write-Host "  lock file is being renewed..."
    }
  } else {
    Write-Host "  no lock"
  }

  Write-Host "`n[Issue #$Issue state]" -ForegroundColor Yellow
  if (Test-Path -LiteralPath $stateFile) {
    try {
      $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
      $state |
        Select-Object issue,state,issue_class,risk,dossier_status,plan_status,last_phase,last_error_class,qa_verdict_status,branch,pr_url |
        Format-List |
        Out-String |
        Write-Host
    } catch {
      Write-Host "  state file is being written..."
    }
  } else {
    Write-Host "  not created yet (specialists may still be investigating)"
  }

  Write-Host "`n[Artifacts]" -ForegroundColor Yellow
  $artifacts = Get-ChildItem -LiteralPath $artifactDir -ErrorAction SilentlyContinue |
    Select-Object Name,Length,LastWriteTime
  if ($artifacts) {
    $artifacts | Format-Table -AutoSize | Out-String | Write-Host
  } else {
    Write-Host "  none"
  }

  Write-Host "`n[Git branch/status]" -ForegroundColor Yellow
  & $gitExe -C $TargetRepo branch --show-current
  & $gitExe -C $TargetRepo status --short | Select-Object -First 12

  if (-not $Once) {
    Write-Host "`nRefresh: ${RefreshSeconds}s  (Ctrl+C or close window to stop monitor)" -ForegroundColor DarkGray
    Start-Sleep -Seconds $RefreshSeconds
  }
} while (-not $Once)
