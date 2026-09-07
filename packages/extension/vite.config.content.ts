import { defineConfig } from 'vite';

// The content script must be a single classic script: MV3 content scripts
// cannot be ES modules, so we build it as a self-contained IIFE.
export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome114',
    minify: false,
    lib: {
      entry: 'src/content.ts',
      name: 'ClaudeTrees',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
  },
});
