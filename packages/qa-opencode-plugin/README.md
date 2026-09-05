# qa-skill-opencode-plugin

OpenCode-native QA model presets and compact agent sidebar.

## Current scope

- Server plugin: loads `qa-skill.jsonc` / `qa-skill.json`, resolves the active preset, and mutates matching OpenCode QA/guardian agent model settings in-place.
- TUI plugin: renders the `QA-Agents` panel in OpenCode's native sidebar with each configured QA agent and its effective model.
- Installer: use `node tools/opencode/install-qa-plugin.mjs` from the repo root.

Restart OpenCode after installing or changing plugin-time configuration.

## Config files

- User: `$OPENCODE_CONFIG_DIR/qa-skill.jsonc`, then `$XDG_CONFIG_HOME/opencode/qa-skill.jsonc`, then `~/.config/opencode/qa-skill.jsonc`
- Project override: `<repo>/.opencode/qa-skill.jsonc`
- `.jsonc` wins over `.json` when both exist.

See `qa-skill.example.jsonc` and `qa-skill.schema.json`.
