#requires -Version 5.1
<##
.SYNOPSIS
  Starts one visible OpenCode server with the full external plugin stack.

.DESCRIPTION
  Specialist and fixer runs attach to this server instead of cold-starting plugins/indexes in
  separate processes. The server remains local-only on 127.0.0.1.
##>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$TargetRepo,

  [ValidateRange(1024, 65535)]
  [int]$Port = 4097,

  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$Host.UI.RawUI.WindowTitle = "QA Guardian OpenCode Server :$Port"

function Find-OpenCode {
  if ($env:QA_GUARDIAN_OPENCODE_BIN -and (Test-Path -LiteralPath $env:QA_GUARDIAN_OPENCODE_BIN)) {
    return $env:QA_GUARDIAN_OPENCODE_BIN
  }
  $candidate = Join-Path $env:APPDATA "npm\node_modules\opencode-ai\bin\opencode.exe"
  if (Test-Path -LiteralPath $candidate) { return $candidate }
  $command = Get-Command opencode -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  throw "opencode executable not found"
}

function Find-Node {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $candidates = @(
    "$env:ProgramFiles\nodejs\node.exe",
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
  )
  $nvm = Join-Path $env:LOCALAPPDATA "nvm"
  if (Test-Path -LiteralPath $nvm) {
    Get-ChildItem -LiteralPath $nvm -Directory -Filter "v*" -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      ForEach-Object { $candidates += (Join-Path $_.FullName "node.exe") }
  }
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  throw "node executable not found"
}

function Find-Npm([string]$NodeExe) {
  $command = Get-Command npm -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $nodeDir = Split-Path $NodeExe -Parent
  foreach ($candidate in @(
    (Join-Path $nodeDir "npm.cmd"),
    (Join-Path $env:APPDATA "npm\npm.cmd"),
    "C:\Program Files\nodejs\npm.cmd"
  )) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  throw "npm executable not found"
}

function Find-Git {
  $command = Get-Command git -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  foreach ($candidate in @(
    "C:\Program Files\Git\cmd\git.exe",
    "C:\Program Files\Git\bin\git.exe"
  )) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  throw "git executable not found"
}

function Ensure-OnPath([string]$Directory) {
  if ($Directory -and (Test-Path -LiteralPath $Directory) -and ($env:PATH -notlike "*$Directory*")) {
    $env:PATH = "$Directory;$env:PATH"
  }
}

if (-not (Test-Path -LiteralPath $TargetRepo)) { throw "Target repository not found: $TargetRepo" }
$opencode = Find-OpenCode
$node = Find-Node
$npm = Find-Npm $node
$git = Find-Git

foreach ($tool in @($opencode, $node, $npm, $git)) {
  Ensure-OnPath (Split-Path $tool -Parent)
}

if ($DryRun) {
  [ordered]@{ opencode = $opencode; node = $node; npm = $npm; git = $git } |
    ConvertTo-Json -Compress
  return
}

Write-Host "==> OpenCode shared server" -ForegroundColor Cyan
Write-Host "    Binary : $opencode"
Write-Host "    Node   : $node"
Write-Host "    npm    : $npm"
Write-Host "    Git    : $git"
Write-Host "    Repo   : $TargetRepo"
Write-Host "    URL    : http://127.0.0.1:$Port"
Write-Host "    Plugins: enabled (shared once for all Guardian agents)" -ForegroundColor Green
Write-Host "    Press Ctrl+C to stop." -ForegroundColor Gray

& $opencode serve --hostname 127.0.0.1 --port $Port --print-logs --log-level INFO
