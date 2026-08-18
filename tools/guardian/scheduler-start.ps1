#requires -Version 5.1
<#
.SYNOPSIS
  One-click launcher for the QA Guardian resident scheduler (Windows).

.DESCRIPTION
  Resolves node/gh/git onto PATH for this session (nvm layouts included), verifies the target
  repo + .qa/guardian/config.json exist with a command_authors whitelist (the security-required
  fail-closed key), then starts scheduler.mjs watching the target repo. No global PATH changes.

.PARAMETER TargetRepo
  The repository the scheduler watches. If omitted, resolved by precedence:
    1. -TargetRepo argument
    2. env QA_GUARDIAN_REPO
    3. tools/guardian/scheduler.config.json  { "target_repo": "..." }  (gitignored)
    4. current directory

.PARAMETER Init
  Create .qa/guardian/config.json for the target repo if it does not exist, then start. When the
  config is missing and -Init is not given, the script offers to create it interactively.

.PARAMETER CommandAuthors
  Comma/space-separated GitHub logins allowed to drive /guardian commands (written into config on
  init). Required for a non-interactive init.

.PARAMETER BaseBranch
  PR base branch written into config on init. Default: dev.

.EXAMPLE
  ./tools/guardian/scheduler-start.ps1 -TargetRepo D:\tuantuanrent
  ./tools/guardian/scheduler-start.ps1 -TargetRepo D:\tuantuanrent -Init -CommandAuthors goudaren0528
  $env:QA_GUARDIAN_REPO="D:\tuantuanrent"; ./tools/guardian/scheduler-start.ps1
#>
[CmdletBinding()]
param(
  [string]$TargetRepo = "",
  [switch]$Init,
  [string]$CommandAuthors = "",
  [string]$BaseBranch = "dev"
)

$ErrorActionPreference = "Stop"
# Keep Chinese guidance readable in Windows PowerShell/cmd UTF-8 consoles.
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$GuardianRepo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

# Resolve target repo by precedence: param > env > sibling config file > current directory only
# when it is already a configured target repo; otherwise ask instead of silently watching QA-skills.
if (-not $TargetRepo) { $TargetRepo = $env:QA_GUARDIAN_REPO }
if (-not $TargetRepo) {
  $schedCfg = Join-Path $PSScriptRoot "scheduler.config.json"
  if (Test-Path -LiteralPath $schedCfg) {
    $sc = Get-Content -LiteralPath $schedCfg -Raw | ConvertFrom-Json
    if ($sc.target_repo) { $TargetRepo = $sc.target_repo }
  }
}
if (-not $TargetRepo) {
  $cwd = (Get-Location).Path
  if (Test-Path -LiteralPath (Join-Path $cwd ".qa\guardian\config.json")) {
    $TargetRepo = $cwd
  } else {
    Write-Host "    未指定目标项目，不能默认监控 QA-skills 工具仓库。" -ForegroundColor Yellow
    $inputRepo = Read-Host "    请输入要监控的项目目录（例如 D:\tuantuanrent，直接回车取消）"
    if (-not $inputRepo) { throw "已取消：请通过 -TargetRepo、QA_GUARDIAN_REPO 或 scheduler.config.json 指定目标项目。" }
    $TargetRepo = $inputRepo.Trim('"')
  }
}

function Find-Node {
  $c = Get-Command node -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $cands = @(
    "$env:ProgramFiles\nodejs\node.exe",
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
  )
  # nvm-windows: newest version dir under AppData\Local\nvm
  $nvm = Join-Path $env:LOCALAPPDATA "nvm"
  if (Test-Path $nvm) {
    Get-ChildItem $nvm -Directory -Filter "v*" -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      ForEach-Object { $cands += (Join-Path $_.FullName "node.exe") }
  }
  foreach ($p in $cands) { if (Test-Path $p) { return $p } }
  throw "node not found. Install Node.js >= 18 or add it to PATH."
}

function Ensure-OnPath($dir) {
  if ($dir -and (Test-Path $dir) -and ($env:PATH -notlike "*$dir*")) {
    $env:PATH = "$dir;$env:PATH"
  }
}

$nodeExe = Find-Node
Ensure-OnPath (Split-Path $nodeExe -Parent)
Ensure-OnPath "C:\Program Files\GitHub CLI"
Ensure-OnPath "C:\Program Files\Git\cmd"
Ensure-OnPath "C:\Program Files\Git\bin"

Write-Host "==> QA Guardian 值守服务" -ForegroundColor Cyan
Write-Host "    Node        : $nodeExe"
Write-Host "    Guardian目录: $GuardianRepo"
Write-Host "    目标项目    : $TargetRepo"

$packageRoot = Join-Path $GuardianRepo "package.json"
$sdkPath = Join-Path $GuardianRepo "node_modules\@larksuiteoapi\node-sdk"
if ((Test-Path $packageRoot) -and -not (Test-Path $sdkPath)) {
  Write-Host "    [warn] Feishu SDK not installed — run npm install in $GuardianRepo before enabling WS." -ForegroundColor Yellow
}

if (-not (Test-Path -LiteralPath $TargetRepo)) { throw "目标项目目录不存在: $TargetRepo" }

# gh must be authenticated (the scheduler runs gh under the hood).
$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) { Write-Host "    [提示] 未找到 gh，请先安装 GitHub CLI 并执行 gh auth login。" -ForegroundColor Yellow }
else { & gh auth status *> $null; if ($LASTEXITCODE -ne 0) { Write-Host "    [提示] gh 尚未登录，请先执行 gh auth login。" -ForegroundColor Yellow } }

# config + command_authors (fail-closed security key). If it already exists, start directly.
# If it is missing: create it via -Init (or an interactive prompt), then start.
$configPath = Join-Path $TargetRepo ".qa\guardian\config.json"
if (-not (Test-Path -LiteralPath $configPath)) {
  $authors = $CommandAuthors
  if (-not $Init -and -not $authors) {
    Write-Host "    尚未找到项目配置: $configPath" -ForegroundColor Yellow
    Write-Host "    需要创建 .qa\guardian\config.json，才能启动值守服务。" -ForegroundColor Yellow
    $ans = Read-Host "    请输入可信 GitHub 登录名（多个用逗号或空格分隔，直接回车取消）"
    if (-not $ans) { throw "已取消：未创建配置文件。请重新运行并输入 GitHub 登录名，例如 goudaren0528。" }
    $authors = $ans
  }
  if (-not $authors) {
    throw "缺少 $configPath，且没有指定可信 GitHub 登录名。请使用 -Init -CommandAuthors goudaren0528 重新运行。"
  }
  $list = @($authors -split '[,\s]+' | Where-Object { $_ })
  $guardianDir = Join-Path $TargetRepo ".qa\guardian"
  New-Item -ItemType Directory -Force -Path $guardianDir | Out-Null
  $newCfg = [ordered]@{
    command_authors  = $list
    base_branch      = $BaseBranch
    poll_interval_ms = 60000
    lease_ms         = 1800000
  }
  # Write UTF-8 WITHOUT BOM — PowerShell 5.1 Set-Content -Encoding utf8 adds a BOM that breaks node JSON.parse.
  [System.IO.File]::WriteAllText($configPath, (($newCfg | ConvertTo-Json) + "`n"), (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "    [完成] 已创建配置: $configPath" -ForegroundColor Green
  Write-Host "    可信命令作者: $($list -join ', ')" -ForegroundColor Green
}
$cfg = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if (-not $cfg.command_authors -or @($cfg.command_authors).Count -eq 0) {
  Write-Host "    [提示] command_authors 为空：所有 /guardian 命令都会被拒绝（安全保护）。" -ForegroundColor Yellow
} else {
  Write-Host "    可信命令作者: $($cfg.command_authors -join ', ')" -ForegroundColor Green
}

Write-Host "==> 正在启动 Guardian 组合服务（scheduler + 飞书长连接）" -ForegroundColor Cyan
Write-Host "    提示：按 Ctrl+C 可停止；首次启动前请确认已执行 npm install 并配置飞书凭证。" -ForegroundColor Gray
& $nodeExe (Join-Path $GuardianRepo "tools\guardian\guardian-runtime.mjs") --repo $TargetRepo
