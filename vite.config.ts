import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The web app is built into dist/ and served by the Worker as static assets.
// In development, /api is proxied to `wrangler dev` on port 8787.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
});
