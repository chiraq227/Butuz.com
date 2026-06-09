import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // allow access from mobile phones on the same WiFi during development (npm run dev)
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2020',
    minify: 'esbuild', // built-in, fast, no extra deps. Drop console in prod via define if needed.
    rollupOptions: {
      output: {
        manualChunks: {
          // Split vendor chunks for better caching and smaller initial loads on mobile
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui-vendor': ['framer-motion', 'lucide-react'],
          'crypto': ['./src/lib/crypto.ts'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
