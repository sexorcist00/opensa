/**
 * `opensa-pack` CLI (plan 074/03).
 *
 *   npx tsx tools/opensa-pack/src/cli.ts --game <dir> --out <dir> --rect x0,y0,x1,y1
 *     [--cell-size 250] [--no-ao] [--bakes [--no-sunvis]] [--bake-workers N]
 *     [--chunk-cells 6] [--wind <dir>[,<dir>…]]
 *
 * (`--in <mods-src>` and its only consumer — the `clouds/` skybox dome stage — were REMOVED 2026-07-17
 * together with the engine's painted cloud panorama.)
 *
 * AO/skyVis is ON BY DEFAULT (2026-07-17 user decision — it replaces prod's SSAO, so a default pak must
 * carry it; `--no-ao` skips it for fast iteration reconverts). `--bakes` now gates only the HEAVY shadow
 * bake (sun-vis, 074/07): production, bench-ritual and pre-flip converts MUST pass it — without it the
 * direct sun renders unshadowed (bridges/canyons) by design.
 *
 * `--wind` — overlay dirs of wind-ADAPTED DFFs (prelit alpha = sway weights), e.g.
 * `--wind "mods-src/vegetation,mods-src/mods/21. Wind Project 1.0.2"`; they shadow the game's assets.
 *
 * `--rect` is inclusive GTA CELL coordinates (cell = floor(worldXY / cellSize)). Writes `world.ospak` +
 * `manifest.json` + `report.json` into `--out`.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { convertDistrict } from './convert';
import { openGameDir } from './game-fs';
import { WaterHeightGrid } from './height-grid';
import { bakeWater } from './water';

function arg(name: string): null | string {
  const index = process.argv.indexOf(`--${name}`);

  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function findFiles(dir: string, extension: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...findFiles(full, extension));
    } else if (entry.toLowerCase().endsWith(extension)) {
      found.push(full);
    }
  }

  return found;
}

async function main(): Promise<void> {
  const game = arg('game');
  const out = arg('out');
  const rectRaw = arg('rect');
  if (!game || !out || !rectRaw) {
    console.error('usage: opensa-pack --game <dir> --out <dir> --rect x0,y0,x1,y1 [--cell-size 250]');
    process.exitCode = 2;

    return;
  }
  const rect = rectRaw.split(',').map(Number);
  if (rect.length !== 4 || rect.some(Number.isNaN)) {
    throw new Error(`bad --rect '${rectRaw}' (want x0,y0,x1,y1 in cell coords)`);
  }
  const cellSize = Number(arg('cell-size') ?? 250) || 250;
  // AO is ON by default (it stands in for prod's SSAO — a default pak must carry it; `--no-ao` for fast
  // iteration reconverts). The heavy SHADOW bake (sun-vis) stays opt-in behind `--bakes`.
  const bakes = process.argv.includes('--bakes');
  const ao = !process.argv.includes('--no-ao');
  const sunVis = bakes && !process.argv.includes('--no-sunvis');
  const bakeWorkers = Number(arg('bake-workers') ?? 0) || undefined; // default: a quarter of the cores
  const chunkCells = Number(arg('chunk-cells') ?? 0) || undefined; // default: 6 (chunked welding, A2)
  const windDirs = (arg('wind') ?? '')
    .split(',')
    .map((dir) => dir.trim())
    .filter(Boolean);

  const started = Date.now();
  console.log(
    `[opensa-pack] loading game dir ${game}${windDirs.length > 0 ? ` + wind overlays ${windDirs.join(' | ')}` : ''} …`,
  );
  const fs = openGameDir(game, windDirs);
  console.log(
    `[opensa-pack] converting rect ${rectRaw} (cellSize ${cellSize}, ao ${ao ? 'on' : 'off'}, ` +
      `sunvis ${sunVis ? 'on' : 'off'}) …`,
  );
  // Overlay mods ship shared TXDs (vegetation.txd) the installed game wires via txdp — offline they become
  // planner fallbacks.
  const fallbackTxds = windDirs.flatMap((dir) =>
    findFiles(dir, '.txd').map((file) => basename(file, '.txd').toLowerCase()),
  );
  // Stochastic de-tiling list (074/12): the CURATED uniform-noise list is the ONLY default — the skygfx
  // texdb (data/skygfx-texdb.txt) scrambled structured textures in the field; opt back in via
  // `--stochastic <file>[,<file>…]`.
  const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
  const stochasticPaths = (arg('stochastic') ?? join(dataDir, 'stochastic.txt'))
    .split(',')
    .map((path) => path.trim())
    .filter(Boolean);
  const stochasticNames = new Set<string>();
  for (const path of stochasticPaths) {
    for (const name of parseStochasticList(readFileSync(path, 'utf8'))) {
      stochasticNames.add(name);
    }
  }
  const waterHeights = new WaterHeightGrid();
  const { manifest, pak, report } = await convertDistrict(fs, {
    ao,
    ...(bakeWorkers !== undefined ? { bakeWorkers } : {}),
    cellSize,
    ...(chunkCells !== undefined ? { chunkCells } : {}),
    fallbackTxds,
    log: (message) => console.log(`[opensa-pack] ${message}`),
    rect: rect as unknown as readonly [number, number, number, number],
    stochasticNames,
    sunVis,
    waterHeights,
  });

  mkdirSync(out, { recursive: true });
  // Water bake (074/06 row 12 v2, user directive — water WITHOUT the shadow bakes): shore-field
  // tessellation from water.dat, pure 2D geometry (no rays, no BVH), always on — it costs seconds.
  const waterText = fs.getText('data/water.dat');
  if (waterText !== null) {
    const water = bakeWater(waterText, (x, y) => waterHeights.heightAt(x, y));
    writeFileSync(join(out, 'water.bin'), water.bin);
    manifest.water = { ...water.manifest, file: 'water.bin' };
    console.log(
      `[opensa-pack] water: ${water.manifest.vertexCount} verts / ${water.manifest.indexCount / 3} tris ` +
        `(shore field baked, ${(water.bin.byteLength / 1048576).toFixed(1)} MB)`,
    );
  }
  writeFileSync(join(out, 'world.ospak'), pak);
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));

  printReport(report, started);
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
function printReport(report: Awaited<ReturnType<typeof convertDistrict>>['report'], started: number): void {
  const cellCount = report.cells.length;
  const groupHistogram = report.cells.map((cell) => cell.groups);
  const maxGroups = Math.max(0, ...groupHistogram);
  const avgGroups = groupHistogram.reduce((sum, value) => sum + value, 0) / Math.max(1, cellCount);
  console.log(
    `[opensa-pack] done in ${((Date.now() - started) / 1000).toFixed(1)}s: ${cellCount} cell entries, ` +
      `pak ${(report.pakBytes / (1024 * 1024)).toFixed(1)} MB, groups avg ${avgGroups.toFixed(1)} max ${maxGroups}, ` +
      `textures pass=${report.textures.opaquePass} processed=${report.textures.processed} ` +
      `colors=${report.textures.colors} dedup=${report.textures.dedup} arrays=${report.textures.arrays}, ` +
      `timed objects=${report.timedObjects}, animated(live)=${report.animatedObjects}, ` +
      `animated(static)=${report.animatedStatic}, particles=${report.particles}, ` +
      `breakables=${report.breakables}, uv-scroll=${report.uvAnimObjects}/${report.uvAnimations}, ` +
      `roadsigns=${report.roadsigns}, normals authored=${report.normals.authored} computed=${report.normals.computed}`,
  );
  const normalsTotal = report.normals.authored + report.normals.computed;
  if (normalsTotal > 0 && report.normals.computed / normalsTotal > 0.1) {
    // opensa-pack plan 001: computed normals = the runtime invents them (naive average, no crease model) —
    // the plan-17 polygon-patch lighting bugs. A map-optimizer build ships normals on every world model.
    console.warn(
      `[opensa-pack] ⚠ ${report.normals.computed} of ${normalsTotal} models have no authored normals — ` +
        `run the map through map-optimizer first (its plans 020-023) or expect polygon-patch lighting`,
    );
  }
  if (report.ao) {
    console.log(
      `[opensa-pack] ao bake: ${(report.ao.ms / 1000).toFixed(1)}s — ${report.ao.vertices} verts ` +
        `(${report.ao.uniqueVertices} unique), ${report.ao.rays} rays vs ${report.ao.triangles} tris`,
    );
  }
  if (report.sunVis) {
    console.log(
      `[opensa-pack] sunvis bake: ${(report.sunVis.ms / 1000).toFixed(1)}s — ${report.sunVis.vertices} verts ` +
        `(${report.sunVis.uniqueVertices} unique), ${report.sunVis.rays} rays`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
