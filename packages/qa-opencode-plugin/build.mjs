import { build } from 'esbuild';

const common = {
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  logLevel: 'info',
};

await build({
  ...common,
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
  external: ['@opencode-ai/plugin', 'jsonc-parser'],
});

await build({
  ...common,
  entryPoints: ['src/tui.tsx'],
  outfile: 'dist/tui.js',
  external: ['@opencode-ai/plugin/tui', '@opentui/core', '@opentui/keymap', '@opentui/solid', 'solid-js', 'jsonc-parser'],
});
