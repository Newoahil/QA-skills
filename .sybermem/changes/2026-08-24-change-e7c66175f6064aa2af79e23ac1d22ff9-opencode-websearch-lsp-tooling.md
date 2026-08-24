---
type: change
record_id: change-e7c66175f6064aa2af79e23ac1d22ff9
date: 2026-08-24
title: Configure OpenCode websearch and LSP tooling
status: done
source: implementation
key_conclusion: OpenCode project tooling now disables the unauthenticated default websearch MCP and configures working TypeScript/Markdown LSP servers so local diagnostics no longer fail with SSE 405, missing tsserver, or Markdown server startup errors.
topics: [opencode, lsp, tooling]
author: Sisyphus
related_files: [.opencode/lsp.json, oh-my-opencode.jsonc, C:/Users/ttx/.config/opencode/lsp.json]
---

## Change Content
Added project-level OpenCode LSP configuration for the builtin TypeScript server and pointed it at the stable global TypeScript 5.9 `tsserver.js`, avoiding the Node/npm global TypeScript 7 package shape that lacked the expected `lib/tsserver.js` entry point.

Added project-level OMO configuration to disable the default `websearch` MCP. The default Exa remote MCP endpoint was opening a failing SSE connection in this environment because no Exa or Tavily API key was configured.

Configured the user-level OpenCode LSP registry to use Marksman for Markdown diagnostics. The initially installed `vscode-markdown-language-server` from `vscode-langservers-extracted` failed under Node 26 with an ESM `vscode-uri` default export error, so the Markdown server was switched to the standalone Marksman binary installed through winget.

## Reason for Change
The local tooling loop was noisy and partially unusable: websearch emitted `Non-200 status code (405)` from its SSE transport, `.mjs` diagnostics could not start because TypeScript LSP could not find a valid tsserver, and `.md` diagnostics had no working Markdown server. Fixing these improves future verification and reduces false blockers during Guardian development.

## Impact Scope
The committed project impact is limited to OpenCode/OMO tooling configuration in this repository. It does not change Guardian runtime behavior, scheduler logic, tests, or production code paths. The user-level LSP configuration and global tool installations affect this workstation's OpenCode diagnostics outside the repository commit.

## Test Verification
- `lsp_status` reported `typescript` and `markdown-custom` installed.
- `lsp_diagnostics D:\QA-skills\tools\guardian\gate1-comment.mjs` returned `No diagnostics found`.
- `lsp_diagnostics D:\QA-skills\README.md` returned `No diagnostics found`.
- `node --test "tests/guardian/*.test.mjs"` passed 585/585.
- `$env:GIT_MASTER='1'; git diff --check` reported no errors.

## Notes
Committed project configuration as `22fd568 Configure OpenCode websearch and LSP tooling`. User-level changes included `C:\Users\ttx\.config\opencode\lsp.json`, global `typescript-language-server@6.0.0`, global `typescript@5.9.3`, and Marksman `2026-02-08` installed with winget.
