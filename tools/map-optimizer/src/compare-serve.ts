/**
 * Compare server for the before/after model viewer (plan 019 Phase 2). Serves raw DFF/TXD bytes out of two
 * game trees' IMG archives so the viewer's compare tab (`viewer.html?tab=compare`) can show one model
 * side-by-side — BEFORE from any game dir (stock `non-modified`, a mod-installer output, …), AFTER from the
 * optimizer's output. Usage:
 * `tsx map-optimizer/src/compare-serve.ts --before <gameDir> --after <gameDir> [--port 3002]`.
 *
 * Endpoints (all GET, CORS `*`):
 * - `/models`                         → JSON sorted model names present in BOTH sides' archives
 * - `/dff?side=before|after&model=m`  → the model's DFF bytes from that side
 * - `/txd?side=before|after&model=m`  → the model's TXD bytes (txd name resolved from that side's IDEs)
 */
import { openArchive } from '@opensa/renderware/archive/img-archive';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { isAbsolute, join, resolve } from 'node:path';

import { modelTxdMap } from './adapters/gta-sa/resolve';

interface Side {
  get(name: string): ArrayBuffer | null;
  names: Set<string>;
  txdByModel: Map<string, string>;
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fromCwd(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function main(): void {
  const beforeArg = argValue('--before');
  const afterArg = argValue('--after');
  if (!beforeArg || !afterArg) {
    throw new Error('usage: tsx map-optimizer/src/compare-serve.ts --before <gameDir> --after <gameDir> [--port 3002]');
  }
  const port = Number(argValue('--port') ?? 3002);
  const sides: Record<'after' | 'before', Side> = {
    after: openSide(fromCwd(afterArg)),
    before: openSide(fromCwd(beforeArg)),
  };
  const models = [...sides.before.names]
    .filter((name) => name.endsWith('.dff') && sides.after.names.has(name))
    .map((name) => name.slice(0, -4))
    .sort();

  createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // the viewer (Vite :5173) fetches cross-port
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/models') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(models));

      return;
    }
    const sideParam = url.searchParams.get('side');
    const model = (url.searchParams.get('model') ?? '').toLowerCase();
    const side = sideParam === 'before' || sideParam === 'after' ? sides[sideParam] : null;
    if (!side || !model || (url.pathname !== '/dff' && url.pathname !== '/txd')) {
      res.statusCode = 404;
      res.end('not found');

      return;
    }
    if (url.pathname === '/dff') {
      sendBytes(res, side.get(`${model}.dff`));
    } else {
      const txd = side.txdByModel.get(model);
      sendBytes(res, txd ? side.get(`${txd}.txd`) : null);
    }
  }).listen(port, () => {
    console.log(`compare server on http://localhost:${port} — ${models.length} model(s) on both sides`);
    console.log(`open viewer.html?tab=compare (npm run dev)`);
  });
}

/** Open every models/*.img of a game dir + its IDE model→txd map. */
function openSide(gameDir: string): Side {
  const modelsDir = join(gameDir, 'models');
  const archives = readdirSync(modelsDir)
    .filter((file) => file.toLowerCase().endsWith('.img'))
    .sort((a, b) => (a.toLowerCase() === 'gta3.img' ? -1 : b.toLowerCase() === 'gta3.img' ? 1 : a.localeCompare(b)))
    .map((file) => openArchive(new Uint8Array(readFileSync(join(modelsDir, file)))));
  const names = new Set<string>();
  for (const archive of archives) {
    for (const name of archive.names) {
      names.add(name);
    }
  }

  return {
    get: (name): ArrayBuffer | null => {
      for (const archive of archives) {
        const bytes = archive.get(name);
        if (bytes) {
          return bytes;
        }
      }

      return null;
    },
    names,
    txdByModel: modelTxdMap(join(gameDir, 'data')),
  };
}

function sendBytes(res: ServerResponse, bytes: ArrayBuffer | null): void {
  if (!bytes) {
    res.statusCode = 404;
    res.end('not found');

    return;
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.end(Buffer.from(bytes));
}

main();
