// Post-build helper — copies /assets and /config into dist/.
//
// We deliberately don't use Vite's `publicDir` here: those folders are read
// at runtime via fetch('/config/assets.json') and direct <video src="..."> URLs,
// not via JS imports, so Vite doesn't see them as dependencies and would
// otherwise skip them. Copying after build keeps the SFTP-replaceable layout
// intact in production.
//
// Cross-platform: uses Node fs.cpSync, no shell or rsync. Works on Windows
// (the kiosk media server target) and macOS/Linux (the dev machine) identically.

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dist = resolve(root, 'dist');

if (!existsSync(dist)) {
  console.error('[copy-static] dist/ not found — run `vite build` first.');
  process.exit(1);
}

const folders = ['assets', 'config'];
for (const folder of folders) {
  const src = resolve(root, folder);
  const dest = resolve(dist, folder);
  if (!existsSync(src)) {
    console.warn(`[copy-static] skipped missing source: ${folder}/`);
    continue;
  }
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`[copy-static] copied ${folder}/ → dist/${folder}/`);
}

console.log('[copy-static] done.');
