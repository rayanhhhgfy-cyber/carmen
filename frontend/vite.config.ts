import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Port 1420 is the Tauri dev default (see src-tauri/tauri.conf.json devUrl).
export default defineConfig(({ mode }) => {
  // VITE_BASE overrides the asset base path so the same bundle can live under
  // a sub-path: GitHub project Pages serves it at /<repo>/ (deploy.yml builds
  // with VITE_BASE=./, which makes every asset URL relative and therefore
  // portable). The Tauri shell and the nginx vhost (deploy/nginx.conf) serve
  // from the root and keep the default '/'.
  const env = loadEnv(mode, '.', 'VITE_');

  return {
    plugins: [react(), tailwindcss()],
    clearScreen: false,
    base: env.VITE_BASE || '/',
    server: {
      host: true,
      port: 1420,
      strictPort: true,
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 4000,
    },
  };
});
