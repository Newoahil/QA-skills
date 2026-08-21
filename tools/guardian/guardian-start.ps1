#requires -Version 5.1
<##
.SYNOPSIS
  Starts the Guardian scheduler and read-only TUI with one double-click.

.DESCRIPTION
  The scheduler runs in a separate PowerShell window while the current window owns the
  interactive TUI. This launcher only reads an existing per-project binding; initialize a
  project once with scheduler-start.ps1 before using this combined entrypoint.
##>
[CmdletBinding()]
param(
  [string]$TargetRepo = "",
  [switch]$SchedulerOnly,
  [switch]$DryRun,
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$GuardianRepo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$bindingPath = Join-Path $PSScriptRoot "scheduler.config.json"
$schedulerScript = Join-Path $PSScriptRoot "scheduler-start.ps1"
$tuiScript = Join-Path $PSScriptRoot "dashboard-tui.mjs"

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
  if ((Canonical-LauncherPath ([string]$Config.canonical_target_path)) -eq $canonical) { return $Config }
  return $null
}

function Normalize-LauncherCommandAuthors($Value) {
  if ($null -eq $Value) { return @() }
  if ($Value -is [System.Array]) {
    return @($Value | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
  }
  return @(([string]$Value -split '[,\s]+' | ForEach-Object { $_.Trim() } | Where-Object { $_ }))
}

function Read-GuardianCommandAuthors([string]$Repo) {
  $configPath = Join-Path $Repo '.qa\guardian\config.json'
  if (-not (Test-Path -LiteralPath $configPath)) { return @() }
  try {
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    return Normalize-LauncherCommandAuthors $config.command_authors
  } catch { return @() }
}

function Resolve-LauncherCommandAuthors($Binding, [string]$TargetRepo, [string]$ControlRepo) {
  if ($Binding -and ($Binding.PSObject.Properties.Name -contains 'command_authors')) {
    $authors = Normalize-LauncherCommandAuthors $Binding.command_authors
    if ($authors.Count -gt 0) { return $authors }
  }
  $authors = Read-GuardianCommandAuthors $ControlRepo
  if ($authors.Count -gt 0) { return $authors }
  if ((Canonical-LauncherPath $ControlRepo) -ne (Canonical-LauncherPath $TargetRepo)) {
    $authors = Read-GuardianCommandAuthors $TargetRepo
    if ($authors.Count -gt 0) { return $authors }
  }
  return @()
}

function Find-Node {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $candidates = @(
    "$env:ProgramFiles\nodejs\node.exe",
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  throw "node not found. Install Node.js >= 18 or run from a terminal with node on PATH."
}

if (-not $TargetRepo) {
  Write-Host "    Enter the Guardian target repo path. This combined launcher only reads an existing binding." -ForegroundColor Yellow
  $TargetRepo = Read-Host -Prompt 'Target repo path (blank to cancel)'
  if (-not $TargetRepo) { throw "Cancelled: target repo is required." }
  $TargetRepo = $TargetRepo.Trim([char]34)
}

if (-not (Test-Path -LiteralPath $TargetRepo -PathType Container)) {
  throw "Target repository does not exist or is not a directory: $TargetRepo"
}
$TargetRepo = (Resolve-Path -LiteralPath $TargetRepo).Path
$binding = Select-LauncherBinding (Read-LauncherConfig $bindingPath) $TargetRepo
if (-not $binding) {
  throw "No Guardian binding found for this project. Run scheduler-start.bat once to initialize the project, then use guardian-start.bat."
}
if (-not (Test-Path -LiteralPath $schedulerScript)) { throw "scheduler-start.ps1 not found: $schedulerScript" }
if (-not (Test-Path -LiteralPath $tuiScript)) { throw "dashboard-tui.mjs not found: $tuiScript" }

$nodeExe = Find-Node
$controlRepo = $TargetRepo
if ($binding.mode -eq 'worktree' -and $binding.control_worktree_path) {
  $controlRepo = [string]$binding.control_worktree_path
}
$commandAuthors = Resolve-LauncherCommandAuthors $binding $TargetRepo $controlRepo
if ($commandAuthors.Count -eq 0 -and -not $DryRun) {
  $authorInput = Read-Host -Prompt 'Trusted GitHub command authors (comma or space separated, blank to cancel)'
  $commandAuthors = Normalize-LauncherCommandAuthors $authorInput
  if ($commandAuthors.Count -eq 0) { throw 'Cancelled: trusted GitHub command authors are required.' }
}
$commandAuthorArgument = ($commandAuthors -join ',')
# Mirror specialist investigation progress into the authoritative control guardian dir so the
# read-only TUI Logs tab (progress/<issue>/<agent>.log) shows live progress during investigation.
$progressDir = Join-Path (Join-Path $controlRepo '.qa\guardian') 'progress'

$schedulerArguments = @(
  '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $schedulerScript,
  '-TargetRepo', $TargetRepo, '-Yes', '-ProgressDir', $progressDir
)
if ($commandAuthorArgument) { $schedulerArguments += @('-CommandAuthors', $commandAuthorArgument) }
if ($SchedulerOnly) { $schedulerArguments += '-SchedulerOnly' }
$schedulerPreflightArguments = $schedulerArguments + '-DryRun'
$tuiArguments = @($tuiScript, '--repo', $TargetRepo)
$launchPlan = [ordered]@{
  target_repo = $TargetRepo
  control_repo = $controlRepo
  scheduler = [ordered]@{ file_path = 'powershell.exe'; arguments = $schedulerArguments }
  scheduler_preflight = [ordered]@{ file_path = 'powershell.exe'; arguments = $schedulerPreflightArguments }
  tui = [ordered]@{ file_path = $nodeExe; arguments = $tuiArguments }
  command_authors_source = if ($commandAuthorArgument) { 'binding_or_config' } else { 'missing' }
  progress_dir = $progressDir
  read_only_tui = $true
}

if ($DryRun) {
  $launchPlan | ConvertTo-Json -Depth 6 -Compress
  return
}

$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  & powershell.exe @schedulerPreflightArguments
  $schedulerPreflightExitCode = $LASTEXITCODE
} finally { $ErrorActionPreference = $previousErrorActionPreference }
if ($schedulerPreflightExitCode -ne 0) {
  throw "Scheduler preflight failed. Fix the error above before opening the read-only TUI."
}

$schedulerTitle = "QA Guardian Scheduler - $TargetRepo"
$quotedSchedulerScript = $schedulerScript.Replace("'", "''")
$quotedTargetRepo = $TargetRepo.Replace("'", "''")
$quotedProgressDir = $progressDir.Replace("'", "''")
$schedulerCommand = "& '$quotedSchedulerScript' -TargetRepo '$quotedTargetRepo' -Yes -ProgressDir '$quotedProgressDir'"
if ($commandAuthorArgument) {
  $quotedCommandAuthors = $commandAuthorArgument.Replace("'", "''")
  $schedulerCommand += " -CommandAuthors '$quotedCommandAuthors'"
}
if ($SchedulerOnly) { $schedulerCommand += ' -SchedulerOnly' }
$schedulerWindowArguments = @('-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $schedulerCommand)
Start-Process -FilePath 'powershell.exe' -WorkingDirectory $GuardianRepo -WindowStyle Normal -ArgumentList $schedulerWindowArguments -PassThru | Out-Null
Write-Host "==> Scheduler started in a separate window: $schedulerTitle" -ForegroundColor Green
Write-Host "    This window is now the read-only TUI. Press q to exit TUI; scheduler keeps running." -ForegroundColor Gray
Start-Sleep -Milliseconds 500
& $nodeExe @tuiArguments
