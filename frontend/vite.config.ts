import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// Port 1420 is the Tauri dev default (see src-tauri/tauri.conf.json devUrl).
export default defineConfig(({ mode }) => {
  // VITE_BASE overrides the asset base path so the same bundle can live under
  // a sub-path: GitHub project Pages serves it at /<repo>/ (deploy.yml builds
  // with VITE_BASE=./, which makes every asset URL relative and therefore
  // portable). The Tauri shell and the nginx vhost (deploy/nginx.conf) serve
  // from the root and keep the default '/'.
  const env = loadEnv(mode, '.', 'VITE_');

  return {
    plugins: [
      react(),
      tailwindcss(),
      // Offline PWA (web only — Tauri bundles the shell locally, and
      // main.tsx skips registration there). What this buys:
      //  - the app shell (index.html + JS + CSS + fonts) is precached,
      //    so the installed app OPENS with no connection at all;
      //  - every navigation falls back to the cached index.html, which
      //    is safe because the router is hash-based (all routes live
      //    under one document URL) — no server rewrite needed;
      //  - registerType 'autoUpdate' means a new deploy takes over on
      //    the next launch without interrupting a playing song;
      //  - injectRegister is off: main.tsx registers by hand so the
      //    Tauri build never touches a service worker.
      // Deliberately NOT cached here: API responses (live data) and the
      // audio itself — downloads already live in IndexedDB and play
      // through blob URLs, so the worker never needs to see them.
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: false,
        includeAssets: ['favicon.png', 'apple-touch-icon.png', 'logo.png'],
        manifest: {
          name: 'Carmen',
          short_name: 'Carmen',
          description: 'Carmen — stream, play and download your music.',
          theme_color: '#4caf50',
          background_color: '#121714',
          display: 'standalone',
          // Icons reuse the PNGs already in the repo (no new binary
          // assets: the GitHub snapshot route this project deploys
          // through is UTF-8-only, so new PNGs cannot ride it). The
          // 512 logo satisfies Chrome's installability size checks on
          // its own (the 192 check is a minimum, not an exact size);
          // no maskable variant is declared, so launchers letterbox
          // the logo instead of cropping it.
          // Relative icon paths: the manifest sits at the build root, so
          // these resolve under both the Vercel root ('/') and a
          // sub-path base ('/<repo>/', GitHub Pages).
          icons: [
            { src: 'logo.png', sizes: '512x512', type: 'image/png' },
            { src: 'apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          navigateFallback: 'index.html',
          cleanupOutdatedCaches: true,
        },
      }),
    ],
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
