/**
 * Programmatic entry for opensa-lod-generator (used by the CLI and `perfect-map-builder`). Bakes every grid cell
 * into a decimated LOD and emits the drop-in build, optionally stripping the stock `lod*` layer. See
 * `docs/plans/003-node-api.md`. `finalize` mirrors the whole game tree to `outDir` (full passthrough).
 */
import { basename } from 'node:path';

import type { LodConfig } from './core/types';

import { createGtaSaLodAdapter, stripOldLods } from './adapters/gta-sa';
import { config as defaultConfig } from './lod.config';

export interface BuildOpensaLodsOptions {
  /** Grid cell size (shortcut for `config.cellSize`); must match the engine streaming grid. */
  cellSize?: number;
  /** Overrides on top of the default {@link LodConfig}. */
  config?: Partial<LodConfig>;
  gameDir: string;
  outDir: string;
  /** Strip the stock `lod*` building/terrain LODs (the cell-LODs replace them). Default false. */
  stripLods?: boolean;
}

export function buildOpensaLods(options: BuildOpensaLodsOptions): void {
  const config = { ...defaultConfig, ...options.config, ...(options.cellSize ? { cellSize: options.cellSize } : {}) };
  const adapter = createGtaSaLodAdapter(basename(options.gameDir), options.gameDir, config);
  const cells = adapter.resolveCells();
  // The per-cell merge + QEM decimate is CPU-heavy (minutes on a full map) — log progress so it doesn't look hung.
  console.log(`  opensa: baking ${cells.length} cells…`);
  const baked = cells.map((cell, i) => {
    const result = adapter.bakeCell(cell);
    if ((i + 1) % 25 === 0 || i + 1 === cells.length) {
      console.log(`  baked ${i + 1}/${cells.length} cells`);
    }

    return result;
  });
  adapter.finalize(options.outDir, baked);
  if (options.stripLods) {
    const exclude = new Set((config.excludeItems ?? []).map((name) => name.toLowerCase()));
    const { entries, instances } = stripOldLods(options.outDir, exclude);
    console.log(`  stripped old lod*: ${instances} instances, ${entries} gta3.img entries`);
  }
}
