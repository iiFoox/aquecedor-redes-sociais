// Painel (React + TypeScript). "npm run build" gera web/dist, que o painel serve.
// "npm run dev:web" abre o painel com recarga automática, falando com o motor em 127.0.0.1:3101.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:3101' } },
});
