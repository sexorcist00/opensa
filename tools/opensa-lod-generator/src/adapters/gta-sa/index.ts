import type { ClumpEffect } from '@opensa/lod-common/clump-effects';

import { createBudgetedDecimate } from '@opensa/lod-common/budgeted-decimate';
import { createCoplanarRemesh } from '@opensa/lod-common/coplanar-remesh';
import { dropDegenerateFaces } from '@opensa/lod-common/drop-degenerate-faces';
import { createDropTransparentGroups } from '@opensa/lod-common/drop-transparent-groups';
import { applyModifiers, type LodContext, type LodModifier } from '@opensa/lod-common/hd-to-lod';
import { createModelSource } from '@opensa/lod-common/model-source';
import { rebuildMeshNormals } from '@opensa/lod-common/normals';
import { createTextureSource } from '@opensa/lod-common/texture-source';
import { lodView } from '@opensa/lod-common/view';
import { createVisibilityCull } from '@opensa/lod-common/visibility-cull';
import { build2dfxSection } from '@opensa/rw-codec/dff';
import { join } from 'node:path';

import type { LodAdapter } from '../../core/adapter';
import type { BakedCell, Cell, LodConfig } from '../../core/types';

import { cullTinyInstances } from './cull';
import { writeBuild } from './finalize';
import { openArchives } from './io';
import { collectCellLightEffects, mergeCell } from './merge';
import { maxObjectId, resolveCells } from './resolve';

export { stripOldLods } from './strip';

/**
 * GTA-SA (RenderWare) LOD adapter. Phase 0 (assemble HD instances → cell grid) + Phase 1's merge (HD geometry →
 * one cell-relative mesh by texture) are implemented via read-only reuse of the engine's parsers. QEM decimation,
 * the texture atlas (Phase 1.1 / 2) and the build emit (`finalize`, Phase 3) land next; until then `finalize`
 * throws so callers can't silently produce an empty build. Archives are opened once and shared.
 */
export function createGtaSaLodAdapter(game: string, gameDir: string, config: LodConfig): LodAdapter {
  const archives = openArchives(join(gameDir, 'models'));
  const source = createModelSource(archives);
  const textureSource = createTextureSource(archives);
  const exclude = new Set((config.excludeItems ?? []).map((name) => name.toLowerCase()));

  // Plan 003 Phases 1–3: the geometry is never deformed (QEM degraded the models); the chain removes what can't
  // be seen — degenerate faces, mostly-transparent texture groups, then every face no reachable camera sees
  // (buried/interior/ground-facing, with survivors oriented so only genuinely two-sided faces get doubled at
  // encode) — and finally re-triangulates flat clusters from their byte-exact boundary. The same shared chain
  // sa-lod-generator will run once its mesh path is lossless (plan 003, Phase 5).
  const view = lodView(config.hdDrawDistance);
  const modifiers: readonly LodModifier[] = [
    dropDegenerateFaces,
    createDropTransparentGroups(config.minOpaqueCoverage),
    // Decimation runs BEFORE the visibility pass — QEM's regroup drops per-face sidedness masks, so orientation
    // is assigned after; it also shrinks the raycast workload.
    ...(config.decimateBudget > 0 ? [createBudgetedDecimate({ pixelBudget: config.decimateBudget })] : []),
    ...(config.hiddenFaces !== 'off' ? [createVisibilityCull({ mode: config.hiddenFaces })] : []),
    ...(config.mergeCoplanar ? [createCoplanarRemesh()] : []),
  ];
  const ctx: LodContext = { textures: textureSource, view };

  // Per-model 2dfx light entries (memoized) — baked into each cell as its distant coronas (plan 003, Phase 5).
  const effectsCache = new Map<string, ClumpEffect[]>();
  const loadRaw = (model: string): null | Uint8Array => {
    const name = model.endsWith('.dff') ? model : `${model}.dff`;
    for (const archive of archives) {
      const bytes = archive.get(name);
      if (bytes) {
        return new Uint8Array(bytes);
      }
    }

    return null;
  };

  return {
    bakeCell(cell: Cell): BakedCell {
      // Merged real HD geometry + the chain above (invisible-only culls + budget-checked decimation). Normals are
      // re-derived after (most map geometry ships without normals). The source models' corona lights ride along
      // as a transplanted 2dfx section — the cell glows at night like the HD it replaces.
      const mesh = rebuildMeshNormals(applyModifiers(mergeCell(cell, config.cellSize, source), modifiers, ctx));
      const effects = build2dfxSection(collectCellLightEffects(cell, config.cellSize, loadRaw, source, effectsCache));

      return { cx: cell.cx, cy: cell.cy, mesh, ...(effects ? { effects } : {}) };
    },
    finalize(outDir: string, baked: readonly BakedCell[]): void {
      writeBuild({
        baked,
        cellSize: config.cellSize,
        drawDistance: config.lodDrawDistance,
        firstId: maxObjectId(gameDir) + 1,
        gameDir,
        lodTextureSize: config.lodTextureSize,
        outDir,
        textureSource,
      });
    },
    game,
    resolveCells(): Cell[] {
      // Screen-size cull (plan 003, Track 1): sub-`minLodPixels` instances never read at LOD range — drop them
      // before the merge so cells stop spending triangles on bins/poles/wires.
      const culled = cullTinyInstances(
        resolveCells(gameDir, archives, config.cellSize, exclude),
        source,
        view,
        config.minLodPixels,
      );
      console.log(
        `  culled ${culled.culledInstances} tiny instances (${culled.culledModels} models < ` +
          `${config.minLodPixels}px at ${config.hdDrawDistance}u)`,
      );

      return culled.cells;
    },
  };
}
