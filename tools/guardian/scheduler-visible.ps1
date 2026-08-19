#requires -Version 5.1
<##
.SYNOPSIS
  Opens visible scheduler and live-monitor terminals for one QA Guardian issue.

.DESCRIPTION
  Launches repository-owned scripts via powershell.exe -File. It never embeds script text in
  -Command, avoiding the nested-quoting bug where WindowTitle text was parsed as a command.
##>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$TargetRepo,

  [Parameter(Mandatory = $true)]
  [int]$Issue,

  [ValidateRange(1, 300)]
  [int]$RefreshSeconds = 5,

  [ValidateRange(1024, 65535)]
  [int]$OpenCodePort = 4097,

  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$schedulerScript = Join-Path $PSScriptRoot "scheduler-start.ps1"
$monitorScript = Join-Path $PSScriptRoot "guardian-monitor.ps1"
$serverScript = Join-Path $PSScriptRoot "opencode-server.ps1"
$agentProgressScript = Join-Path $PSScriptRoot "agent-progress.ps1"

foreach ($script in @($schedulerScript, $monitorScript, $serverScript, $agentProgressScript)) {
  if (-not (Test-Path -LiteralPath $script)) { throw "Required script not found: $script" }
}
if (-not $DryRun -and -not (Test-Path -LiteralPath $TargetRepo)) {
  throw "Target repository not found: $TargetRepo"
}

$serverUrl = "http://127.0.0.1:$OpenCodePort"
$progressDir = Join-Path $TargetRepo ".qa\guardian\progress\$Issue"
if (-not $DryRun) {
  Remove-Item -LiteralPath $progressDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $progressDir -Force | Out-Null
}
$serverArgs = @(
  '-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', $serverScript,
  '-TargetRepo', $TargetRepo, '-Port', [string]$OpenCodePort
)
$schedulerArgs = @(
  '-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', $schedulerScript,
  '-TargetRepo', $TargetRepo, '-SchedulerOnly', '-OpenCodeServerUrl', $serverUrl,
  '-ProgressDir', $progressDir
)
$monitorArgs = @(
  '-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', $monitorScript,
  '-TargetRepo', $TargetRepo, '-Issue', [string]$Issue, '-RefreshSeconds', [string]$RefreshSeconds
)
$launches = @(
  [ordered]@{ file_path = 'powershell.exe'; arguments = $serverArgs },
  [ordered]@{ file_path = 'powershell.exe'; arguments = $schedulerArgs },
  [ordered]@{ file_path = 'powershell.exe'; arguments = $monitorArgs }
)
foreach ($role in @('guardian-code', 'guardian-business', 'guardian-runtime')) {
  $launches += [ordered]@{
    file_path = 'powershell.exe'
    arguments = @(
      '-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', $agentProgressScript,
      '-TargetRepo', $TargetRepo, '-Issue', [string]$Issue, '-Agent', $role,
      '-ProgressDir', $progressDir
    )
  }
}

if ($DryRun) {
  $launches | ConvertTo-Json -Depth 5 -Compress
  return
}

function Convert-ToCommandLineArguments([string[]]$Arguments) {
  return @($Arguments | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
  })
}

foreach ($launch in $launches) {
  Start-Process -FilePath $launch.file_path -ArgumentList (Convert-ToCommandLineArguments $launch.arguments) | Out-Null
}

Write-Host "Opened OpenCode server, scheduler, and live monitor for issue #$Issue." -ForegroundColor Green
