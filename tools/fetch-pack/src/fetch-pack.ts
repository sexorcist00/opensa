import type { Zippable } from 'fflate';

import { zipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';

import { chunkByHash, TARGET_CHUNK_BYTES } from './chunk';

/**
 * The finishing tool of plan 086: pack a pmb build's `opensa/` GAME DIR into the fetch loader's
 * content-hashed zip chunks + `manifest.json` under `static/games/<game>-<version>/`. It knows NOTHING
 * about the game's content — no IDE/IPL parsing, no exterior/interior partitioning (all of that died
 * with `build-game.ts`); it walks files, slices the huge ones, buckets by name hash and zips.
 *
 * Group mapping (the loader's fixed vocabulary `data|models|others|textures`):
 *   data     — `data/` + `text/` + the loose root files (stream.ini, parked.json, …)
 *   models   — `models/` (the IMG archives with the converted `.osm` inside) + `opensa/` (world.ospak,
 *              pak manifest, water.bin) — the heavy geometry+texture payload
 *   others   — everything else (`anim/`, audio, dlls…)
 *   textures — EMPTY for a pak build (textures live inside world.ospak); kept so the manifest shape and
 *              the client's group iteration stay untouched
 *
 * Files above the chunk target are SLICED into `<path>#<index>` parts (a 1 GB world.ospak cannot ride
 * one bucket); the fetch VFS reassembles by suffix (plan 086 phase 3).
 */
export interface FetchPackOptions {
  /** A pmb `--out` dir (e.g. `./build/original`) — its `opensa/` target is what ships. */
  buildDir: string;
  log?: (message: string) => void;
  /** Output root; the game lands under `<outRoot>/<game>-<version>/`. Default `./static/games`. */
  outRoot?: string;
}

export interface FetchPackResult {
  chunks: number;
  entries: number;
  game: string;
  outDir: string;
  version: string;
}

type GroupName = 'data' | 'models' | 'others' | 'textures';

/** Same knob as the legacy build-game chunker: `data` changes most, the rest is cache-stable. */
const CACHED: Record<GroupName, boolean> = { data: false, models: true, others: true, textures: true };
/** Fixed zip timestamp (DOS range) — keeps chunk bytes, hence hash/filename, stable across builds. */
const ZIP_MTIME = new Date('1985-01-01T00:00:00Z');

/** Pack one pmb build into fetch chunks. */
export function fetchPack(options: FetchPackOptions): FetchPackResult {
  // eslint-disable-next-line no-console -- the CLI's default sink; callers inject their own logger
  const log = options.log ?? ((message: string): void => console.log(`[fetch-pack] ${message}`));
  const gameDir = join(resolve(options.buildDir), 'opensa');
  if (!existsSync(gameDir)) {
    throw new Error(`no opensa/ target under ${options.buildDir} — run pmb first`);
  }
  // Identity comes from the pak manifest (plan 086 phase 1); a pre-phase-1 pak falls back loudly.
  const pakManifestPath = join(gameDir, 'opensa', 'manifest.json');
  const pakManifest = existsSync(pakManifestPath)
    ? (JSON.parse(readFileSync(pakManifestPath, 'utf8')) as { appVersion?: string; game?: string })
    : {};
  const game = pakManifest.game ?? basename(resolve(options.buildDir));
  const version = pakManifest.appVersion ?? readRootVersion();
  if (!pakManifest.game || !pakManifest.appVersion) {
    log(`⚠ pak manifest lacks game/appVersion (pre-086 build) — using ${game}-${version} from fallbacks`);
  }

  const outDir = join(resolve(options.outRoot ?? join('static', 'games')), `${game}-${version}`);
  mkdirSync(outDir, { recursive: true });

  const groups: Record<GroupName, { bytes: Uint8Array; name: string }[]> = {
    data: [],
    models: [],
    others: [],
    textures: [],
  };
  let entryCount = 0;
  for (const file of walk(gameDir)) {
    const path = relative(gameDir, file).split(sep).join('/');
    const raw = readFileSync(file);
    const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    for (const entry of sliceEntries([{ bytes, name: path }])) {
      groups[groupOf(path)].push(entry);
    }
    entryCount += 1;
  }

  const chunks = {} as Record<
    GroupName,
    { bytes: number; cached: boolean; entries: number; file: string; hash: string }[]
  >;
  let chunkCount = 0;
  for (const group of ['data', 'models', 'others', 'textures'] as const) {
    const sized = groups[group].map((entry) => ({ ...entry, size: entry.bytes.byteLength }));
    chunks[group] = chunkByHash(sized).map((bucket) => {
      const sorted = [...bucket].sort((a, b) => a.name.localeCompare(b.name)); // stable order → stable bytes
      const zip = buildZip(sorted);
      const hash = createHash('sha1').update(zip).digest('hex').slice(0, 12);
      const file = `${group}-${hash}.zip`;
      writeFileSync(join(outDir, file), zip);
      chunkCount += 1;

      return { bytes: zip.length, cached: CACHED[group], entries: bucket.length, file, hash };
    });
    log(`${group}: ${groups[group].length} entries → ${chunks[group].length} chunk(s)`);
  }

  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify({ chunks, game, version }, null, 2)}\n`, 'utf8');
  log(`→ ${outDir} (${entryCount} files, ${chunkCount} chunks)`);

  return { chunks: chunkCount, entries: entryCount, game, outDir, version };
}

/** Which group a game-dir-relative path ships in (posix-style path expected). */
export function groupOf(path: string): GroupName {
  const top = path.split('/')[0].toLowerCase();
  if (!path.includes('/') || top === 'data' || top === 'text') {
    return 'data';
  }
  if (top === 'models' || top === 'opensa') {
    return 'models';
  }

  return 'others';
}

/** Split oversized entries into `<name>#<index>` parts so no bucket exceeds the chunk target. */
export function sliceEntries(
  entries: readonly { bytes: Uint8Array; name: string }[],
  targetBytes = TARGET_CHUNK_BYTES,
): { bytes: Uint8Array; name: string }[] {
  const out: { bytes: Uint8Array; name: string }[] = [];
  for (const entry of entries) {
    if (entry.bytes.byteLength <= targetBytes) {
      out.push(entry);
      continue;
    }
    for (let index = 0, offset = 0; offset < entry.bytes.byteLength; index += 1, offset += targetBytes) {
      out.push({ bytes: entry.bytes.subarray(offset, offset + targetBytes), name: `${entry.name}#${index}` });
    }
  }

  return out;
}

function buildZip(entries: readonly { bytes: Uint8Array; name: string }[]): Uint8Array {
  const data: Zippable = {};
  for (const entry of entries) {
    // The pak payloads (`.ospak` slices, IMG-borne `.osm`) are deflate-compressed already — store them.
    const level = /\.(?:ospak|img)(?:#\d+)?$/i.test(entry.name) ? 0 : 6;
    data[entry.name] = [entry.bytes, { level: level, mtime: ZIP_MTIME }];
  }

  return zipSync(data);
}

function readRootVersion(): string {
  try {
    const root = join(__dirname, '..', '..', '..');
    const parsed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string };

    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (entry.isFile() && statSync(path).size > 0) {
      yield path;
    }
  }
}
