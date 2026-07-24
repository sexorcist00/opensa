#!/usr/bin/env node
/**
 * `opensa-pack` CLI (plan 074/03) — argv on top of {@link packGameDir}, nothing else. The convert itself is
 * a library (plan 003 phase 6), because its real home is a stage inside perfect-map-builder and a pipeline
 * stage must not go through argv.
 *
 *   npx tsx tools/opensa-pack/src/cli.ts --game <dir> --out <dir> [--rect x0,y0,x1,y1]
 *     [--no-ao] [--no-models] [--bakes] [--bake-workers N] [--stochastic <file>[,<file>…]]
 *
 * REMOVED FLAGS (2026-07-19, user): `--cell-size` (the pak and the runtime must agree on it and nothing
 * checked that — it is the `CELL_SIZE` constant now), `--chunk-cells` (a welding tuning knob from the A2
 * speed work; the default stands), `--no-sunvis` (it said exactly what omitting `--bakes` says), and
 * `--wind` — whose wind-ADAPTED vegetation DFFs move into pmb config with the rest of the input data
 * (074/14). Until that lands, unadapted vegetation sways by height-above-base instead of authored
 * per-vertex weights. (`--in <mods-src>` went earlier, 2026-07-17, with the painted cloud panorama.)
 *
 * AO/skyVis is ON BY DEFAULT (2026-07-17 user decision — it replaces prod's SSAO, so a default pak must
 * carry it; `--no-ao` skips it for fast iteration reconverts). `--bakes` gates the HEAVY shadow bake
 * (sun-vis, 074/07): production, bench-ritual and pre-flip converts MUST pass it — without it the direct
 * sun renders unshadowed (bridges/canyons) by design.
 *
 * `--rect` is inclusive GTA CELL coordinates (cell = floor(worldXY / CELL_SIZE)). OPTIONAL since plan 087:
 * the default auto-fits every cell with content — a fixed rect silently dropped whatever a TC placed
 * outside it (gostown's far islands). Pass it only to convert a deliberate SUBSET (bench districts).
 *
 * OUTPUT (plan 003 phase 1 + 086 phase 8): `--out` is a COPY of `--game` — the chain convention, so every
 * stage hands the next a complete game tree, and the game dir is SELF-CONTAINED: the pak products
 * (`world.ospak`, `manifest.json`, `water.bin`, `report.json`) go to `<out>/pak` (override with
 * `--pak-out`). Point a host at the game dir (`?src=<out>`).
 */
import { argValue, fromCwd } from '@opensa/tool-kit/cli';
import { statSync } from 'node:fs';

import { packGameDir } from './pack';

function arg(name: string): null | string {
  return argValue(`--${name}`) ?? null;
}

async function main(): Promise<void> {
  const gameRaw = arg('game');
  const outRaw = arg('out');
  const rectRaw = arg('rect');
  if (!gameRaw || !outRaw) {
    console.error(
      'usage: opensa-pack --game <dir> --out <dir> [--rect x0,y0,x1,y1] ' +
        '[--pak-out <dir>] [--game-id <id>] [--no-ao] [--no-models] [--bakes] [--bake-workers N] ' +
        '[--stochastic <file>[,<file>…]]',
    );
    process.exitCode = 2;

    return;
  }
  const rect = rectRaw?.split(',').map(Number);
  if (rect !== undefined && (rect.length !== 4 || rect.some(Number.isNaN))) {
    throw new Error(`bad --rect '${rectRaw}' (want x0,y0,x1,y1 in cell coords)`);
  }
  const bakeWorkers = Number(arg('bake-workers') ?? 0) || undefined;
  const stochastic = (arg('stochastic') ?? '')
    .split(',')
    .map((path) => path.trim())
    .filter(Boolean)
    .map(fromCwd);

  const gameId = arg('game-id');
  const pakOut = arg('pak-out');
  await packGameDir({
    ao: !process.argv.includes('--no-ao'),
    ...(bakeWorkers !== undefined ? { bakeWorkers } : {}),
    bakes: process.argv.includes('--bakes'),
    gameDir: requireDir('game', gameRaw),
    ...(gameId ? { gameId } : {}),
    models: !process.argv.includes('--no-models'),
    outDir: fromCwd(outRaw),
    ...(pakOut ? { pakDir: fromCwd(pakOut) } : {}),
    ...(rect !== undefined ? { rect: rect as unknown as readonly [number, number, number, number] } : {}),
    ...(stochastic.length > 0 ? { stochasticFiles: stochastic } : {}),
  });
}

/** A `--flag` that must name an existing directory. */
function requireDir(flag: string, value: string): string {
  const path = fromCwd(value);
  if (statSync(path, { throwIfNoEntry: false })?.isDirectory() !== true) {
    throw new Error(`--${flag} '${value}' is not a directory`);
  }

  return path;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
