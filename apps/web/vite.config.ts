import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/auth': 'http://localhost:3000',
      '/agents': {
        target: 'http://localhost:3000',
        bypass(req) {
          if (req.headers.accept?.includes('text/html')) return '/index.html';
        },
      },
      '/calls': 'http://localhost:3000',
      '/contacts': {
        target: 'http://localhost:3000',
        bypass(req) {
          if (req.headers.accept?.includes('text/html')) return '/index.html';
        },
      },
      '/admin': {
        target: 'http://localhost:3000',
        bypass(req) {
          if (req.headers.accept?.includes('text/html')) return '/index.html';
        },
      },
      '/voices': 'http://localhost:3000',
      '/v1': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/dashboard': 'http://localhost:3000',
    },
  },
});
