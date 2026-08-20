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

function Resolve-ControlRepo([string]$CanonicalRepo) {
  $bindingPath = Join-Path $GuardianRepo "tools\guardian\scheduler.config.json"
  if (-not (Test-Path -LiteralPath $bindingPath)) { return $CanonicalRepo }
  $binding = Get-Content -LiteralPath $bindingPath -Raw | ConvertFrom-Json
  if ($binding.mode -eq 'worktree' -and $binding.canonical_target_path -eq (Resolve-Path $CanonicalRepo).Path -and $binding.control_worktree_path) {
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

if (-not $TargetRepo) { $TargetRepo = $env:QA_GUARDIAN_REPO }
if (-not $TargetRepo) {
  $schedulerConfig = Join-Path $GuardianRepo "tools\guardian\scheduler.config.json"
  if (Test-Path -LiteralPath $schedulerConfig) {
    $saved = Get-Content -LiteralPath $schedulerConfig -Raw | ConvertFrom-Json
    if ($saved.target_repo) { $TargetRepo = [string]$saved.target_repo }
    elseif ($saved.canonical_target_path) { $TargetRepo = [string]$saved.canonical_target_path }
  }
}
if (-not $TargetRepo) {
  $cwd = (Get-Location).Path
  if (Test-Path -LiteralPath (Join-Path $cwd ".qa\guardian\config.json")) {
    $TargetRepo = $cwd
  }
}
if (-not $TargetRepo) {
  Write-Host "    未指定目标项目。Dashboard 只读，不会启动 scheduler，也不会写状态或 GitHub。" -ForegroundColor Yellow
  $TargetRepo = Read-Host "    请输入目标项目目录（例如 D:\tuantuanrent，直接回车取消）"
  if (-not $TargetRepo) { throw "已取消：目标项目目录不能为空。" }
  $TargetRepo = $TargetRepo.Trim([char]34)
}
if (-not (Test-Path -LiteralPath $TargetRepo)) { throw "目标项目目录不存在：$TargetRepo" }

$nodeExe = Find-Node
Write-Host "==> QA Guardian 只读 Dashboard" -ForegroundColor Cyan
Write-Host "    Node       : $nodeExe"
Write-Host "    工具目录   : $GuardianRepo"
Write-Host "    目标项目   : $TargetRepo"
Write-Host "    提示       : 按 Ctrl+C 停止刷新。" -ForegroundColor Gray
Write-Host "    会话查看   : node tools/guardian/session-view.mjs --repo `"$TargetRepo`" --issue <编号> --agent fixer" -ForegroundColor Gray

$controlRepo = Resolve-ControlRepo $TargetRepo
Write-Host "    权威状态   : $controlRepo"
& $nodeExe (Join-Path $GuardianRepo "tools\guardian\dashboard.mjs") --repo $controlRepo --watch 5
