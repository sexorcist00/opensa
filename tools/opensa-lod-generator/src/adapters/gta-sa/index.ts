import { applyModifiers, type LodModifier } from '@opensa/lod-common/hd-to-lod';
import { createModelSource } from '@opensa/lod-common/model-source';
import { rebuildMeshNormals } from '@opensa/lod-common/normals';
import { createTextureSource } from '@opensa/lod-common/texture-source';
import { join } from 'node:path';

import type { LodAdapter } from '../../core/adapter';
import type { BakedCell, Cell, LodConfig } from '../../core/types';

import { writeBuild } from './finalize';
import { openArchives } from './io';
import { mergeCell } from './merge';
import { maxObjectId, resolveCells } from './resolve';

export { stripOldLods } from './strip';

/**
 * The LOD geometry modifier chain — the shared `@opensa/lod-common` extension point, **empty today**: a cell LOD is
 * the merged real HD geometry verbatim (QEM decimation degraded the models and is gone). Future simplification goes
 * here — the same chain sa-lod-generator's clone runs through.
 */
const LOD_MODIFIERS: readonly LodModifier[] = [];

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

  return {
    bakeCell(cell: Cell): BakedCell {
      // Verbatim: the cell LOD is the cell's real HD geometry merged, with **no decimation** — QEM degraded the
      // models (holes/spikes). Any future simplification runs through the shared modifier chain (empty today, same
      // chain sa-lod uses). Normals are re-derived after (most map geometry ships without normals). The LOD win is
      // draw-calls + a downscaled cell atlas + draw distance, not polycount — fine for OpenSA (no per-model limits).
      const mesh = rebuildMeshNormals(applyModifiers(mergeCell(cell, config.cellSize, source), LOD_MODIFIERS));

      return { cx: cell.cx, cy: cell.cy, mesh };
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
      return resolveCells(gameDir, archives, config.cellSize, exclude);
    },
  };
}
