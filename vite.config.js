import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Assets are addressed relative to the extension root, not a web server's.
  base: './',
  define: {
    /**
     * Whether to route Yahoo through the local dev proxy.
     *
     * A plain literal rather than `import.meta.env.DEV`, because the guarded
     * form that is safe to import from Node — `import.meta.env?.DEV` — is not
     * statically replaceable, so the condition survived into the bundle and
     * carried the proxy's address with it. Defined here, it folds to `false`
     * and the whole dev branch is dropped.
     */
    __DEV_PROXY__: JSON.stringify(mode === 'development'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Manifest V3 forbids inline scripts, and Vite's module-preload polyfill is
    // injected inline. Chrome supports modulepreload natively, so dropping the
    // polyfill costs nothing and keeps the page loading at all.
    modulePreload: { polyfill: false },
  },
}));
