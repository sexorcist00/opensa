/**
 * Local + E2E static origin (port 3001, matches VITE_STATIC_URL / playwright.config). Serves the built game
 * archives from `static/` (`static/games/<game>-<version>/*`, gitignored), maps `/viewer/*` →
 * `tests/viewer/*` — the object-viewer's e2e fixtures (`npm run test:fixtures`, gitignored, only loaded in
 * `--mode e2e`) — AND maps `/build/*` → `build/*`, the canonical dev source (plan 079): every dev surface
 * points `?src=/build/perfect/opensa` here instead of copying the ~1.4 GB build into a Vite `public/`. sirv
 * honours Range, so the pak streams. CORS on; dev mode reads files fresh and tolerates a missing root.
 */
import { createServer } from 'node:http';
import sirv from 'sirv';

const PORT = Number(process.env.PORT) || 3001;
const serveStatic = sirv('static', { dev: true });
const serveTests = sirv('tests', { dev: true }); // `/viewer/objects/x` → `tests/viewer/objects/x`
const serveBuild = sirv('build', { dev: true }); // `/build/perfect/opensa/x` → `build/perfect/opensa/x`

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // the app (Vite :5173) fetches this origin cross-port
  const notFound = (): void => {
    res.statusCode = 404;
    res.end('Not found');
  };
  if (req.url?.startsWith('/build/')) {
    req.url = req.url.slice('/build'.length); // sirv('build') serves that dir at root — drop the mount prefix
    serveBuild(req, res, notFound);

    return;
  }
  const serve = req.url?.startsWith('/viewer/') ? serveTests : serveStatic;
  serve(req, res, notFound);
}).listen(PORT, '0.0.0.0', () => {
  console.log(`static server on http://localhost:${PORT} (static/ + /viewer → tests/viewer + /build → build)`);
});
