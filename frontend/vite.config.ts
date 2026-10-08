import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Port 1420 is the Tauri dev default (see src-tauri/tauri.conf.json devUrl).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: true,
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 4000,
  },
});
