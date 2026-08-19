// Resolve the opencode CLI executable for spawn WITHOUT a shell.
//
// shell:false is a load-bearing security choice here: the agent prompt contains issue-derived text,
// so it must never be interpreted by a shell (injection). But on Windows two things break a bare
// `spawn('opencode', ..., { shell:false })`:
//   1. `opencode` is an npm shim (`opencode.cmd`), not on PATH as an .exe;
//   2. modern Node refuses to spawn `.cmd`/`.bat` without a shell (EINVAL, post-CVE hardening).
// The npm `opencode.cmd` shim ultimately calls the REAL binary
// `<npm-prefix>/node_modules/opencode-ai/bin/opencode.exe`, which IS spawnable with shell:false.
// So on Windows we resolve that real .exe. On POSIX the bare `opencode` on PATH works.
//
// Precedence: QA_GUARDIAN_OPENCODE_BIN env → resolved Windows .exe → bare 'opencode'.

import { existsSync } from 'node:fs';
import path from 'node:path';

// Candidate real-exe locations for the npm-global opencode-ai install on Windows.
export function windowsExeCandidates(env = process.env) {
  const candidates = [];
  const appdata = env.APPDATA;
  if (appdata) candidates.push(path.join(appdata, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'));
  const npmPrefix = env.npm_config_prefix;
  if (npmPrefix) candidates.push(path.join(npmPrefix, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'));
  return candidates;
}

export function resolveOpencodeBin(env = process.env, platform = process.platform, exists = existsSync) {
  const override = env.QA_GUARDIAN_OPENCODE_BIN;
  if (typeof override === 'string' && override.length > 0) return override;
  if (platform === 'win32') {
    for (const candidate of windowsExeCandidates(env)) {
      if (exists(candidate)) return candidate;
    }
    // Fallback: the .cmd shim. May EINVAL on hardened Node, but better than a bare name that is
    // guaranteed ENOENT — and operators can always set QA_GUARDIAN_OPENCODE_BIN explicitly.
    return 'opencode.cmd';
  }
  return 'opencode';
}
