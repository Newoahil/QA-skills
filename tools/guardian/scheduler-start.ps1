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
    3. persisted last_target_repo in tools/guardian/scheduler.config.json (gitignored)
    4. current directory

.PARAMETER Init
  Create .qa/guardian/config.json for the target repo if it does not exist, then start. When the
  config is missing and -Init is not given, the script offers to create it interactively.

.PARAMETER CommandAuthors
  Comma/space-separated GitHub logins allowed to drive /guardian commands (written into config on
  init). Required for a non-interactive init.

.PARAMETER BaseBranch
  PR base branch written into config on init. Default: dev.

.PARAMETER GitHubRepo
  GitHub repository in owner/name form. If omitted, inferred from git remote origin or requested
  interactively when config is created/refreshed.

.PARAMETER WatchMode
  Watch strategy written into config on init. Default: new-open.

.PARAMETER DryRun
  Render the resolved launch plan and preflight facts as JSON, then exit without starting scheduler.

.PARAMETER Dashboard
  Run the read-only Chinese dashboard after preflight instead of starting scheduler or Feishu runtime.

.PARAMETER SchedulerOnly
  Start only scheduler.mjs. Skips the optional Feishu WebSocket runtime; useful for local polling
  runs and visible E2E monitoring.

.PARAMETER OpenCodeServerUrl
  Reuse an already initialized OpenCode server for specialists and fixer runs. This preserves all
  external plugin capabilities while avoiding one cold plugin/index initialization per agent.

.PARAMETER ProgressDir
  Directory where specialist progress streams are mirrored for dedicated visible terminals.

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
  [string]$BaseBranch = "dev",
  [string]$GitHubRepo = "",
  [ValidateSet("new-open", "labeled")]
  [string]$WatchMode = "new-open",
  [switch]$SchedulerOnly,
  [string]$OpenCodeServerUrl = "",
  [string]$ProgressDir = "",
  [switch]$Dashboard,
  [switch]$DryRun,
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
# Keep Chinese guidance readable in Windows PowerShell/cmd UTF-8 consoles.
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$GuardianRepo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$bindingPath = Join-Path $PSScriptRoot "scheduler.config.json"
$TargetRepoWasExplicit = -not [string]::IsNullOrWhiteSpace($TargetRepo)

function Read-LauncherConfig([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json } catch { return $null }
}

function Read-LauncherBinding([string]$Path) {
  return Read-LauncherConfig $Path
}

function Canonical-LauncherPath([string]$Value) {
  if (-not $Value) { return "" }
  return ([IO.Path]::GetFullPath($Value)).TrimEnd('\').ToLowerInvariant()
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

function Save-LauncherBinding([string]$Path, [string]$CanonicalTarget, $Binding) {
  $existing = Read-LauncherConfig $Path
  $projects = [ordered]@{}
  if ($existing -and $existing.projects) {
    foreach ($property in $existing.projects.PSObject.Properties) {
      $projectKey = Canonical-LauncherPath ([string]$property.Name)
      if ($projectKey) { $projects[$projectKey] = $property.Value }
    }
  }
  $projects[$CanonicalTarget] = $Binding
  $config = [ordered]@{
    version = 2
    last_target_repo = $CanonicalTarget
    projects = $projects
  }
  Write-JsonUtf8 $Path $config
}

# Always choose the target when no explicit -TargetRepo was supplied. A project binding is
# remembered for reuse, but it must not silently choose which project to watch.
if (-not $TargetRepoWasExplicit) {
  Write-Host "    每次启动都需要指定本次值守项目，不能默认使用上次项目。" -ForegroundColor Yellow
  $inputRepo = Read-Host "    请输入要监控的项目目录（例如 D:\tuantuanrent，直接回车取消）"
  if (-not $inputRepo) { throw "已取消：请通过 -TargetRepo 指定本次值守项目。" }
  $TargetRepo = $inputRepo.Trim('"')
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

function Invoke-Git([string]$Repo, [string[]]$GitArgs, [switch]$AllowFailure) {
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $out = & git -C $Repo @GitArgs 2>&1
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousErrorActionPreference }
  if ($code -ne 0 -and -not $AllowFailure) { throw "git $($GitArgs -join ' ') failed in ${Repo}: $out" }
  return [ordered]@{ code = $code; output = ($out -join "`n").Trim() }
}

function Normalize-GitHubRepo([string]$Value) {
  if (-not $Value) { return "" }
  $v = $Value.Trim().Trim('"')
  if ($v -match '^(?<owner>[^/\s]+)/(?<name>[^/\s]+?)(?:\.git)?$') { return "$($Matches.owner)/$($Matches.name)" }
  if ($v -match '^https?://github\.com/(?<owner>[^/]+)/(?<name>[^/#?]+?)(?:\.git)?/?(?:[?#].*)?$') {
    return "$($Matches.owner)/$($Matches.name)"
  }
  if ($v -match '^git@github\.com:(?<owner>[^/]+)/(?<name>[^/]+?)(?:\.git)?$') {
    return "$($Matches.owner)/$($Matches.name)"
  }
  return ""
}

function Infer-GitHubRepo([string]$Repo) {
  $remote = Invoke-Git $Repo @('remote', 'get-url', 'origin') -AllowFailure
  if ($remote.code -ne 0 -or -not $remote.output) { return "" }
  $value = $remote.output.Trim()
  return Normalize-GitHubRepo $value
}

function Current-GitBranch([string]$Repo) {
  $branch = Invoke-Git $Repo @('branch', '--show-current')
  if (-not $branch.output) { throw "无法确定当前 git 分支: $Repo" }
  return $branch.output
}

function Assert-CleanAndLatest([string]$Repo, [string]$Branch, [string]$Label, [switch]$AllowBehind) {
  $inside = Invoke-Git $Repo @('rev-parse', '--is-inside-work-tree')
  if ($inside.output -ne 'true') { throw "$Label 不是 git 仓库: $Repo" }
  $status = Invoke-Git $Repo @('status', '--porcelain')
  if ($status.output) { throw "$Label 工作区不干净，请先提交/暂存/清理后再启动: $Repo" }
  $remote = Invoke-Git $Repo @('remote', 'get-url', 'origin')
  if (-not $remote.output) { throw "$Label 缺少 origin remote: $Repo" }
  Invoke-Git $Repo @('fetch', 'origin', $Branch) | Out-Null
  $local = Invoke-Git $Repo @('rev-parse', $Branch)
  $upstream = Invoke-Git $Repo @('rev-parse', "origin/$Branch")
  $inSync = $local.output -eq $upstream.output
  if (-not $inSync -and -not $AllowBehind) { throw "$Label 本地 $Branch 与 origin/$Branch 不一致，请先同步到远端最新主分支。" }
  if (-not $inSync) { Write-Host "    [提示] $Label 本地版本不是远端最新，将继续使用本地版本运行。" -ForegroundColor Yellow }
  return [ordered]@{ label = $Label; repo = $Repo; branch = $Branch; remote = $remote.output; commit = $local.output; upstream_commit = $upstream.output; in_sync = $inSync }
}

function Assert-CleanAndUpstreamLatest([string]$Repo, [string]$Label) {
  $branch = Current-GitBranch $Repo
  return Assert-CleanAndLatest $Repo $branch $Label -AllowBehind
}

function Confirm-Start($message) {
  if ($Yes -or $DryRun) { return }
  $ans = Read-Host $message
  if ($ans -notmatch '^(y|yes|是|确认)$') { throw "已取消：未确认启动。" }
}

function Write-JsonUtf8([string]$Path, $Value) {
  [System.IO.File]::WriteAllText($Path, (($Value | ConvertTo-Json -Depth 12) + "`n"), (New-Object System.Text.UTF8Encoding($false)))
}

function Assert-PersistedBinding($Binding, [string]$CanonicalTarget, [string]$GuardianRepoPath) {
  if (-not $Binding) { throw "未找到启动绑定，请先交互式运行 scheduler-start.ps1 完成一次模式选择。" }
  if ([int]$Binding.version -ne 1) { throw "启动绑定版本无效，请删除本地 scheduler.config.json 后重新交互式启动。" }
  if (@('strict', 'worktree') -notcontains [string]$Binding.mode) { throw "启动绑定模式无效，请删除本地 scheduler.config.json 后重新交互式启动。" }
  if ((Canonical-LauncherPath $Binding.canonical_target_path) -ne (Canonical-LauncherPath $CanonicalTarget)) { throw "启动绑定与当前 canonical target 不匹配，请删除本地 scheduler.config.json 后重新交互式启动。" }
  if ($Binding.target_repo -and (Canonical-LauncherPath $Binding.target_repo) -ne (Canonical-LauncherPath $CanonicalTarget)) { throw "启动绑定 target_repo 与当前 canonical target 不匹配，请删除本地 scheduler.config.json 后重新交互式启动。" }
  if ((Canonical-LauncherPath $Binding.guardian_repo_path) -ne (Canonical-LauncherPath $GuardianRepoPath)) { throw "启动绑定与当前 Guardian 工具仓库不匹配，请删除本地 scheduler.config.json 后重新交互式启动。" }
  if (-not $Binding.base_branch) { throw "启动绑定缺少 base_branch，请删除本地 scheduler.config.json 后重新交互式启动。" }
  if ($null -eq $Binding.selected_runtime_input_paths -or @($Binding.selected_runtime_input_paths).Count -eq 0) { $Binding.selected_runtime_input_paths = @() }
  foreach ($input in @($Binding.selected_runtime_input_paths)) { Assert-RelativeRuntimeInput ([string]$input) | Out-Null }
  if ([string]$Binding.mode -eq 'worktree') {
    if (-not $Binding.control_worktree_path -or -not $Binding.qa_snapshot_path) { throw "worktree 启动绑定缺少 control worktree 或 QA snapshot 路径。" }
    if ((Canonical-LauncherPath $Binding.control_worktree_path) -eq (Canonical-LauncherPath $CanonicalTarget) -or (Canonical-LauncherPath $Binding.qa_snapshot_path) -eq (Canonical-LauncherPath $CanonicalTarget)) { throw "control worktree 和 QA snapshot 不能等于 canonical target。" }
    if ((Canonical-LauncherPath $Binding.control_worktree_path) -eq (Canonical-LauncherPath $Binding.qa_snapshot_path)) { throw "control worktree 和 QA snapshot 不能使用同一路径。" }
  }
  if ($Binding.git_identity -and ([string]$Binding.git_identity).Trim() -eq '') { throw "启动绑定 git_identity 无效，请删除本地 scheduler.config.json 后重新交互式启动。" }
  return $Binding
}

function Assert-RelativeRuntimeInput([string]$Value) {
  $v = $Value.Trim().Replace('\', '/')
  if (-not $v -or $v.StartsWith('/') -or $v -match '^[A-Za-z]:/' -or $v -match '(^|/)\.\.?(/|$)' -or $v -match '(^|/)(\.git|\.qa|node_modules)(/|$)') {
    throw "runtime 输入路径不安全：必须是仓库相对路径，且不能 traversal、.git、.qa 或 node_modules。"
  }
  return $v
}

function Assert-NoSymlinkEscape([string]$Repo, [string]$RelativePath) {
  $source = Join-Path $Repo ($RelativePath -replace '/', '\')
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "选定 runtime 输入不存在或不是普通文件：$RelativePath" }
  $item = Get-Item -LiteralPath $source -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "选定 runtime 输入不能是符号链接或 reparse point：$RelativePath" }
  return $source
}

function Copy-SelectedRuntimeInput([string]$SourceRepo, [string]$DestinationRepo, [string[]]$RelativePaths) {
  foreach ($relative in $RelativePaths) {
    $safe = Assert-RelativeRuntimeInput $relative
    $source = Assert-NoSymlinkEscape $SourceRepo $safe
    $destination = Join-Path $DestinationRepo ($safe -replace '/', '\')
    if (Test-Path -LiteralPath $destination) {
      $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
      $destinationHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
      if ($sourceHash -ne $destinationHash) { throw "QA snapshot 已存在不同的 runtime 输入：$safe。请删除该 snapshot 后重新交互式绑定；未覆盖任何文件。" }
      continue
    }
    $parent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
  }
}

function Ensure-ControlWorktree([string]$SourceRepo, [string]$Destination, [string]$Base) {
  if (-not (Test-Path -LiteralPath $Destination)) {
    Invoke-Git $SourceRepo @('fetch', 'origin', $Base) | Out-Null
    $added = Invoke-Git $SourceRepo @('worktree', 'add', '--detach', $Destination, "origin/$Base")
    if ($added.code -ne 0) { throw "无法创建 Guardian control worktree，请检查 base 分支和路径权限。" }
  }
  $inside = Invoke-Git $Destination @('rev-parse', '--is-inside-work-tree')
  if ($inside.code -ne 0 -or $inside.output -ne 'true') { throw "已存在的 control worktree 路径不是有效 git worktree：$Destination" }
  $status = Invoke-Git $Destination @('status', '--porcelain')
  $unownedDirty = @(($status.output -split "`r?`n") | Where-Object {
    $line = $_.Trim()
    if ($line.Length -lt 3) { return $false }
    # Invoke-Git trims the complete output, so porcelain's leading status space is already gone.
    # The remaining two status columns still occupy the first two characters.
    $p = $line.Substring(2).Trim().Replace('\', '/')
    $p -and -not ($p -match '^(\.qa/guardian/|\.sybermem/|\.scheduler\.lock$|watch-state\.json$)')
  })
  if ($unownedDirty.Count -gt 0) { throw "control worktree 存在 Guardian 状态之外的工作区修改，已停止以避免覆盖现有修改：$Destination" }
}

function Ensure-QaSnapshot([string]$SourceRepo, [string]$Destination, [string]$Base) {
  if (-not (Test-Path -LiteralPath $Destination)) {
    Invoke-Git $SourceRepo @('fetch', 'origin', $Base) | Out-Null
    $added = Invoke-Git $SourceRepo @('worktree', 'add', '--detach', $Destination, "origin/$Base")
    if ($added.code -ne 0) { throw "无法创建 QA snapshot，请检查 base 分支和路径权限。" }
  }
  $inside = Invoke-Git $Destination @('rev-parse', '--is-inside-work-tree')
  if ($inside.code -ne 0 -or $inside.output -ne 'true') { throw "已存在的 QA snapshot 路径不是有效 git worktree：$Destination" }
  $reset = Invoke-Git $Destination @('reset', '--hard', "origin/$Base")
  if ($reset.code -ne 0) { throw "无法将 QA snapshot 重置到 clean origin/$Base。" }
}

function Initialize-WorktreeBinding([string]$CanonicalRepo, [string]$Base, [string]$BindingPath, [switch]$ForDryRun) {
  $controlDefault = "$CanonicalRepo.qa-guardian-control"
  $snapshotDefault = "$CanonicalRepo.qa-guardian-qa"
  $control = $controlDefault
  $snapshot = $snapshotDefault
  $defaultRuntimeInputs = @('.env.test', '.env.local.test', 'config/test.json', 'config/testing.json')
  $inputs = @($defaultRuntimeInputs | Where-Object { Test-Path -LiteralPath (Join-Path $CanonicalRepo ($_ -replace '/', '\')) } | ForEach-Object { Assert-RelativeRuntimeInput $_ })
  $binding = [ordered]@{
    version = 1
    target_repo = (Resolve-Path $CanonicalRepo).Path
    canonical_target_path = (Resolve-Path $CanonicalRepo).Path
    mode = 'worktree'
    control_worktree_path = $control
    qa_snapshot_path = $snapshot
    qa_managed_root = $null
    selected_runtime_input_paths = $inputs
    base_branch = $Base
    guardian_repo_path = $GuardianRepo
    git_identity = (Invoke-Git $CanonicalRepo @('rev-parse', '--show-toplevel')).output
  }
  if (-not $ForDryRun) { Write-JsonUtf8 $BindingPath $binding }
  return $binding
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

$launcherConfig = Read-LauncherConfig $bindingPath
$canonicalTarget = Canonical-LauncherPath ((Resolve-Path $TargetRepo).Path)
$binding = Select-LauncherBinding $launcherConfig $canonicalTarget
if (-not $Dashboard -and $DryRun -and -not $binding) {
  throw "DryRun 不会进行首次模式选择，也不会写入启动绑定或创建 worktree。请先不带 -DryRun、-Yes 交互式运行 scheduler-start.ps1 一次。"
}
if ($binding) { $binding = Assert-PersistedBinding $binding $canonicalTarget $GuardianRepo }
if ($binding -and -not $DryRun) { Save-LauncherBinding $bindingPath $canonicalTarget $binding }
if ($binding -and [string]$binding.mode -eq 'worktree' -and -not $DryRun) {
  Ensure-ControlWorktree $TargetRepo ([string]$binding.control_worktree_path) ([string]$binding.base_branch)
}

if ($Dashboard) {
  $dashboardBinding = $binding
  $dashboardRepo = $TargetRepo
  if ($dashboardBinding -and [string]$dashboardBinding.mode -eq 'worktree' -and (Canonical-LauncherPath ([string]$dashboardBinding.canonical_target_path)) -eq (Canonical-LauncherPath $canonicalTarget)) {
    $dashboardRepo = [string]$dashboardBinding.control_worktree_path
  }
  Write-Host "==> 正在打开 Guardian 只读仪表盘" -ForegroundColor Cyan
  Write-Host "    Control : $dashboardRepo" -ForegroundColor Green
  Write-Host "    提示：按 Ctrl+C 可停止刷新。" -ForegroundColor Gray
  & $nodeExe (Join-Path $GuardianRepo "tools\guardian\dashboard.mjs") --repo $dashboardRepo --watch 5
  return
}

$targetGithub = if ($GitHubRepo) { Normalize-GitHubRepo $GitHubRepo } else { Infer-GitHubRepo $TargetRepo }
if (-not $targetGithub) {
  $inputGithub = Read-Host "    请输入目标 GitHub 仓库（owner/repo 或 https://github.com/owner/repo，直接回车取消）"
  $targetGithub = Normalize-GitHubRepo $inputGithub
  if (-not $targetGithub) { throw "已取消：缺少目标 GitHub 仓库。" }
}

# gh is required only by scheduler startup. Dashboard remains read-only and skips GitHub preflight.
if (-not $Dashboard) {
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if (-not $gh) { throw "未找到 gh，请先安装 GitHub CLI 并执行 gh auth login。" }
  & gh auth status *> $null
  if ($LASTEXITCODE -ne 0) { throw "gh 尚未登录，请先执行 gh auth login。" }
  & gh repo view $targetGithub *> $null
  if ($LASTEXITCODE -ne 0) { throw "无法访问 GitHub 仓库 $targetGithub，请检查 repo 名称和 gh 权限。" }
}

if (-not $Dashboard -and -not $DryRun -and -not $binding) {
  if ($Yes) { throw "首次启动尚未选择模式。请先不带 -Yes 交互式运行一次，选择 strict 或 worktree/current-snapshot 模式。" }
  Write-Host "    首次启动需要选择目标仓库模式（选择会保存到 gitignored scheduler.config.json）。" -ForegroundColor Yellow
  $modeInput = Read-Host "    输入 1=严格模式（目标必须 clean）或 2=worktree/current-snapshot 模式"
  if ($modeInput -eq '1' -or $modeInput -match '^(strict|严格)$') {
    $binding = [ordered]@{ version = 1; target_repo = (Resolve-Path $TargetRepo).Path; canonical_target_path = (Resolve-Path $TargetRepo).Path; mode = 'strict'; control_worktree_path = (Resolve-Path $TargetRepo).Path; qa_snapshot_path = $null; qa_managed_root = $null; selected_runtime_input_paths = @(); base_branch = $BaseBranch; guardian_repo_path = $GuardianRepo; git_identity = (Invoke-Git $TargetRepo @('rev-parse', '--show-toplevel')).output }
    Save-LauncherBinding $bindingPath $canonicalTarget $binding
  } elseif ($modeInput -eq '2' -or $modeInput -match '^(worktree|snapshot)$') {
    $binding = Initialize-WorktreeBinding $TargetRepo $BaseBranch $bindingPath -ForDryRun
    Save-LauncherBinding $bindingPath $canonicalTarget $binding
    Invoke-Git $TargetRepo @('fetch', 'origin', $BaseBranch) | Out-Null
    Ensure-ControlWorktree $TargetRepo ([string]$binding.control_worktree_path) $BaseBranch
  } else { throw "选择无效：请输入 1 或 2。" }
}

# config + command_authors (fail-closed security key). If it already exists, start directly.
# In worktree mode, bootstrap authoritative config in the control worktree.
$configPath = Join-Path $TargetRepo ".qa\guardian\config.json"
if ($binding -and [string]$binding.mode -eq 'worktree') { $configPath = Join-Path ([string]$binding.control_worktree_path) ".qa\guardian\config.json" }
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
   $guardianDir = Split-Path -Parent $configPath
  New-Item -ItemType Directory -Force -Path $guardianDir | Out-Null
  $newCfg = [ordered]@{
    github_repo      = $targetGithub
    watch_mode       = $WatchMode
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
$changedCfg = $false
if (-not $cfg.github_repo) { $cfg | Add-Member -NotePropertyName github_repo -NotePropertyValue $targetGithub; $changedCfg = $true }
if (-not $cfg.watch_mode) { $cfg | Add-Member -NotePropertyName watch_mode -NotePropertyValue $WatchMode; $changedCfg = $true }
if (-not $cfg.base_branch) { $cfg | Add-Member -NotePropertyName base_branch -NotePropertyValue $BaseBranch; $changedCfg = $true }
if (-not $cfg.command_authors -or @($cfg.command_authors).Count -eq 0) {
  if ($Yes) { throw "command_authors 为空：请先不带 -Yes 运行一次，输入可信 GitHub 登录名，例如 goudaren0528。" }
  $authorInput = Read-Host "    请输入可信 GitHub 登录名（多个用逗号或空格分隔；只需首次输入）"
  if (-not $authorInput) { throw "已取消：未配置可信 GitHub 登录名。" }
  $authors = @($authorInput -split '[,\s]+' | Where-Object { $_ })
  $cfg | Add-Member -NotePropertyName command_authors -NotePropertyValue $authors -Force
  $changedCfg = $true
}
if ($changedCfg) {
  [System.IO.File]::WriteAllText($configPath, (($cfg | ConvertTo-Json -Depth 8) + "`n"), (New-Object System.Text.UTF8Encoding($false)))
  $cfg = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
}
if (-not $cfg.command_authors -or @($cfg.command_authors).Count -eq 0) {
  throw "command_authors 为空：所有 /guardian 命令都会被拒绝。请配置可信 GitHub 用户后再启动。"
} else {
  Write-Host "    可信命令作者: $($cfg.command_authors -join ', ')" -ForegroundColor Green
}

$base = if ($cfg.base_branch) { [string]$cfg.base_branch } else { $BaseBranch }
$guardianFacts = Assert-CleanAndUpstreamLatest $GuardianRepo 'Guardian工具仓库'
$bindingMode = [string]$binding.mode

$targetFacts = $null
$controlRepo = $TargetRepo
$qaRuntimeRepo = $TargetRepo
if ($bindingMode -eq 'strict') {
  $targetFacts = Assert-CleanAndLatest $TargetRepo $base '目标值守仓库'
} else {
  $controlRepo = [string]$binding.control_worktree_path
  $qaRuntimeRepo = [string]$binding.qa_snapshot_path
  if (-not $controlRepo -or -not $qaRuntimeRepo) { throw "worktree 绑定缺少 control worktree 或 QA snapshot 路径，请删除绑定后重新选择。" }
  if ($controlRepo -eq $TargetRepo -or $qaRuntimeRepo -eq $TargetRepo) { throw "worktree 路径不能指向 canonical target；已停止。" }
  if (-not $DryRun -and -not $Dashboard) {
    Ensure-ControlWorktree $TargetRepo $controlRepo $base
    Ensure-QaSnapshot $TargetRepo $qaRuntimeRepo $base
    $patchFile = Join-Path ([IO.Path]::GetTempPath()) ("qa-guardian-" + [Guid]::NewGuid().ToString('N') + '.patch')
    try {
      $previousErrorActionPreference = $ErrorActionPreference
      $ErrorActionPreference = "Continue"
      try {
        & git -C $TargetRepo diff HEAD --binary --output="$patchFile" 2>$null
        $diffExitCode = $LASTEXITCODE
      } finally { $ErrorActionPreference = $previousErrorActionPreference }
      if ($diffExitCode -ne 0) { throw "无法读取 canonical target 的 tracked diff；已停止。" }
      if ((Test-Path -LiteralPath $patchFile) -and (Get-Item -LiteralPath $patchFile).Length -gt 0) {
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
          & git -C $qaRuntimeRepo apply --binary -- "$patchFile" 2>$null
          $applyExitCode = $LASTEXITCODE
        } finally { $ErrorActionPreference = $previousErrorActionPreference }
        if ($applyExitCode -ne 0) { throw "无法将 tracked diff 应用到 QA snapshot；已停止，未修改 canonical target。" }
      }
    } finally { Remove-Item -LiteralPath $patchFile -Force -ErrorAction SilentlyContinue }
    Copy-SelectedRuntimeInput $TargetRepo $qaRuntimeRepo @($binding.selected_runtime_input_paths)
    $sourceGuardianConfig = Join-Path $TargetRepo '.qa\guardian\config.json'
    $controlGuardianConfig = Join-Path $controlRepo '.qa\guardian\config.json'
    if (Test-Path -LiteralPath $controlGuardianConfig) {
      # The control worktree is authoritative. Its command authors and runtime settings may
      # intentionally differ from the developer checkout after first-run setup.
    } elseif (Test-Path -LiteralPath $sourceGuardianConfig) {
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $controlGuardianConfig) | Out-Null
      Copy-Item -LiteralPath $sourceGuardianConfig -Destination $controlGuardianConfig
    } else {
      throw "control worktree 缺少 .qa/guardian/config.json，且 canonical target 也未提供配置。请先使用 -Init 或交互式启动。"
    }
  }
  $targetFacts = [ordered]@{ label = 'canonical target'; repo = $TargetRepo; mode = 'worktree'; status = (Invoke-Git $TargetRepo @('status', '--porcelain') -AllowFailure).output }
  $controlFacts = [ordered]@{ repo = $controlRepo; base_branch = $base; qa_runtime_repo = $qaRuntimeRepo }
}
Write-Host "    GitHub仓库 : $targetGithub" -ForegroundColor Green
Write-Host "    值守模式    : $($cfg.watch_mode)" -ForegroundColor Green
Write-Host "    PR目标分支  : $base" -ForegroundColor Green
Write-Host "    启动绑定    : $bindingMode" -ForegroundColor Green
if ($bindingMode -eq 'worktree') { Write-Host "    Control     : $controlRepo" -ForegroundColor Green; Write-Host "    QA snapshot : $qaRuntimeRepo" -ForegroundColor Green }
if ($targetFacts.commit) { Write-Host "    目标仓库    : clean/latest $($targetFacts.commit.Substring(0, 8))" -ForegroundColor Green }
Write-Host "    Guardian   : clean/latest $($guardianFacts.commit.Substring(0, 8))" -ForegroundColor Green

if ($DryRun) {
  [ordered]@{
    target_repo = $TargetRepo
    github_repo = $targetGithub
     base_branch = $base
     watch_mode = $cfg.watch_mode
     binding = $binding
     control_repo = $controlRepo
     qa_runtime_repo = $qaRuntimeRepo
    command_authors = @($cfg.command_authors)
    target = $targetFacts
    guardian = $guardianFacts
    scheduler_only = [bool]$SchedulerOnly
    dashboard = [bool]$Dashboard
  } | ConvertTo-Json -Depth 8
  return
}

Confirm-Start "    确认启动上述值守配置？输入 yes/确认 继续"

if ($SchedulerOnly) {
  if ($OpenCodeServerUrl) {
    Write-Host "    OpenCode服务: $OpenCodeServerUrl" -ForegroundColor Green
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
      try {
        $health = Invoke-WebRequest -UseBasicParsing -Uri "$OpenCodeServerUrl/global/health" -TimeoutSec 2
        if ($health.StatusCode -eq 200) { $ready = $true; break }
      } catch {}
      Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw "OpenCode server did not become healthy: $OpenCodeServerUrl" }
    $env:QA_GUARDIAN_OPENCODE_SERVER_URL = $OpenCodeServerUrl
  }
  if ($ProgressDir) {
    New-Item -ItemType Directory -Path $ProgressDir -Force | Out-Null
    $env:QA_GUARDIAN_PROGRESS_DIR = $ProgressDir
    Write-Host "    Agent进度  : $ProgressDir" -ForegroundColor Green
  }
  Write-Host "==> 正在启动 Guardian scheduler（polling only）" -ForegroundColor Cyan
  Write-Host "    提示：按 Ctrl+C 可停止。" -ForegroundColor Gray
   $env:QA_GUARDIAN_QA_RUNTIME_DIR = $qaRuntimeRepo
   & $nodeExe (Join-Path $GuardianRepo "tools\guardian\scheduler.mjs") --repo $controlRepo
} else {
  Write-Host "==> 正在启动 Guardian 组合服务（scheduler + 飞书长连接）" -ForegroundColor Cyan
  Write-Host "    提示：按 Ctrl+C 可停止；首次启动前请确认已执行 npm install 并配置飞书凭证。" -ForegroundColor Gray
   $env:QA_GUARDIAN_QA_RUNTIME_DIR = $qaRuntimeRepo
   & $nodeExe (Join-Path $GuardianRepo "tools\guardian\guardian-runtime.mjs") --repo $controlRepo
}
