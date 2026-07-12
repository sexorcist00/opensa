/**
 * `opensa-pack` CLI (plan 074/03).
 *
 *   npx tsx tools/opensa-pack/src/cli.ts --game <dir> --out <dir> --rect x0,y0,x1,y1
 *     [--cell-size 250] [--no-ao] [--no-sunvis] [--wind <dir>[,<dir>…]]
 *
 * `--wind` — overlay dirs of wind-ADAPTED DFFs (prelit alpha = sway weights), e.g.
 * `--wind "mods-src/vegetation,mods-src/mods/21. Wind Project 1.0.2"`; they shadow the game's assets.
 *
 * `--rect` is inclusive GTA CELL coordinates (cell = floor(worldXY / cellSize)). Writes `world.ospak` +
 * `manifest.json` + `report.json` into `--out`.
 */
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { convertDistrict } from './convert';
import { openGameDir } from './game-fs';

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

function main(): void {
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
  const ao = !process.argv.includes('--no-ao');
  const sunVis = !process.argv.includes('--no-sunvis');
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
  const { manifest, pak, report } = convertDistrict(fs, {
    ao,
    cellSize,
    fallbackTxds,
    rect: rect as unknown as readonly [number, number, number, number],
    sunVis,
  });

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'world.ospak'), pak);
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));

  const cellCount = report.cells.length;
  const groupHistogram = report.cells.map((cell) => cell.groups);
  const maxGroups = Math.max(0, ...groupHistogram);
  const avgGroups = groupHistogram.reduce((sum, value) => sum + value, 0) / Math.max(1, cellCount);
  console.log(
    `[opensa-pack] done in ${((Date.now() - started) / 1000).toFixed(1)}s: ${cellCount} cell entries, ` +
      `pak ${(report.pakBytes / (1024 * 1024)).toFixed(1)} MB, groups avg ${avgGroups.toFixed(1)} max ${maxGroups}, ` +
      `textures pass=${report.textures.opaquePass} processed=${report.textures.processed} ` +
      `colors=${report.textures.colors} dedup=${report.textures.dedup} arrays=${report.textures.arrays}, ` +
      `skipped timed=${report.skippedTimed} animated=${report.skippedAnimated}`,
  );
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

main();
