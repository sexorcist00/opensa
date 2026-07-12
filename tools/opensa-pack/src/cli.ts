/**
 * `opensa-pack` CLI (plan 074/03).
 *
 *   npx tsx tools/opensa-pack/src/cli.ts --game <dir> --out <dir> --rect x0,y0,x1,y1 [--cell-size 250] [--no-ao]
 *
 * `--rect` is inclusive GTA CELL coordinates (cell = floor(worldXY / cellSize)). Writes `world.ospak` +
 * `manifest.json` + `report.json` into `--out`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { convertDistrict } from './convert';
import { openGameDir } from './game-fs';

function arg(name: string): null | string {
  const index = process.argv.indexOf(`--${name}`);

  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
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

  const started = Date.now();
  console.log(`[opensa-pack] loading game dir ${game} …`);
  const fs = openGameDir(game);
  console.log(`[opensa-pack] converting rect ${rectRaw} (cellSize ${cellSize}, ao ${ao ? 'on' : 'off'}) …`);
  const { manifest, pak, report } = convertDistrict(fs, {
    ao,
    cellSize,
    rect: rect as unknown as readonly [number, number, number, number],
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
}

main();
