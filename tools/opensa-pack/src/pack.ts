/**
 * `opensa-pack` as a LIBRARY (plan opensa-pack/003 phase 6).
 *
 * The converter's real home is a stage inside perfect-map-builder, where the full modded game is assembled —
 * and a pipeline stage must not go through argv. So the whole convert lives here, taking options, and the
 * CLI is nothing but flag parsing on top of it.
 *
 * The order is the data's, not a preference: weld the district into cells, convert every model class against
 * the shared texture plan the weld produced (the ONE moment that plan is complete and still open), copy the
 * game dir, then rewrite the archives so each `.osm` replaces the `.dff` it was built from.
 */
import type { MapDefinitions } from '@opensa/renderware';

import { breakableModelsFromText } from '@opensa/renderware/breakable/models';
import { copyGameDir, guardOut } from '@opensa/tool-kit/game-dir';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TexturePlanner } from './textures';

import { rewriteModelArchives } from './archive-edit';
import { convertDistrict } from './convert';
import { openGameDir } from './game-fs';
import { WaterHeightGrid } from './height-grid';
import { createModelBundles } from './model-bundle';
import { packAnimObjects } from './pack-anim-objects';
import { packBreakables } from './pack-breakables';
import { packClutter } from './pack-clutter';
import { packMapObjects } from './pack-map-objects';
import { packPeds } from './pack-peds';
import { packProps } from './pack-props';
import { packVehicles } from './pack-vehicles';
import { bakeWater } from './water';
import { isVegetationDef } from './weld';

/**
 * The RENDER cell size: the grid the district is welded into and the manifest ships to the engine, which
 * streams and draws `.oscell` blobs on it. NOT an option — the pak and the runtime must agree, and nothing
 * checked that when it was a flag.
 *
 * Distinct from the GAME-side grid (`GAME_CELL_SIZE`, 256) that collision streaming, procobj scatter and the
 * LOD-impostor bake use. The two have never been equal and need not be.
 */
export const CELL_SIZE = 250;

export interface PackOptions {
  /** Bake per-vertex AO/skyVis. ON by default — it stands in for prod's SSAO, so a shipping pak needs it. */
  ao?: boolean;
  /** Bake per-vertex SUN VISIBILITY — the heavy shadow bake. OFF by default; production converts need it. */
  bakes?: boolean;
  /** Bake worker pool size; the default is a quarter of the cores. */
  bakeWorkers?: number;
  /** The game dir to convert. */
  gameDir: string;
  /** Fetch game id stamped into the manifest (plan 086: `game-src/<id>` — folder name IS the id).
   *  Defaults to `basename(gameDir)`; pmb passes its `--game` basename because ITS gameDir here is a
   *  work-stage intermediate. */
  gameId?: string;
  log?: (message: string) => void;
  /** Convert the per-model half (and rewrite the ~1 GB archives). ON by default. */
  models?: boolean;
  /** The output game dir — a COPY of `gameDir`; the pak products go to `pakDir`. */
  outDir: string;
  /** Where the pak products land (`world.ospak`, `manifest.json`, `water.bin`, `report.json`).
   *  Defaults to `<outDir>/pak` (plan 086 phase 8: the game dir is SELF-CONTAINED — one folder pick
   *  serves the whole game; `pak/` replaced the confusing nested `opensa/` name). */
  pakDir?: string;
  /** Inclusive GTA CELL-coordinate rect [x0, y0, x1, y1]. */
  rect: readonly [number, number, number, number];
  /** Stochastic de-tiling name lists; defaults to the curated `data/stochastic.txt`. */
  stochasticFiles?: readonly string[];
}

export interface PackResult {
  models: null | object;
  report: Awaited<ReturnType<typeof convertDistrict>>['report'];
}

interface PackedModels {
  animObjects: ReturnType<typeof packAnimObjects>;
  breakables: ReturnType<typeof packBreakables>;
  clutter: ReturnType<typeof packClutter>;
  deletes: string[];
  mapObjects: ReturnType<typeof packMapObjects>;
  peds: ReturnType<typeof packPeds>['report'];
  props: ReturnType<typeof packProps>;
  vehicles: ReturnType<typeof packVehicles>['report'];
}
/** `HH:mm DD-MM-YYYY` in local time — the opensa manifest `buildTime`, e.g. `07:52 21-07-2026`. */
export function formatBuildTime(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');

  return (
    `${pad(now.getHours())}:${pad(now.getMinutes())} ` +
    `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`
  );
}

/** Convert one game dir into a packed one — everything the CLI used to do, minus the argv. */
export async function packGameDir(options: PackOptions): Promise<PackResult> {
  const { gameDir, outDir, rect } = options;
  const ao = options.ao ?? true;
  const bakes = options.bakes ?? false;
  const models = options.models ?? true;
  const log = options.log ?? ((message: string): void => console.log(`[opensa-pack] ${message}`));
  guardOut(outDir, gameDir);

  const started = Date.now();
  log(`loading game dir ${gameDir} …`);
  const fs = openGameDir(gameDir);
  log(
    `converting rect ${rect.join(',')} (cellSize ${CELL_SIZE}, ao ${ao ? 'on' : 'off'}, ` +
      `sunvis ${bakes ? 'on' : 'off'}) …`,
  );
  const stochasticNames = readStochasticNames(options.stochasticFiles);
  const waterHeights = new WaterHeightGrid();
  // ONE `.osm` per model, contributed to by every class the model belongs to (a cactus is clutter AND a
  // breakable). Emitting a file per class instead loses whichever contribution the archive editor dedupes
  // away — the accumulator is what makes that impossible.
  const bundles = createModelBundles();
  let packed: null | PackedModels = null;
  const { manifest, pak, report } = await convertDistrict(fs, {
    ao,
    ...(options.bakeWorkers !== undefined ? { bakeWorkers: options.bakeWorkers } : {}),
    cellSize: CELL_SIZE,
    log,
    // Every model class converts HERE: the by-name ones first (they own their private dictionaries), then
    // the map objects, which resolve into the world plan this hook hands over while it is still open.
    ...(models
      ? {
          onWorldPlanned: (planner, mapDefs): void => {
            packed = packModels(fs, mapDefs, planner, bundles, log);
          },
        }
      : {}),
    rect,
    stochasticNames,
    sunVis: bakes,
    waterHeights,
  });

  // The output is a game dir (003 phase 1): mirror the input; the pak products go to `<out>/pak` (plan
  // 086 phase 8) so ONE folder pick serves the whole game.
  const copyStarted = Date.now();
  copyGameDir(gameDir, outDir);
  const products = options.pakDir ?? join(outDir, 'pak');
  mkdirSync(products, { recursive: true });
  log(`copied the game dir → ${outDir} (${((Date.now() - copyStarted) / 1000).toFixed(1)} s)`);

  // Water bake (074/06 row 12 v2, user directive — water WITHOUT the shadow bakes): shore-field
  // tessellation from water.dat, pure 2D geometry (no rays, no BVH), always on — it costs seconds.
  const waterText = fs.getText('data/water.dat');
  if (waterText !== null) {
    const water = bakeWater(waterText, (x, y) => waterHeights.heightAt(x, y));
    writeFileSync(join(products, 'water.bin'), water.bin);
    manifest.water = { ...water.manifest, file: 'water.bin' };
    log(
      `water: ${water.manifest.vertexCount} verts / ${water.manifest.indexCount / 3} tris ` +
        `(shore field baked, ${(water.bin.byteLength / 1048576).toFixed(1)} MB)`,
    );
  }
  writeFileSync(join(products, 'world.ospak'), pak);
  // Stamp the build time so the debugger can show which pak the runtime is on. This is the one intentionally
  // non-reproducible field in the output (the pak bytes stay byte-identical); it is set here in the CLI, not
  // in `buildOspak`, so the deterministic core is untouched.
  manifest.buildTime = formatBuildTime(new Date());
  // Fetch identity (plan 086 phase 1): which game this pak IS and which app built it — the finishing
  // fetch-pack tool and the fetch client key their manifests/caches on the pair.
  manifest.game = options.gameId ?? basename(resolve(gameDir));
  const appVersion = readAppVersion();
  if (appVersion !== null) {
    manifest.appVersion = appVersion;
  }
  writeFileSync(join(products, 'manifest.json'), JSON.stringify(manifest));

  // Convert the by-name assets INTO the copied archives — `<model>.dff`/`<txd>.txd` out, `<model>.osm` in.
  const written = packed ? rewriteOptimizedArchives(outDir, bundles, packed, log) : null;
  writeFileSync(
    join(products, 'report.json'),
    JSON.stringify({ ...report, ...(written ? { models: written } : {}) }, null, 2),
  );
  printReport(report, started, log);

  return { models: written, report };
}

/** The repo root `package.json` version (module-relative — cwd-independent), or null outside the repo. */
export function readAppVersion(): null | string {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const parsed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string };

    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

/** The two texture-resolution ledgers (085 rows B/F): cross-TXD rescues (info) and true misses (warn). */
function logTextureLedgers(
  textures: Awaited<ReturnType<typeof convertDistrict>>['report']['textures'],
  log: (message: string) => void,
): void {
  const crossTxd = Object.values(textures.crossTxd);
  if (crossTxd.length > 0) {
    // Names the def's own chain lacked but another TXD supplied (085 row F) — the mod-triage view:
    // a mod TXD that dropped names its stock predecessor had shows up here, one line per name.
    log(`ℹ ${crossTxd.length} texture name(s) resolved through the global index:`);
    for (const entry of crossTxd.slice(0, 24)) {
      const models = entry.models.slice(0, 6).join(', ') + (entry.models.length > 6 ? ', …' : '');
      log(`  ${entry.txd} lacks '${entry.texture}' ← taken from ${entry.donor} — model(s): ${models || '?'}`);
    }
    if (crossTxd.length > 24) {
      log(`  … ${crossTxd.length - 24} more — full list in report.json textures.crossTxd`);
    }
  }
  const missing = Object.entries(textures.missing);
  if (missing.length > 0) {
    // Missing textures render as the material colour (vanilla parity) — quiet in the frame, loud here:
    // one line per failed name WITH the models that asked for it, so a broken mod is identifiable
    // straight from the console (user decides what to do with the mod afterwards).
    log(`⚠ ${missing.length} texture name(s) resolved nowhere (material-colour stand-ins):`);
    for (const [key, entry] of missing.slice(0, 24)) {
      const models = entry.models.slice(0, 6).join(', ') + (entry.models.length > 6 ? ', …' : '');
      log(`  ${key} ×${entry.count} — model(s): ${models === '' ? '?' : models}`);
    }
    if (missing.length > 24) {
      log(`  … ${missing.length - 24} more — full list in report.json textures.missing`);
    }
  }
}

/**
 * Convert every model class into `bundles` (003 phases 3–5). Runs from `convertDistrict`'s world-plan hook,
 * because the last class — map objects — resolves into the SHARED texture plan and that plan is only
 * complete and still open at that one moment.
 *
 * Order is load-bearing: the by-name classes go first so a model they own keeps its PRIVATE dictionary (a
 * clutter species is one instanced draw and cannot switch texture arrays mid-mesh), and map objects then
 * take only what is left.
 */
function packModels(
  fs: ReturnType<typeof openGameDir>,
  defs: MapDefinitions,
  planner: TexturePlanner,
  bundles: ReturnType<typeof createModelBundles>,
  log: (message: string) => void,
): PackedModels {
  const vehicles = packVehicles(fs, bundles, log);
  // Smashable props (5b): only a `SHAT` section, so the model keeps its `.dff` — the shatter mesh is the
  // ONLY thing the runtime resolves by name for a prop, and it is what costs a main-thread DFF parse.
  const breakables = packBreakables(fs, breakableModelsFromText(fs.getText('data/object.dat')), bundles, log);
  // Clutter species (5c): the HOT by-name class — a species builds on cell stream-in, not on a rare event.
  const clutter = packClutter(fs, defs, bundles, log);
  // Topple props (5d): the collider hull the host otherwise collects with a SECOND clump walk per prop.
  const props = packProps(fs, defs, bundles, log);
  // Animated map objects (5e): the frame tree the IFP matches by name — the clip stays a separate asset.
  const animObjects = packAnimObjects(fs, defs, bundles, log);
  // Peds (5f): their own DESC/GEOM — no colours, no paint slots, but joints/weights and a real skeleton.
  const peds = packPeds(fs, bundles, log);
  // Map objects (5g): everything else the IDEs name, against the shared dictionary.
  const mapObjects = packMapObjects(fs, defs, planner, bundles, isVegetationDef, log, defs.txdParents);

  return {
    animObjects,
    breakables,
    clutter,
    deletes: [...vehicles.deletes, ...peds.deletes, ...mapObjects.deletes],
    mapObjects,
    peds: peds.report,
    props,
    vehicles: vehicles.report,
  };
}

/** Parse a de-tiling list: plain names (one per line, `#` comments) OR skygfx `texdb.txt` lines
 *  (`"name" … stochastic=1`) — drop the mod's own database in via `--stochastic` and it just works. */
function parseStochasticList(text: string): Set<string> {
  const names = new Set<string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith('//')) {
      continue;
    }
    if (line.startsWith('"')) {
      // skygfx texdb entry: only the stochastic-tagged ones matter here.
      if (/stochastic=0*[1-9]/.test(line)) {
        const quoted = /^"([^"]+)"/.exec(line);
        if (quoted) {
          names.add(quoted[1].toLowerCase());
        }
      }
    } else {
      names.add(line.toLowerCase());
    }
  }

  return names;
}

/** The end-of-convert summary block, incl. the plan-001 missing-normals guard. */
function printReport(
  report: Awaited<ReturnType<typeof convertDistrict>>['report'],
  started: number,
  log: (message: string) => void,
): void {
  const cellCount = report.cells.length;
  const groupHistogram = report.cells.map((cell) => cell.groups);
  const maxGroups = Math.max(0, ...groupHistogram);
  const avgGroups = groupHistogram.reduce((sum, value) => sum + value, 0) / Math.max(1, cellCount);
  log(
    `done in ${((Date.now() - started) / 1000).toFixed(1)}s: ${cellCount} cell entries, ` +
      `pak ${(report.pakBytes / (1024 * 1024)).toFixed(1)} MB, groups avg ${avgGroups.toFixed(1)} max ${maxGroups}, ` +
      `textures pass=${report.textures.opaquePass} processed=${report.textures.processed} ` +
      `colors=${report.textures.colors} dedup=${report.textures.dedup} arrays=${report.textures.arrays}, ` +
      `timed objects=${report.timedObjects}, animated(live)=${report.animatedObjects}, ` +
      `animated(static)=${report.animatedStatic}, particles=${report.particles}, ` +
      `breakables=${report.breakables}, uv-scroll=${report.uvAnimObjects}/${report.uvAnimations}, ` +
      `roadsigns=${report.roadsigns}, normals authored=${report.normals.authored} computed=${report.normals.computed}`,
  );
  logTextureLedgers(report.textures, log);
  const normalsTotal = report.normals.authored + report.normals.computed;
  if (normalsTotal > 0 && report.normals.computed / normalsTotal > 0.1) {
    // opensa-pack plan 001: computed normals = the runtime invents them (naive average, no crease model) —
    // the plan-17 polygon-patch lighting bugs. A map-optimizer build ships normals on every world model.
    log(
      `⚠ ${report.normals.computed} of ${normalsTotal} models have no authored normals — ` +
        `run the map through map-optimizer first (its plans 020-023) or expect polygon-patch lighting`,
    );
  }
  if (report.ao) {
    log(
      `ao bake: ${(report.ao.ms / 1000).toFixed(1)}s — ${report.ao.vertices} verts ` +
        `(${report.ao.uniqueVertices} unique), ${report.ao.rays} rays vs ${report.ao.triangles} tris`,
    );
  }
  if (report.sunVis) {
    log(
      `sunvis bake: ${(report.sunVis.ms / 1000).toFixed(1)}s — ${report.sunVis.vertices} verts ` +
        `(${report.sunVis.uniqueVertices} unique), ${report.sunVis.rays} rays`,
    );
  }
}
/**
 * Stochastic de-tiling list (074/12): the CURATED uniform-noise list is the ONLY default — the skygfx
 * texdb (`data/skygfx-texdb.txt`) scrambled structured textures in the field.
 */
function readStochasticNames(files?: readonly string[]): Set<string> {
  const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
  const paths = files && files.length > 0 ? files : [join(dataDir, 'stochastic.txt')];
  const names = new Set<string>();
  for (const path of paths) {
    for (const name of parseStochasticList(readFileSync(path, 'utf8'))) {
      names.add(name);
    }
  }

  return names;
}
/**
 * Write the accumulated `.osm` files into the copied archives and report what moved. Rebuilding the
 * archives is the expensive half — it streams, but it still rewrites ~1 GB of `gta3.img`.
 */
function rewriteOptimizedArchives(
  out: string,
  bundles: ReturnType<typeof createModelBundles>,
  packed: PackedModels,
  log: (message: string) => void,
): object {
  const started = Date.now();
  const rewrite = rewriteModelArchives(out, { deletes: packed.deletes, inserts: bundles.inserts() });
  for (const archive of rewrite.archives) {
    log(
      `archive ${archive.file}: +${archive.inserted} -${archive.deleted} entries, ` +
        `${(archive.bytes / 1048576).toFixed(0)} MB`,
    );
  }
  if (rewrite.unplaced.length > 0) {
    // An insert whose origin no archive held would be a SILENT no-render at runtime — never let it pass quietly.
    console.warn(
      `[opensa-pack] ⚠ ${rewrite.unplaced.length} optimized entries had no home archive: ` +
        rewrite.unplaced.slice(0, 8).join(', '),
    );
  }
  reportFailures(packed, log);
  log(`${bundles.size()} models bundled; archive rewrite done in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  return { ...packed, rewrite };
}

/** How many model names one failure class prints before it says "+N more" — `report.json` always has all. */
const MAX_LISTED_FAILURES = 20;

/**
 * Name what did not convert, grouped by failure CLASS. The counts in each stage's summary say how MANY
 * failed but never which, so nothing was debuggable from the console; the raw per-model dump this replaces
 * bypassed the injected `log` and buried the signal (41 map objects failing for ONE reason read as 41
 * unrelated problems). Every failure is still in `report.json` in full — this is the index into it.
 */
function reportFailures(packed: PackedModels, log: (message: string) => void): void {
  const classes = new Map<string, { models: string[]; title: string }>();
  for (const [label, failures] of [
    ['vehicle', packed.vehicles.failed],
    ['clutter', packed.clutter.failed],
    ['ped', packed.peds.failed],
    ['anim object', packed.animObjects.failed],
    ['prop', packed.props.failed],
    ['breakable', packed.breakables.failed],
    ['map object', packed.mapObjects.failed],
  ] as const) {
    for (const failure of failures) {
      // Drop the per-model detail (the name, the vertex count) so one cause collapses into one line.
      const reason = failure.error.split(failure.model).join('<model>').replace(/\d+/g, 'N');
      // NUL as the composite-key separator (written as an ESCAPE — a literal one makes the file binary
      // to grep): no label or error message can contain it, so two classes can never collide.
      const key = `${label}\u0000${reason}`;
      const bucket = classes.get(key) ?? { models: [], title: `${label} — ${reason}` };
      bucket.models.push(failure.model);
      classes.set(key, bucket);
    }
  }
  if (classes.size === 0) {
    return;
  }
  const total = [...classes.values()].reduce((count, bucket) => count + bucket.models.length, 0);
  log(`⚠ ${total} models did not convert, in ${classes.size} failure class(es) — full list in report.json:`);
  for (const { models, title } of classes.values()) {
    const shown = models.slice(0, MAX_LISTED_FAILURES);
    const rest = models.length - shown.length;
    log(`  ⚠ ${title} (${models.length}): ${shown.join(', ')}${rest > 0 ? `, +${rest} more` : ''}`);
  }
}
