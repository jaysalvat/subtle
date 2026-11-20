import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev only. Hot updates everywhere (components, lib, i18n, styles), so an edit doesn't lose what's on
 * screen (an AI review that cost tokens). Only the stores and actions reload the page: re-run in
 * place they make a second store next to the old one. Side effect accepted (Jay): a lib module a
 * store imports re-runs that store too; if the app acts oddly after an edit (a shortcut on another
 * subtitle than the one shown), reload. STRICT_HMR=1 npm run dev reloads on every non-component change.
 */
function reloadOnStateChange(): Plugin {
  const strict = !!process.env.STRICT_HMR;
  const hot = /\/src\/(components\/[^/]+\.tsx|App\.tsx|.*\.css)$/;
  const state = /\/src\/(store\/|actions\.ts$)/;
  return {
    name: 'subtle-reload-on-state-change',
    handleHotUpdate({ file, server }) {
      if (!file.includes('/src/')) return;
      if (strict ? hot.test(file) : !state.test(file)) return;
      server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}

/**
 * Build only. Writes dist/sw.js from src/sw.js with this build's files to keep for offline use (all
 * but the WebAssembly, fonts and UI languages, kept when first used) and a version from their names: a new build is a new
 * service worker, which the app offers to load (src/store/install.ts).
 */
function subtleServiceWorker(): Plugin {
  return {
    name: 'subtle-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      // Fonts too are kept when first used (Roboto comes in a file per script: Latin is enough here),
      // and UI languages other than English (src/i18n/xx.ts): only the one used is downloaded.
      const isLanguage = (f: string) => {
        const c = bundle[f];
        return c.type === 'chunk' && !!c.facadeModuleId && /\/src\/i18n\/(?!en\.ts$|index\.ts$)[a-z-]+\.ts$/.test(c.facadeModuleId);
      };
      const files = Object.keys(bundle)
        .filter((f) => !/\.(wasm|map|woff2?)$/.test(f) && f !== 'index.html' && !isLanguage(f))
        .sort();
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      const source = readFileSync(new URL('./src/sw.js', import.meta.url), 'utf8')
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('__PRECACHE__', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

/**
 * Whisper's engine (ONNX Runtime's WebGPU build, 25.6 MB) comes from jsDelivr (stt.worker.ts):
 * some static hosts (Cloudflare Pages…) refuse files over 25 MB. ONNX Runtime still names it as a
 * fallback, so the build would copy it: left out here. Remove this plugin to serve it from the app.
 */
function ortFromCdn(): Plugin {
  return {
    name: 'ort-from-cdn',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const f of Object.keys(bundle)) if (/ort-wasm-simd-threaded\.asyncify-[\w-]+\.wasm$/.test(f)) delete bundle[f];
    },
  };
}

/** Subtle's own version (package.json), shown in Settings › Credits. */
const appVersion: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

/** The installed ONNX Runtime's version: Whisper's engine is fetched from jsDelivr at that exact version. */
const ortVersion: string = JSON.parse(readFileSync(new URL('./node_modules/onnxruntime-web/package.json', import.meta.url), 'utf8')).version;

export default defineConfig({
  // Where the app is served: '/' by default, '/subtle/' on GitHub Pages (BASE_PATH, .github/workflows/pages.yml).
  base: process.env.BASE_PATH || '/',
  plugins: [react(), reloadOnStateChange(), ortFromCdn(), subtleServiceWorker()],
  define: { __ORT_VERSION__: JSON.stringify(ortVersion), __APP_VERSION__: JSON.stringify(appVersion) },
});
