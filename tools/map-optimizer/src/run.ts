/**
 * Programmatic entry for the map-optimizer (used by the CLI and by `perfect-map-builder`). Composes the plugin
 * pipeline from a set of pass toggles — **all on by default** — and runs it, mirroring the whole game tree to
 * `outDir`. See `docs/plans/018-node-api.md`.
 */
import { basename } from 'node:path';

import type { LevelVerdict, NightVerdict, PrelitContextOptions } from './adapters/gta-sa/prelit-context';

export { type OnlyEntry, parseOnlyList, type PrelitContextOptions } from './adapters/gta-sa/prelit-context';
import type { RunReport } from './core';
import type { MapPlugin } from './core/asset';

import { createGtaSaAdapter } from './adapters/gta-sa';
import { runPipeline } from './core';
import { loadCreaseOverrides } from './crease-overrides';
import { config } from './optimizer.config';
import { createApplyPrelitLevel } from './plugins/apply-prelit-level';
import { createBakeVertexAo } from './plugins/bake-vertex-ao';
import { createConformNight } from './plugins/conform-night';
import { createRepairUvStretch, loadUvStretchModels, type RepairStats } from './plugins/repair-uv-stretch';
import { createSmoothNormals, emptySmoothNormalsStats } from './plugins/smooth-normals';
import { createWeldSeamPrelit } from './plugins/weld-seam-prelit';

/** Optional pipeline passes on top of the base model pipeline (weld/dedupe/prune/normals). */
export interface OptimizerPasses {
  /** Let `smooth-normals` CREATE normals on meshes that ship none. Default **true** (user decision: graphics
   *  mods — ENB/SkyGfx — want normals; the shard artifacts once blamed on this were actually the retired
   *  gap-stitch skirts). `--no-add-normals` if vanilla-renderer vertex lighting looks off. */
  addNormals: boolean;
  /** World-context prelight — day level + night repair/synthesis by neighbourhood (plan 019). */
  prelit: boolean;
  /** UV-stretch repair over the scanner's model list (plan 025). */
  repairUv: boolean;
  /** Texture mip pass before the model run (plan on `--textures`). */
  textures: boolean;
  /** Cross-model prelit seam weld (plan 016). */
  weldSeams: boolean;
}

/** Default passes. (`refine`/plan 014 and `stitchGaps`/plan 017 were retired — see their plans for why.) */
export const DEFAULT_PASSES: OptimizerPasses = {
  addNormals: true,
  prelit: true,
  repairUv: true,
  textures: true,
  weldSeams: true,
};

export interface RunOptimizerOptions {
  concurrency?: number;
  /** Per-model crease-angle overrides in degrees, lowercased names (plan 023A — the `--crease` list). */
  creaseOverrides?: ReadonlyMap<string, number>;
  /** Label for the adapter (default: `gameDir` basename). */
  game?: string;
  gameDir: string;
  outDir: string;
  /** Pass toggles; unset passes default to {@link DEFAULT_PASSES}. */
  passes?: Partial<OptimizerPasses>;
  /** Tuning for the prelit pass (tolerances, curated `exclude` list from the review report). */
  prelitOptions?: PrelitContextOptions;
}

/** Run the optimizer with the given passes; returns the run report. Mirrors the full game tree to `outDir`. */
export async function runOptimizer(options: RunOptimizerOptions): Promise<RunReport> {
  const passes = { ...DEFAULT_PASSES, ...options.passes };
  const adapter = createGtaSaAdapter(options.game ?? basename(options.gameDir), options.gameDir);

  if (passes.textures) {
    optimizeTextures(adapter);
  }

  const plugins = [...config.plugins];
  // Recreate smooth-normals with run-owned counters (plan 020) and, for OpenSA builds, normals creation
  // enabled (SSAO wants them, plan 015).
  const normalsStats = emptySmoothNormalsStats();
  // Default to the curated JSON (plan 024 phase 5): pmb never passed overrides, so per-model
  // crease curation was unreachable in real builds — the default belongs HERE, not in the CLI.
  const creaseOverrides = options.creaseOverrides ?? loadCreaseOverrides();
  plugins[plugins.findIndex((plugin) => plugin.name === 'smooth-normals')] = createSmoothNormals(
    {
      addWhereAbsent: passes.addNormals,
      ...(creaseOverrides ? { creaseFor: (model: string): number | undefined => creaseOverrides.get(model) } : {}),
    },
    normalsStats,
  );
  // Prelight order (plan 019): level FIRST (whole-model shifts), seam-weld AFTER (the seam line gets the final
  // word at shared borders), night LAST (the set derives from the final day). Level+night share one world
  // pre-pass (`buildPrelitContext`).
  if (passes.prelit) {
    const { stats, verdicts, warnings } = adapter.buildPrelitContext(options.prelitOptions);
    console.log(
      `  prelit — lift ${stats.liftDay}, lower ${stats.lowerDay}, flat ${stats.flat}, ` +
        `night repair ${stats.repairNight} / synth ${stats.synthesizeNight}, ok ${stats.ok}, ` +
        `no-context ${stats.noContext}, excluded ${stats.excluded}`,
    );
    for (const warning of warnings) {
      console.warn(`  prelit ⚠ ${warning}`);
    }
    const levels = new Map<string, LevelVerdict>();
    const nights = new Map<string, NightVerdict>();
    const flats = new Set<string>();
    for (const [model, verdict] of verdicts) {
      if (verdict.level) {
        levels.set(model, verdict.level);
      }
      if (verdict.night) {
        nights.set(model, verdict.night);
      }
      if (verdict.flat) {
        flats.add(model);
      }
    }
    plugins.push(createApplyPrelitLevel(levels));
    // AO replaces the flat fill AFTER levelling (median stays at the hood level) and BEFORE the seam weld
    // (the seam line/band keeps the final word at shared borders) — plan 019 Phase 4.
    plugins.push(createBakeVertexAo(flats));
    if (passes.weldSeams) {
      pushSeamWeld(plugins, adapter, levels);
    }
    plugins.push(createConformNight(nights));
  } else if (passes.weldSeams) {
    pushSeamWeld(plugins, adapter);
  }
  const uv = pushUvRepair(plugins, passes.repairUv);

  const report = await runPipeline(
    adapter,
    { ...config, concurrency: options.concurrency ?? config.concurrency, plugins },
    options.outDir,
  );
  console.log(
    `  normals — preserved ${normalsStats.preservedMeshes}, point-repaired ${normalsStats.repairedVertices} ` +
      `vert(s) in ${normalsStats.repairedMeshes} mesh(es), recomputed ${normalsStats.recomputedMeshes}, ` +
      `created ${normalsStats.createdMeshes} (plan 020)`,
  );
  if (uv.models.size > 0) {
    console.log(
      `  uv-stretch — repaired ${uv.stats.repaired} face(s) across ${uv.repaired.length} model(s) ` +
        `(+${uv.stats.split} split verts, ${uv.stats.refused} refused for want of a healthy neighbour)`,
    );
    report.uvStretch = {
      candidates: [...uv.models].sort(),
      refusedFaces: uv.stats.refused,
      repairedFaces: uv.stats.repaired,
      // The models actually CHANGED, which is the list a before/after comparison needs — a candidate whose
      // faces were all refused is not one of them.
      repairedModels: [...uv.repaired].sort(),
      splitVertices: uv.stats.split,
    };
  }

  return report;
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

function pushSeamWeld(
  plugins: (typeof config.plugins)[number][],
  adapter: ReturnType<typeof createGtaSaAdapter>,
  levelVerdicts?: ReadonlyMap<string, LevelVerdict>,
): void {
  // levelVerdicts put the weld + feather band in post-level space (plan 019 Phase 3) — the overrides are
  // absolute and applied after apply-prelit-level.
  const { overrides, stats } = adapter.buildSeamOverrides(levelVerdicts ? { levelVerdicts } : {});
  console.log(
    `  seams — welded ${stats.welded} group(s) over ${stats.modelsTouched} model(s), ` +
      `feathered ${stats.feathered} vertex(es), ${stats.skippedSpread} skipped (spread)`,
  );
  plugins.push(createWeldSeamPrelit(overrides));
}

/**
 * Append the UV-stretch repair (plan 025), LAST so it reads the geometry every other pass has finished with.
 * The model list gates WHERE it runs; the correction itself derives from each asset's own neighbours, so a
 * mod replacing one of these is judged on its own numbers rather than handed a stored patch.
 */
function pushUvRepair(
  plugins: MapPlugin[],
  enabled: boolean,
): { models: ReadonlySet<string>; repaired: string[]; stats: RepairStats } {
  const stats: RepairStats = { refused: 0, repaired: 0, split: 0 };
  const repaired: string[] = [];
  const models = enabled ? loadUvStretchModels() : new Set<string>();
  if (models.size > 0) {
    plugins.push(createRepairUvStretch(models, stats, { onModel: (name) => repaired.push(name) }));
  }

  return { models, repaired, stats };
}
