import { defineConfig } from 'vite';
import path from 'node:path';

// Vite config tuned for a kiosk build:
// - Project root is the repo root (index.html lives there)
// - /assets and /config are served as static folders so SFTP-replacing
//   videos/cards/configs doesn't require a rebuild in production preview.
//   These are NOT in Vite's publicDir because we copy them via
//   scripts/copy-static.mjs after build (cross-platform Node copy, runs on
//   Windows kiosk PCs too).
// - Build output goes to /dist; deploy /dist contents to the kiosk PC.
export default defineConfig({
  root: '.',
  publicDir: false,
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
      '@assets': path.resolve(process.cwd(), 'assets'),
      '@config': path.resolve(process.cwd(), 'config'),
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: ['.'],
    },
  },
  build: {
    outDir: 'dist',
    target: 'chrome120',
    assetsInlineLimit: 0,
    rollupOptions: {
      // Two entry points:
      //  - main:  the 95" kiosk experience (index.html)
      //  - token: the standalone mobile token viewer (token.html) that visitors
      //           open by scanning the QR code shown at the end of the flow.
      // Both pages ship in dist/ and share the same assets/ + config/ folders.
      input: {
        main: path.resolve(process.cwd(), 'index.html'),
        token: path.resolve(process.cwd(), 'token.html'),
      },
      output: {
        manualChunks: {
          mediapipe: ['@mediapipe/tasks-vision'],
          three: ['three'],
        },
      },
    },
  },
});
