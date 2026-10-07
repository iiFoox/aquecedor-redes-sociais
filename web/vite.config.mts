// Painel (React + TypeScript). "npm run build" gera web/dist, que o painel serve.
// "npm run dev:web" abre o painel com recarga automática, falando com o motor pelo painel (3001), que leva a senha interna.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  // Duas páginas: o painel (index.html) e a tela de login (login.html, a única que abre sem login)
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { main: fileURLToPath(new URL('index.html', import.meta.url)), login: fileURLToPath(new URL('login.html', import.meta.url)) },
    },
  },
  // Desenvolvimento: login, API e tela de login vêm do painel (3001), que tem a proteção
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
      '/auth': 'http://127.0.0.1:3001',
      '/login': 'http://127.0.0.1:3001',
      '/cadastro': 'http://127.0.0.1:3001',
    },
  },
});
