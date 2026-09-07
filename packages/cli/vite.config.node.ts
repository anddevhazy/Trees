import { defineConfig } from 'vite';

// SSR build: node builtins stay external, the workspace core gets bundled in so
// the CLI runs straight from dist with no resolution step.
export default defineConfig({
  build: {
    ssr: 'src/node/cli.ts',
    outDir: 'dist',
    emptyOutDir: false,
    target: 'node18',
    minify: false,
    rollupOptions: {
      output: { entryFileNames: 'cli.js', format: 'es', banner: '#!/usr/bin/env node' },
    },
  },
  ssr: { noExternal: ['@claude-trees/core'] },
});
