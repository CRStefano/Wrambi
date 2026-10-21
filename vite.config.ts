import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Configurazione per Tauri: porta fissa, nessuna apertura del browser.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
  worker: { format: 'es' },
  test: {
    environment: 'happy-dom',
    // Gli EPUB dei test citano fogli di stile esterni: happy-dom non deve provare a scaricarli.
    environmentOptions: { happyDOM: { settings: { disableCSSFileLoading: true, handleDisabledFileLoadingAsSuccess: true } } },
    include: ['tests/**/*.test.ts'],
  },
});
