import { defineConfig } from 'vite';

// The service worker is declared as "type": "module", so ESM is fine here.
// emptyOutDir stays false so this build does not wipe the content build.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome114',
    minify: false,
    lib: {
      entry: 'src/background.ts',
      formats: ['es'],
      fileName: () => 'background.js',
    },
  },
});
