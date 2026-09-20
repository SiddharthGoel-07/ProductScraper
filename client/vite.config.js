import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server on 5173; every /api call is proxied to the Express API on 5000 so
// the browser never deals with CORS or a hard-coded backend host.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
