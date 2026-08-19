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
  [int]$Port = 4097
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

if (-not (Test-Path -LiteralPath $TargetRepo)) { throw "Target repository not found: $TargetRepo" }
$opencode = Find-OpenCode
Write-Host "==> OpenCode shared server" -ForegroundColor Cyan
Write-Host "    Binary : $opencode"
Write-Host "    Repo   : $TargetRepo"
Write-Host "    URL    : http://127.0.0.1:$Port"
Write-Host "    Plugins: enabled (shared once for all Guardian agents)" -ForegroundColor Green
Write-Host "    Press Ctrl+C to stop." -ForegroundColor Gray

& $opencode serve --hostname 127.0.0.1 --port $Port --print-logs --log-level INFO
