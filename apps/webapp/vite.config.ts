import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The background-removal engine (MediaPipe, lib/cutout.ts) runs as WebAssembly: its files
 * are copied next to the app so phones load them from our own site, not a third party.
 */
function mediapipeFiles(): Plugin {
  const here = dirname(fileURLToPath(import.meta.url));
  const from = resolve(here, 'node_modules/@mediapipe/tasks-vision/wasm');
  const files = [
    'vision_wasm_internal.js',
    'vision_wasm_internal.wasm',
    'vision_wasm_nosimd_internal.js',
    'vision_wasm_nosimd_internal.wasm',
  ];
  return {
    name: 'mediapipe-files',
    apply: 'build',
    writeBundle(options) {
      const to = resolve(options.dir ?? 'dist', 'mediapipe');
      mkdirSync(to, { recursive: true });
      for (const f of files) copyFileSync(resolve(from, f), resolve(to, f));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), mediapipeFiles()],
  server: {
    // `pnpm dev:worker` serves the API on :8787; the Mini App dev server proxies to it.
    proxy: {
      '/api': 'http://localhost:8787',
      '/health': 'http://localhost:8787',
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
