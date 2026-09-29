import { defineConfig } from 'vite';

export default defineConfig({
  base: '/orbit-view/',
  build: {
    target: ['es2020', 'safari15', 'firefox115', 'chrome111', 'edge111'],
    sourcemap: false,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
});
