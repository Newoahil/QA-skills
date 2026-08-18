#!/usr/bin/env bash
# One-click launcher for the QA Guardian resident scheduler (Linux/macOS).
#
# Verifies node/gh and the target repo's .qa/guardian/config.json (with the security-required
# command_authors whitelist), then runs scheduler.mjs watching the target repo.
#
# Usage: tools/guardian/scheduler-start.sh [--target <repo>]
set -euo pipefail

TARGET_REPO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET_REPO="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARDIAN_REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Resolve target repo by precedence: --target > env QA_GUARDIAN_REPO > sibling config > cwd.
if [ -z "$TARGET_REPO" ] && [ -n "${QA_GUARDIAN_REPO:-}" ]; then TARGET_REPO="$QA_GUARDIAN_REPO"; fi
if [ -z "$TARGET_REPO" ] && [ -f "$SCRIPT_DIR/scheduler.config.json" ]; then
  TARGET_REPO="$(node -e "const c=require('$SCRIPT_DIR/scheduler.config.json');process.stdout.write(c.target_repo||'')")"
fi
if [ -z "$TARGET_REPO" ]; then TARGET_REPO="$(pwd)"; fi

command -v node >/dev/null 2>&1 || { echo "node not found — install Node.js >= 18"; exit 1; }

echo "==> QA Guardian scheduler"
echo "    node        : $(command -v node)"
echo "    guardian src: $GUARDIAN_REPO"
echo "    target repo : $TARGET_REPO"

[ -d "$TARGET_REPO" ] || { echo "TargetRepo does not exist: $TARGET_REPO"; exit 1; }

if command -v gh >/dev/null 2>&1; then
  gh auth status >/dev/null 2>&1 || echo "    [warn] gh not authenticated — run 'gh auth login'."
else
  echo "    [warn] gh not on PATH — install + 'gh auth login' first."
fi

CONFIG_PATH="$TARGET_REPO/.qa/guardian/config.json"
if [ ! -f "$CONFIG_PATH" ]; then
  echo "Missing $CONFIG_PATH. Create it with at least: { \"command_authors\": [\"<your-github-login>\"] }. See tools/guardian/DEPLOY.md." >&2
  exit 1
fi
# command_authors presence check (fail-closed key) via node for JSON safety.
AUTHORS_OK=$(node -e "const c=require('$CONFIG_PATH');process.stdout.write(Array.isArray(c.command_authors)&&c.command_authors.length>0?'yes':'no')")
if [ "$AUTHORS_OK" = "no" ]; then
  echo "    [warn] config.command_authors is empty — NO /guardian command will be honored (fail-closed)."
fi

echo "==> starting scheduler (Ctrl-C to stop)"
exec node "$GUARDIAN_REPO/tools/guardian/scheduler.mjs" --repo "$TARGET_REPO"
