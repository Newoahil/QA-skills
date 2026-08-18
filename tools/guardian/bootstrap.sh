#!/usr/bin/env bash
# One-shot bootstrap for QA Guardian (MVP, Linux/macOS).
#
# Idempotently prepares everything the QA Guardian single-issue chain (§15.2) needs, EXCEPT
# the two things only you can do: install/authenticate `gh`, and label a real GitHub issue.
# It: checks prereqs, installs the 3 QA agents + qa-skill globally, ensures subagent_depth>=2
# in the target repo's opencode.json, bootstraps .qa/guardian/ + config.json, and runs the
# deterministic test suite. Re-running is safe.
#
# Usage:
#   tools/guardian/bootstrap.sh [--target <repo>] [--webhook <url>] [--skip-tests]
#
set -euo pipefail

TARGET_REPO="$(pwd)"
NOTIFY_WEBHOOK=""
SKIP_TESTS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET_REPO="$2"; shift 2 ;;
    --webhook) NOTIFY_WEBHOOK="$2"; shift 2 ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARDIAN_REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
AGENTS_SRC="$GUARDIAN_REPO/qa-skill/agents"
SKILL_SRC="$GUARDIAN_REPO/qa-skill"
OPENCODE_HOME="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
AGENTS_DST="$OPENCODE_HOME/agents"
SKILL_DST="$OPENCODE_HOME/skills/qa-skill"

cyan() { printf '\033[36m==> %s\033[0m\n' "$1"; }
ok()   { printf '\033[32m    [ok] %s\033[0m\n' "$1"; }
warn() { printf '\033[33m    [warn] %s\033[0m\n' "$1"; }

cyan "QA Guardian bootstrap"
echo "    guardian source: $GUARDIAN_REPO"
echo "    target repo    : $TARGET_REPO"

# --- 1. Prereqs ----------------------------------------------------------------------
cyan "Checking prerequisites"
if command -v node >/dev/null 2>&1; then ok "node: $(command -v node)"; else echo "node not found — install Node.js (>=18)"; exit 1; fi
if command -v opencode >/dev/null 2>&1; then ok "opencode: $(command -v opencode)"; else warn "opencode not on PATH — needed to run the guardian agent"; fi

GH_READY=0
if command -v gh >/dev/null 2>&1; then
  ok "gh: $(command -v gh)"
  if gh auth status >/dev/null 2>&1; then GH_READY=1; ok "gh authenticated"; else warn "gh installed but NOT authenticated — run: gh auth login"; fi
else
  warn "gh NOT installed — the GitHub chain cannot run until you install + authenticate it."
fi

[ -d "$TARGET_REPO" ] || { echo "TargetRepo does not exist: $TARGET_REPO"; exit 1; }

# --- 2. Install agents ----------------------------------------------------------------
cyan "Installing QA agents -> $AGENTS_DST"
mkdir -p "$AGENTS_DST"
for a in qa-guardian.md qa.md qa-facet.md; do
  [ -f "$AGENTS_SRC/$a" ] || { echo "missing agent source: $AGENTS_SRC/$a"; exit 1; }
  cp -f "$AGENTS_SRC/$a" "$AGENTS_DST/$a"
  ok "agent installed: $a"
done

# --- 3. Install skill -----------------------------------------------------------------
cyan "Installing qa-skill -> $SKILL_DST"
mkdir -p "$SKILL_DST"
cp -Rf "$SKILL_SRC/." "$SKILL_DST/"
ok "qa-skill installed"

# --- 4. subagent_depth >= 2 (patched via node, JSON-safe) -----------------------------
cyan "Ensuring subagent_depth >= 2 in target repo opencode.json"
TARGET_JSON="$TARGET_REPO/opencode.json"
node - "$TARGET_JSON" <<'NODE'
const fs = require('fs');
const p = process.argv[2];
let cfg = {};
if (fs.existsSync(p)) {
  try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { console.error('    [warn] existing opencode.json invalid JSON; set subagent_depth:2 manually.'); process.exit(0); }
}
if (!((cfg.subagent_depth ?? 0) >= 2)) {
  if (!cfg['$schema']) cfg['$schema'] = 'https://opencode.ai/config.json';
  cfg.subagent_depth = 2;
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
  console.log('    [ok] set subagent_depth: 2 in ' + p);
} else {
  console.log('    [ok] subagent_depth already >= 2');
}
NODE

# --- 5. .qa/guardian/ + config.json ---------------------------------------------------
cyan "Bootstrapping .qa/guardian/ in target repo"
GUARDIAN_DIR="$TARGET_REPO/.qa/guardian"
mkdir -p "$GUARDIAN_DIR"
ok "created $GUARDIAN_DIR"

CONFIG_PATH="$GUARDIAN_DIR/config.json"
WEBHOOK="$NOTIFY_WEBHOOK" node - "$CONFIG_PATH" <<'NODE'
const fs = require('fs');
const p = process.argv[2];
const webhook = process.env.WEBHOOK || '';
if (fs.existsSync(p)) {
  const existing = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (webhook) { existing.notify_webhook = webhook; fs.writeFileSync(p, JSON.stringify(existing, null, 2) + '\n'); console.log('    [ok] updated notify_webhook'); }
  else console.log('    [ok] config.json already exists — preserved');
} else {
  const cfg = { notify_webhook: webhook, base_branch: 'dev', lease_ms: 1800000 };
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
  console.log('    [ok] wrote config.json template (webhook: ' + Boolean(webhook) + ')');
}
NODE

# --- 6. Tests -------------------------------------------------------------------------
if [ "$SKIP_TESTS" -eq 0 ]; then
  cyan "Running deterministic test suite (gh/curl stubbed)"
  ( cd "$GUARDIAN_REPO" && node --test "tests/guardian/*.test.mjs" ) && ok "all guardian tests passed" || warn "tests reported failures — inspect output above."
fi

# --- Summary --------------------------------------------------------------------------
cyan "Bootstrap complete"
echo ""
echo "Next steps:"
if [ "$GH_READY" -eq 0 ]; then
  echo "  1. Install + authenticate gh (REQUIRED for the live chain), then: gh auth login"
fi
echo "  2. Label a real bug issue with:  qa-guardian"
echo "  3. Run the single-issue chain (§15.2):"
echo "       opencode run --agent qa-guardian --dir \"$TARGET_REPO\" \\"
echo "         \"Watch GitHub issue #<n>: investigate root cause, assess risk, dispatch read-only qa, open a dev PR, stop at gate 2.\""
echo "  4. If it stops at gate 1 (high-risk), reply on the issue:  /guardian approve"
echo "       (only logins in config command_authors are honored; unset = no command works)"
echo ""
echo "  Poll routing check (no live run):"
echo "       node \"$GUARDIAN_REPO/tools/guardian/poll.mjs\" --repo \"$TARGET_REPO\" --issue <n>"
echo ""
echo "  Unattended watch mode + Feishu (see tools/guardian/DEPLOY.md):"
echo "    - Set command_authors (REQUIRED), poll_interval_ms, notify_webhook/notify_channel in .qa/guardian/config.json"
echo "    - Resident scheduler (this machine): node \"$GUARDIAN_REPO/tools/guardian/scheduler.mjs\" --repo \"$TARGET_REPO\""
echo "    - Feishu callback service (cloud): deploy tools/guardian/docker-compose.yml on Dokploy; DEPLOY.md has env + callback URL setup"
