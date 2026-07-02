/**
 * Programmatic entry for the map-optimizer (used by the CLI and by `perfect-map-builder`). Composes the plugin
 * pipeline from a set of pass toggles — **all on by default** — and runs it, mirroring the whole game tree to
 * `outDir`. See `docs/plans/018-node-api.md`.
 */
import { basename } from 'node:path';

import type { RunReport } from './core';

import { createGtaSaAdapter } from './adapters/gta-sa';
import { runPipeline } from './core';
import { config } from './optimizer.config';
import { createRefineSurface } from './plugins/refine-surface';
import { createSkirtBoundary } from './plugins/skirt-boundary';
import { createStitchGapPosition } from './plugins/stitch-gap-position';
import { createStitchGapSplit } from './plugins/stitch-gap-split';
import { createWeldSeamPrelit } from './plugins/weld-seam-prelit';

/** Optional pipeline passes on top of the base model pipeline (weld/dedupe/prune/normals/prelit/night). */
export interface OptimizerPasses {
  /** Experimental surface-smoothing final stage (plan 014). */
  refine: boolean;
  /** Cross-model geometry gap stitch — split → move → skirt (plan 017). */
  stitchGaps: boolean;
  /** Texture mip pass before the model run (plan on `--textures`). */
  textures: boolean;
  /** Cross-model prelit seam weld (plan 016). */
  weldSeams: boolean;
}

/** Default passes: everything **except** the experimental `refine` (opt in with `--refine`). */
export const DEFAULT_PASSES: OptimizerPasses = { refine: false, stitchGaps: true, textures: true, weldSeams: true };

export interface RunOptimizerOptions {
  concurrency?: number;
  /** Label for the adapter (default: `gameDir` basename). */
  game?: string;
  gameDir: string;
  outDir: string;
  /** Pass toggles; unset passes default to {@link DEFAULT_PASSES}. */
  passes?: Partial<OptimizerPasses>;
}

/** Run the optimizer with the given passes; returns the run report. Mirrors the full game tree to `outDir`. */
export async function runOptimizer(options: RunOptimizerOptions): Promise<RunReport> {
  const passes = { ...DEFAULT_PASSES, ...options.passes };
  const adapter = createGtaSaAdapter(options.game ?? basename(options.gameDir), options.gameDir);

  if (passes.textures) {
    optimizeTextures(adapter);
  }

  const plugins = [...config.plugins];
  // Gap-stitch applies FIRST (split → move → skirt, unshift reverses) so later passes see stitched geometry.
  if (passes.stitchGaps) {
    const { moves, skirts, splits, stats } = adapter.buildGapStitches();
    console.log(
      `  gaps — stitched ${stats.stitched} pair(s), ${stats.tjunctions} T-junction(s), ${stats.skirted} skirt(s) over ${stats.modelsTouched} model(s)`,
    );
    plugins.unshift(createSkirtBoundary(skirts));
    plugins.unshift(createStitchGapPosition(moves));
    plugins.unshift(createStitchGapSplit(splits));
  }
  // Seam-weld applies after smooth-normals, before synthesize-night (so night inherits it).
  if (passes.weldSeams) {
    const { overrides, stats } = adapter.buildSeamOverrides();
    console.log(
      `  seams — welded ${stats.welded} group(s) over ${stats.modelsTouched} model(s), ${stats.skippedSpread} skipped (spread)`,
    );
    const before = plugins.findIndex((plugin) => plugin.name === 'synthesize-night');
    plugins.splice(before >= 0 ? before : plugins.length, 0, createWeldSeamPrelit(overrides));
  }
  if (passes.refine) {
    plugins.push(createRefineSurface());
  }

  return runPipeline(
    adapter,
    { ...config, concurrency: options.concurrency ?? config.concurrency, plugins },
    options.outDir,
  );
}

function optimizeTextures(adapter: ReturnType<typeof createGtaSaAdapter>): void {
  let processed = 0;
  let mipped = 0;
  let failed = 0;
  let missing = 0;
  for (const name of adapter.resolveTextures()) {
    const result = adapter.optimizeTexture(name);
    if (!result) {
      missing += 1;
    } else if (result.failed) {
      failed += 1; // unparseable TXD — skipped, run continues
    } else {
      processed += 1;
      mipped += result.mipped;
    }
  }
  console.log(
    `  textures — ${processed} TXD processed, ${mipped} textures mipped, ${failed} failed, ${missing} not found`,
  );
}
