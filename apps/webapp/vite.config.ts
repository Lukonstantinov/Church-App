import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
