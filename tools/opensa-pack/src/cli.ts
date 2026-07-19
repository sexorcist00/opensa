#!/usr/bin/env node
/**
 * `opensa-pack` CLI (plan 074/03) — argv on top of {@link packGameDir}, nothing else. The convert itself is
 * a library (plan 003 phase 6), because its real home is a stage inside perfect-map-builder and a pipeline
 * stage must not go through argv.
 *
 *   npx tsx tools/opensa-pack/src/cli.ts --game <dir> --out <dir> --rect x0,y0,x1,y1
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
 * `--rect` is inclusive GTA CELL coordinates (cell = floor(worldXY / CELL_SIZE)).
 *
 * OUTPUT (plan 003 phase 1): `--out` is a COPY of `--game` — the chain convention, so every stage hands the
 * next a complete game tree. Our own products go under `<out>/opensa/` (`world.ospak`, `manifest.json`,
 * `water.bin`, `report.json`); the game's own files are passed through untouched. Point a host at the
 * products with `?src=<out>/opensa`.
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
  if (!gameRaw || !outRaw || !rectRaw) {
    console.error(
      'usage: opensa-pack --game <dir> --out <dir> --rect x0,y0,x1,y1 ' +
        '[--no-ao] [--no-models] [--bakes] [--bake-workers N] [--stochastic <file>[,<file>…]]',
    );
    process.exitCode = 2;

    return;
  }
  const rect = rectRaw.split(',').map(Number);
  if (rect.length !== 4 || rect.some(Number.isNaN)) {
    throw new Error(`bad --rect '${rectRaw}' (want x0,y0,x1,y1 in cell coords)`);
  }
  const bakeWorkers = Number(arg('bake-workers') ?? 0) || undefined;
  const stochastic = (arg('stochastic') ?? '')
    .split(',')
    .map((path) => path.trim())
    .filter(Boolean)
    .map(fromCwd);

  await packGameDir({
    ao: !process.argv.includes('--no-ao'),
    ...(bakeWorkers !== undefined ? { bakeWorkers } : {}),
    bakes: process.argv.includes('--bakes'),
    gameDir: requireDir('game', gameRaw),
    models: !process.argv.includes('--no-models'),
    outDir: fromCwd(outRaw),
    rect: rect as unknown as readonly [number, number, number, number],
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
