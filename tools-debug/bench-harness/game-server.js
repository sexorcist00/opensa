// Static file server over the play profile (NO_COMMIT/optimized) with Range support + CORS,
// so the headless browser's fake showDirectoryPicker can stream files over HTTP.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2];
const PORT = Number(process.argv[3] ?? 8787);

function walk(dir, base, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walk(path.join(dir, entry.name), rel, out);
    } else if (entry.isFile()) {
      out.push({ path: rel, size: fs.statSync(path.join(dir, entry.name)).size });
    }
  }
  return out;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__index') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(walk(ROOT, '', [])));
    return;
  }
  if (url.startsWith('/f/')) {
    const file = path.join(ROOT, url.slice(3));
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    const size = fs.statSync(file).size;
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = Number(m[1]);
      const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', end - start + 1);
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.setHeader('Content-Length', size);
      fs.createReadStream(file).pipe(res);
    }
    return;
  }
  res.statusCode = 404;
  res.end('unknown route');
});
server.listen(PORT, () => console.log(`game-server on :${PORT} over ${ROOT}`));
