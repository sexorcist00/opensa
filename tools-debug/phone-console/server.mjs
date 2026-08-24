/**
 * The phone console: one page on the phone that runs the field-run rituals, says why one will not start, and
 * files what it measures into the repository.
 *
 * **Plain Node, no dependencies, no build step — deliberately.** This is the thing that has to come up when
 * the tree is broken: its whole first job is to tell you that `node_modules` is stale or `tsx` is missing,
 * and a panel that needed either to boot could not say so. Same reasoning as `tools-debug/bench-harness`,
 * and the reason it is `.js` rather than `.ts`.
 *
 *   node tools-debug/phone-console/server.js        (or: npm run panel)
 *
 * **It binds to 127.0.0.1.** A page that runs commands is a shell, and a shell must not appear on the LAN
 * because it was convenient. `PANEL_HOST=0.0.0.0` opts in, and the startup line says what that means.
 */
import { execFile, execFileSync } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, realpath, stat, statfs } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';

import { fileCapture, writeTilesArchive } from './capture-store.mjs';
import { commitPlan, pendingCaptures, runCommit } from './captures.mjs';
import { runChecks, statusPaths, verdict } from './doctor.mjs';
import { buildJob, JobRunner } from './jobs.mjs';
import { htmlFingerprint, htmlNames, listTarFiles } from './webapp.mjs';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const PORT = Number(process.env.PANEL_PORT) || 8787;
const HOST = process.env.PANEL_HOST || '127.0.0.1';
/** The two ports a field run uses (`scripts/phone.sh`), so the doctor can say which are already serving. */
const RUN_PORTS = [Number(process.env.STATIC_PORT) || 3001, Number(process.env.APP_PORT) || 5173];
const MIME = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.json': 'application/json',
  '.mjs': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};
/** A capture is JSON from a browser paste; a tile archive is megabytes. Both are bounded so a stuck upload
 *  cannot eat the phone's memory. */
const MAX_JSON = 8 * 1024 * 1024;
const MAX_UPLOAD = 512 * 1024 * 1024;

const listeners = new Set();
const runner = new JobRunner({
  cwd: REPO,
  onLine: (line) => {
    for (const listener of listeners) {
      listener(line);
    }
  },
});

/** The archive is 1.4 MB and preflight runs every few seconds, so the gunzip is done once per ARCHIVE — a
 *  new one has a different size or mtime, and nothing else can change what is inside it. */
let archiveCache = null;

const probe = {
  /**
   * The served app against the archive it should have come from, by content.
   *
   * `null` when there is no unpacked copy at all — that device runs the dev server, and a check about an
   * archive nobody extracted is noise.
   */
  app: async () => {
    const archivePath = join(REPO, 'prebuilt/opensa-webapp.tar.gz');
    const servedDir = join(REPO, 'build/webapp');
    try {
      const stamp = await stat(archivePath);
      const key = `${stamp.size}:${stamp.mtimeMs}`;
      if (archiveCache?.key !== key) {
        const files = listTarFiles(gunzipSync(await readFile(archivePath)));
        archiveCache = { fingerprint: htmlFingerprint(files), key, names: htmlNames(files) };
      }
      const served = [];
      for (const name of archiveCache.names) {
        served.push({ body: await readFile(join(servedDir, name)), name });
      }

      return { archived: archiveCache.fingerprint, served: htmlFingerprint(served) };
    } catch {
      // No archive, or no unpacked copy — either way there is nothing to compare and nothing to say.
      return null;
    }
  },
  arch: process.arch,
  exists: async (path) => existsSync(join(REPO, path)),
  freeBytes: async (path) => {
    try {
      const stats = await statfs(join(REPO, path));

      return stats.bavail * stats.bsize;
    } catch {
      return null;
    }
  },
  git: async () => {
    try {
      const branch = (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO })).stdout.trim();
      const status = (await run('git', ['status', '--porcelain'], { cwd: REPO })).stdout;
      let behind = 0;
      try {
        const counts = (
          await run('git', ['rev-list', '--left-right', '--count', `${branch}...origin/${branch}`], { cwd: REPO })
        ).stdout.trim();
        behind = Number(counts.split(/\s+/)[1] ?? 0);
      } catch {
        behind = 0; // no upstream yet — not a problem to report
      }

      const paths = statusPaths(status);

      return { behind, branch, dirty: paths.length, dirtyPaths: paths };
    } catch {
      return null;
    }
  },
  /** Who this repository commits as, and who owns its remote — the fix line is derived from the second. */
  identity: async () => {
    const read = async (key) => {
      try {
        return (await run('git', ['config', '--get', key], { cwd: REPO })).stdout.trim();
      } catch {
        return ''; // `git config --get` exits 1 when the key is unset
      }
    };
    const owner = async () => {
      try {
        const url = (await run('git', ['remote', 'get-url', 'origin'], { cwd: REPO })).stdout.trim();

        return /[/:]([^/]+)\/[^/]+?(?:\.git)?$/.exec(url)?.[1] ?? '';
      } catch {
        return '';
      }
    };

    return { email: await read('user.email'), name: await read('user.name'), owner: await owner() };
  },
  mtime: async (path) => {
    try {
      return (await stat(join(REPO, path))).mtimeMs;
    } catch {
      return null;
    }
  },
  nodeVersion: process.version,
  portOpen: (port) =>
    new Promise((done) => {
      const socket = connect(port, '127.0.0.1');
      socket.setTimeout(600);
      socket.on('connect', () => {
        socket.end();
        done(true);
      });
      socket.on('error', () => done(false));
      socket.on('timeout', () => {
        socket.destroy();
        done(false);
      });
    }),
  readJson: async (path) => {
    try {
      return JSON.parse(await readFile(join(REPO, path), 'utf8'));
    } catch {
      return null;
    }
  },
  realpath: async (path) => {
    try {
      return await realpath(join(REPO, path));
    } catch {
      return null;
    }
  },
  termux: Boolean(process.env.PREFIX) && existsSync('/data/data/com.termux'),
  wakeLock: existsSync('/data/data/com.termux/files/usr/bin/termux-wake-lock'),
};

createServer((request, response) => {
  handle(request, response).catch((error) => {
    send(response, 500, { error: String(error?.message ?? error) });
  });
}).listen(PORT, HOST, () => {
  const where = HOST === '127.0.0.1' ? 'this phone only' : `EVERY device on this network can run commands here`;
  process.stdout.write(`phone console on http://localhost:${PORT} — ${where}\n`);
});

/** Commit the filed captures — and push when asked, on the branch that is checked out. */
async function commit(body) {
  const plan = commitPlan(body.paths ?? [], body.subject ?? 'a capture from the phone');
  const branch = (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO })).stdout.trim();

  return runCommit({
    branch,
    log: (line) => runner.push(line),
    plan,
    push: body.push === true,
    run: (command, args, env) => run(command, args, { cwd: REPO, env: { ...process.env, ...env } }),
  });
}

/** The device, for a capture's conditions. `getprop` is Android's own and absent everywhere else. */
function deviceName() {
  try {
    return execFileSync('getprop', ['ro.product.model'], { encoding: 'utf8' }).trim() || process.platform;
  } catch {
    return `${process.platform}/${process.arch}`;
  }
}

/**
 * The measurement districts, read straight out of the console's own table.
 *
 * A regex over a TypeScript file rather than running it: `scripts/district.ts` needs `tsx`, and this list is
 * wanted on exactly the screen that reports tsx missing. When the shape changes the list comes back empty and
 * the field stays free text — the failure is a plain input box, never a wrong district.
 */
async function districtNames() {
  try {
    const source = await readFile(join(REPO, 'apps/dispatch/src/world/districts.ts'), 'utf8');

    return [...source.matchAll(/^\s{2}'?([a-z0-9-]{3,40})'?:\s*\{/gm)].map((match) => match[1]);
  } catch {
    return [];
  }
}

async function handle(request, response) {
  const url = new URL(request.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  if (request.method === 'GET' && (path === '/' || path === '/index.html')) {
    return serveFile(response, join(HERE, 'app/index.html'));
  }
  if (request.method === 'GET' && /^\/app\/[\w.-]+$/.test(path)) {
    return serveFile(response, join(HERE, path.slice(1)));
  }
  if (request.method === 'GET' && path === '/api/state') {
    const target = {
      game: url.searchParams.get('game') || './game-src/original',
      out: url.searchParams.get('out') || './build/phone',
      ports: RUN_PORTS,
    };
    const checks = await runChecks(probe, target);

    return send(response, 200, {
      checks,
      districts: await districtNames(),
      job: runner.status(),
      // Read from git rather than remembered by the page: a capture written before a reload is still there,
      // and a panel that forgot filing it would refuse to commit it.
      pending: await pending(),
      ports: { app: RUN_PORTS[1], static: RUN_PORTS[0] },
      verdict: verdict(checks),
      // Which app URL to offer: a prebuilt copy is served as static files and vite is never started, which
      // on some arm64 CPUs is the only way in at all (`scripts/phone.sh`).
      webapp: await probe.exists('build/webapp/index.html'),
    });
  }
  if (request.method === 'GET' && path === '/api/log') {
    return streamLog(response);
  }
  if (request.method === 'POST' && path.startsWith('/api/job/')) {
    const plan = buildJob(path.slice('/api/job/'.length), await readJson(request));

    return send(response, 200, runner.start(plan));
  }
  if (request.method === 'POST' && path === '/api/stop') {
    return send(response, 200, runner.stop());
  }
  if (request.method === 'POST' && path === '/api/capture') {
    const body = await readJson(request);
    const filed = await fileCapture(REPO, body, { device: deviceName(), node: process.version, probe });

    return send(response, 200, filed);
  }
  if (request.method === 'POST' && path === '/api/tiles') {
    const out = url.searchParams.get('out') || './build/phone';
    const filed = await writeTilesArchive(REPO, out, await readBody(request, MAX_UPLOAD));

    return send(response, 200, filed);
  }
  if (request.method === 'POST' && path === '/api/commit') {
    return send(response, 200, await commit(await readJson(request)));
  }

  return send(response, 404, { error: `no route for ${request.method} ${path}` });
}

/** Captures written but not committed — the list the commit button acts on. */
async function pending() {
  try {
    const { stdout } = await run('git', ['status', '--porcelain', '--untracked-files=all', '--', 'docs/benchmarks'], {
      cwd: REPO,
    });

    return pendingCaptures(statusPaths(stdout));
  } catch {
    return [];
  }
}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      throw new Error(`body over ${(limit / 1024 / 1024).toFixed(0)} MB`);
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function readJson(request) {
  const body = await readBody(request, MAX_JSON);

  return body.length === 0 ? {} : JSON.parse(body.toString('utf8'));
}

function send(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json' });
  response.end(payload);
}

function serveFile(response, file) {
  if (!existsSync(file)) {
    return send(response, 404, { error: `missing ${file}` });
  }
  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
  });
  createReadStream(file).pipe(response);
}

/**
 * The log, as server-sent events.
 *
 * The backlog goes out first and that is the point: a phone screen sleeps, the browser drops the connection,
 * and a reconnect that showed an empty box would make a running convert look like a dead one.
 */
function streamLog(response) {
  response.writeHead(200, {
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'content-type': 'text/event-stream',
  });
  const write = (line) => response.write(`data: ${JSON.stringify(line)}\n\n`);
  for (const line of runner.backlog()) {
    write(line);
  }
  listeners.add(write);
  // A comment frame every 20 s: Android's radio drops an idle connection long before a convert prints again.
  const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), 20_000);
  response.on('close', () => {
    clearInterval(keepAlive);
    listeners.delete(write);
  });
}
