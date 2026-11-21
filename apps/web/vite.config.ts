import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During `npm run dev` (web workspace), API calls are proxied to the Hono Worker
// started separately via `npm run dev` (root / apps/api) on http://localhost:8787.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/health': { target: 'http://localhost:8787', changeOrigin: true }
    }
  }
});
