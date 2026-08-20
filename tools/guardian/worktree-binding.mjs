import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const BINDING_VERSION = 1;
const FORBIDDEN_SEGMENTS = new Set(['.git', '.qa', 'node_modules']);

export const WORKTREE_BINDING_VERSION = BINDING_VERSION;
export const LAUNCHER_CONFIG_VERSION = 2;

export function canonicalPath(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const source = value.trim();
  const resolved = /^[A-Za-z]:[\\/]/.test(source) || source.startsWith('\\\\')
    ? path.win32.resolve(source)
    : path.resolve(source);
  return resolved.replace(/[\\/]+/g, path.sep).replace(/[\\/]$/, '').toLowerCase();
}

export function validateRepositoryRelativePath(value) {
  if (typeof value !== 'string' || value.trim() === '') return { ok: false, reason: '路径不能为空' };
  const input = value.trim().replaceAll('\\', '/');
  if (input.startsWith('/') || /^[A-Za-z]:\//.test(input)) return { ok: false, reason: '路径必须是仓库相对路径' };
  const parts = input.split('/');
  if (parts.some((part) => part === '' || part === '..' || FORBIDDEN_SEGMENTS.has(part.toLowerCase()))) {
    return { ok: false, reason: '路径包含禁止的目录或 traversal' };
  }
  const normalized = path.posix.normalize(input);
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    return { ok: false, reason: '路径不能越出仓库根目录' };
  }
  return { ok: true, relativePath: normalized };
}

export function validateRuntimeInputPaths(paths) {
  if (paths === undefined || paths === null) return { ok: true, paths: [] };
  if (!Array.isArray(paths)) return { ok: false, reason: 'selected_runtime_input_paths 必须是数组' };
  const normalized = [];
  for (const value of paths) {
    const result = validateRepositoryRelativePath(value);
    if (!result.ok) return result;
    if (normalized.includes(result.relativePath)) return { ok: false, reason: 'runtime 输入路径重复' };
    normalized.push(result.relativePath);
  }
  return { ok: true, paths: normalized };
}

export function validateCommandAuthors(authors) {
  if (authors === undefined) return { ok: true, authors: undefined };
  if (!Array.isArray(authors)) return { ok: false, reason: 'command_authors 必须是数组' };
  const normalized = authors.map((author) => (typeof author === 'string' ? author.trim() : author));
  if (normalized.length === 0 || normalized.some((author) => typeof author !== 'string' || author === '')) {
    return { ok: false, reason: 'command_authors 必须是非空登录名数组' };
  }
  return { ok: true, authors: normalized };
}

export function validateBinding(binding, { canonicalTargetPath, guardianRepoPath } = {}) {
  if (!binding || typeof binding !== 'object') return { ok: false, reason: '未找到启动绑定，请先交互式启动一次' };
  if (binding.version !== BINDING_VERSION) return { ok: false, reason: '启动绑定版本不兼容，请删除本地绑定后重新交互式启动' };
  if (!['strict', 'worktree'].includes(binding.mode)) return { ok: false, reason: '启动绑定模式无效' };
  const canonical = canonicalPath(canonicalTargetPath ?? binding.canonical_target_path);
  if (!canonical || canonicalPath(binding.canonical_target_path) !== canonical) return { ok: false, reason: '启动绑定与当前目标项目不匹配' };
  const inputs = validateRuntimeInputPaths(binding.selected_runtime_input_paths);
  if (!inputs.ok) return inputs;
  const authors = validateCommandAuthors(binding.command_authors);
  if (!authors.ok) return authors;
  if (binding.mode === 'worktree') {
    if (!canonicalPath(binding.control_worktree_path) || !canonicalPath(binding.qa_snapshot_path || binding.qa_managed_root)) {
      return { ok: false, reason: 'worktree 绑定缺少控制 worktree 或 QA snapshot 路径' };
    }
    if (canonicalPath(binding.control_worktree_path) === canonical || canonicalPath(binding.qa_snapshot_path) === canonical) {
      return { ok: false, reason: 'worktree 路径不能等于 canonical target' };
    }
  }
  if (guardianRepoPath && binding.guardian_repo_path && canonicalPath(binding.guardian_repo_path) !== canonicalPath(guardianRepoPath)) {
    return { ok: false, reason: '启动绑定与当前 Guardian 工具仓库不匹配' };
  }
  return {
    ok: true,
    binding: {
      ...binding,
      selected_runtime_input_paths: inputs.paths,
      ...(authors.authors === undefined ? {} : { command_authors: authors.authors }),
    },
  };
}

export function makeStrictBinding({ canonicalTargetPath, guardianRepoPath, baseBranch, gitIdentity, commandAuthors }) {
  const authors = validateCommandAuthors(commandAuthors);
  if (!authors.ok) throw new Error(authors.reason);
  return {
    version: BINDING_VERSION,
    canonical_target_path: canonicalTargetPath,
    mode: 'strict',
    control_worktree_path: canonicalTargetPath,
    qa_snapshot_path: null,
    qa_managed_root: null,
    selected_runtime_input_paths: [],
    base_branch: baseBranch,
    guardian_repo_path: guardianRepoPath,
    git_identity: gitIdentity ?? null,
    ...(authors.authors === undefined ? {} : { command_authors: authors.authors }),
  };
}

export function makeWorktreeBinding({ canonicalTargetPath, guardianRepoPath, baseBranch, controlWorktreePath, qaSnapshotPath, qaManagedRoot, selectedRuntimeInputPaths, gitIdentity, commandAuthors }) {
  const inputs = validateRuntimeInputPaths(selectedRuntimeInputPaths);
  if (!inputs.ok) throw new Error(inputs.reason);
  const authors = validateCommandAuthors(commandAuthors);
  if (!authors.ok) throw new Error(authors.reason);
  return {
    version: BINDING_VERSION,
    canonical_target_path: canonicalTargetPath,
    mode: 'worktree',
    control_worktree_path: controlWorktreePath,
    qa_snapshot_path: qaSnapshotPath,
    qa_managed_root: qaManagedRoot,
    selected_runtime_input_paths: inputs.paths,
    base_branch: baseBranch,
    guardian_repo_path: guardianRepoPath,
    git_identity: gitIdentity ?? null,
    ...(authors.authors === undefined ? {} : { command_authors: authors.authors }),
  };
}

export function resolveAuthoritativeControlRepo(repoDir, binding) {
  if (!binding || binding.mode !== 'worktree') return repoDir;
  const canonical = canonicalPath(binding.canonical_target_path);
  if (canonical && canonicalPath(repoDir) === canonical) return binding.control_worktree_path;
  return repoDir;
}

export function readBindingFile(file) {
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}

export function readLauncherConfig(file) {
  const value = readBindingFile(file);
  return value && typeof value === 'object' ? value : null;
}

export function resolveLauncherBinding(config, repoDir) {
  const canonical = canonicalPath(repoDir);
  if (!canonical || !config || typeof config !== 'object') return null;
  if (config.projects && typeof config.projects === 'object' && !Array.isArray(config.projects)) {
    for (const [key, binding] of Object.entries(config.projects)) {
      if (canonicalPath(key) === canonical) return binding;
    }
  }
  if (canonicalPath(config.canonical_target_path) === canonical) return config;
  return null;
}

export function resolveViewerRepo(repoDir, bindingFile) {
  const binding = resolveLauncherBinding(readLauncherConfig(bindingFile), repoDir);
  if (!binding || binding.mode !== 'worktree') return repoDir;
  if (canonicalPath(binding.canonical_target_path) !== canonicalPath(repoDir)) return repoDir;
  return binding.control_worktree_path || repoDir;
}
