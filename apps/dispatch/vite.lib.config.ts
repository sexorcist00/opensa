import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

import { appBuild } from '../../scripts/app-build';

/**
 * The embeddable build of the dispatch map (`src/embed.ts`).
 *
 * Separate from the root config on purpose: that one builds this repo's multi-page site, where `dispatch.html`
 * is one entry among several. This one emits a LIBRARY — one ES module a host loads at runtime — and it is
 * the artifact an external console pins.
 *
 * Nothing is externalised. A host has no `@opensa/*` packages and no way to get them (they are private
 * workspace packages), so the bundle carries the engine, the streamer and the formats with it. That is the
 * whole point of shipping an artifact rather than a dependency.
 *
 * React is absent by construction, not by configuration: the surface is plain DOM and engine, and only the
 * console's own chrome (`app.tsx`, not exported here) is React. If a React import ever appears in this
 * bundle, something from the chrome has leaked into the surface.
 *
 * The pak worker stays a SEPARATE chunk and must be served beside the entry, at the path the entry names.
 * Inlining it would make the artifact single-file, but a worker is exactly where the streaming work belongs.
 */

const root = resolve(__dirname, '../..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string };

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/embed.ts'),
      fileName: () => 'dispatch.js',
      formats: ['es'],
    },
    outDir: resolve(root, 'dist-embed'),
    // A host serves this beside its own app; a source map keeps a field report from the console readable.
    sourcemap: true,
    target: 'esnext',
  },
  define: {
    __APP_BUILD__: JSON.stringify(appBuild(root)),
    __APP_VERSION__: JSON.stringify(pkg.version),
    __DEBUGGER_HIDE__: JSON.stringify(true),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  root,
  worker: { format: 'es' },
});
