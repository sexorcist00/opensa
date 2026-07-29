/**
 * Local + E2E static origin (port 3001, matches VITE_STATIC_URL / playwright.config). Serves the built game
 * archives from `static/` (`static/games/<game>-<version>/*`, gitignored), maps `/viewer/*` →
 * `tests/viewer/*` — the object-viewer's e2e fixtures (`npm run test:fixtures`, gitignored, only loaded in
 * `--mode e2e`) — AND maps `/build/*` → `build/*`, the canonical dev source (plan 079): every dev surface
 * points `?src=/build/original/opensa` here instead of copying the ~1.4 GB build into a Vite `public/`. sirv
 * honours Range, so the pak streams. CORS on; dev mode reads files fresh and tolerates a missing root.
 */
import { readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import sirv from 'sirv';

const PORT = Number(process.env.PORT) || 3001;
const serveStatic = sirv('static', { dev: true });
const serveTests = sirv('tests', { dev: true }); // `/viewer/objects/x` → `tests/viewer/objects/x`
const serveBuild = sirv('build', { dev: true }); // `/build/original/opensa/x` → `build/original/opensa/x`

/** A flat `{ path, size }[]` walk of a served dir — the http-dir loader's file index (its `__index` endpoint).
 *  Classified via statSync (NOT the Dirent) so symlinked files/dirs are followed — the model-repack lab dir
 *  (`build/<game>/opensa-lab`, plan 024 phase 0) is a per-file-symlink mirror and sirv already serves them. */
function dirIndex(dir: string, base = ''): { path: string; size: number }[] {
  const out: { path: string; size: number }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const stats = statSync(join(dir, entry.name));
    if (stats.isDirectory()) {
      out.push(...dirIndex(join(dir, entry.name), rel));
    } else if (stats.isFile()) {
      out.push({ path: rel, size: stats.size });
    }
  }

  return out;
}

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // the app (Vite :5173) fetches this origin cross-port
  const notFound = (): void => {
    res.statusCode = 404;
    res.end('Not found');
  };
  if (req.url?.startsWith('/build/')) {
    const path = req.url.slice('/build'.length).split('?')[0]; // drop the mount prefix + query
    // `${base}/__index` → the flat file listing the http-dir loader (fetchInstallSource) needs.
    if (path.endsWith('/__index')) {
      try {
        const body = JSON.stringify(dirIndex(join('build', path.slice(1, -'/__index'.length))));
        res.setHeader('Content-Type', 'application/json');
        res.end(body);
      } catch {
        notFound();
      }

      return;
    }
    req.url = path;
    serveBuild(req, res, notFound);

    return;
  }
  const serve = req.url?.startsWith('/viewer/') ? serveTests : serveStatic;
  serve(req, res, notFound);
}).listen(PORT, '0.0.0.0', () => {
  console.log(`static server on http://localhost:${PORT} (static/ + /viewer → tests/viewer + /build → build)`);
});
