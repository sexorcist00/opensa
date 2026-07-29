/**
 * Opening a MAP SOURCE (plan 094, phase 0): a folder of ORIGINAL SA files → the resolved map + its cell grid.
 *
 * Two ways in, both reusing the game's own install loaders so what the viewer reads is what the game reads:
 * a user-picked folder (File System Access) or a served dir (`?src=`, the headless-drivable one). Only the
 * `data` + `others` groups are ingested — gta.dat/IDE/IPL is everything {@link resolveMap} needs, so opening a
 * source costs no model or texture bytes (geometry arrives per-cell from phase 1 on).
 *
 * Every load carries a {@link LoadedMap.label} saying WHERE the bytes came from — a capture out of this tool
 * must never be silent about its source (the A/B rule in CLAUDE.md).
 */
import type { GroupName } from '@opensa/loaders';
import type { AssetFileSystem, MapDefinitions, WorldGrid } from '@opensa/renderware';

import { AssetHttpDirLoader, AssetLocalLoader } from '@opensa/loaders';
import { buildWorldGrid } from '@opensa/renderware';
import { OPEN_SCRIPT_IPL, resolveMap } from '@opensa/renderware/map/resolve-map';
import { Vfs } from '@opensa/vfs';

/** A map source opened into memory. */
export interface LoadedMap {
  defs: MapDefinitions;
  fs: AssetFileSystem;
  grid: WorldGrid;
  /** Human-readable origin of these bytes — shown on screen and in every capture. */
  label: string;
}

/** Where to read the game files from. */
export type MapSource =
  /** A statically served game dir (`?src=<url>`; `npm run serve:static` exposes `build/` and `game-src/`). */
  | { base: string; kind: 'http-dir' }
  /** A folder picked through the File System Access API (Chromium). */
  | { kind: 'folder' };

/** Cell-grid totals for the readout. */
export interface MapStats {
  cells: number;
  hd: number;
  instances: number;
  lod: number;
  models: number;
}

/**
 * The RENDER grid cell size — the one opensa-pack welds `.oscell` blobs on. It MUST stay 250: bucket the map
 * on anything else and this viewer's cell coordinates stop naming the same cells as the pack, the debugger and
 * the LOD generator, which nothing catches (`docs/restrictions/architecture.md`). Held here because the shared
 * constant lives in a `type:tool` package an app may not import; phase 1 moves the weld core to an
 * engine-tagged home and this becomes an import from it.
 */
export const RENDER_CELL_SIZE = 250;

/** The asset groups a map resolve needs: loose `data/**` (gta.dat, IDE, text IPL) + the archive's world files. */
const MAP_GROUPS: readonly GroupName[] = ['data', 'others'];

/** Per-tool "last folder" memory for the picker — deliberately not the game's remembered install. */
const PICKER_ID = 'opensa-map-viewer';

/** Open a source and resolve its whole map: parse gta.dat/IDE/IPL, then bucket the instances into cells. */
export async function loadMapSource(source: MapSource): Promise<LoadedMap> {
  const fs = new Vfs();
  const { label, loader } = await openLoader(source, fs);
  await loader.load(MAP_GROUPS);
  const defs = resolveMap(fs, { extraIpl: OPEN_SCRIPT_IPL });

  return { defs, fs, grid: buildWorldGrid(defs, RENDER_CELL_SIZE), label };
}

/** Count what was resolved — the phase-0 readout (and the number an A/B compares first). */
export function mapStats(map: LoadedMap): MapStats {
  let hd = 0;
  let lod = 0;
  for (const cell of map.grid.values()) {
    hd += cell.hd.length;
    lod += cell.lod.length;
  }

  return { cells: map.grid.size, hd, instances: map.defs.instances.length, lod, models: map.defs.catalog.size };
}

/** The source named by the URL, or `null` when the app should show the picker. */
export function sourceFromQuery(search: string): MapSource | null {
  const base = new URLSearchParams(search).get('src');

  return base ? { base: base.replace(/\/$/, ''), kind: 'http-dir' } : null;
}

/** Build the loader for a source. For a folder the picker is the FIRST await, so the click's activation lives. */
async function openLoader(
  source: MapSource,
  sink: Vfs,
): Promise<{ label: string; loader: AssetHttpDirLoader | AssetLocalLoader }> {
  const config = { game: 'sa-map-viewer', sink, version: __APP_VERSION__ };
  if (source.kind === 'http-dir') {
    return { label: source.base, loader: new AssetHttpDirLoader(config, source.base) };
  }

  const dir = await window.showDirectoryPicker({ id: PICKER_ID, mode: 'read' });
  const loader = new AssetLocalLoader(config, {
    acquireDir: (): Promise<FileSystemDirectoryHandle> => Promise.resolve(dir),
    // No handle store: this tool swaps sources constantly and must not repoint the game's remembered install.
    restoreDir: (): Promise<{ handle: null; ready: false }> => Promise.resolve({ handle: null, ready: false }),
  });
  await loader.prepare();

  return { label: `folder: ${dir.name}`, loader };
}
