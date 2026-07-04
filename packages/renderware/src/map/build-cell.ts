import type { Object3D } from 'three';
import type { InstancedMesh } from 'three';

import type { ImgArchive } from '../archive';
import type { MapDefinitions } from '../parsers/text';
import type { GridCell, WorldGrid } from './world-grid';

import { getClump, getTextures } from '../archive';
import { buildParticleEmitters } from '../three/build-particles';
import { buildCoronaPoints } from '../three/corona';
import {
  addToGroup,
  buildAnimatedObjects,
  buildEscalatorMeshes,
  buildGroupInstancedMeshes,
  type BuildRegionOptions,
  buildRoadsignMeshes,
  collectBreakables,
  collectCoronas,
  collectParticleEmitters,
  type RegionMeshData,
} from './build-region';
import { cellKey } from './world-grid';

/**
 * Build the renderable objects for one grid cell — its HD (`lod=false`) or LOD
 * (`lod=true`) instanced meshes (grouped by model, with `userData.region` for
 * picking), plus, for HD cells, a single `Points` glow cloud for any 2d-effect
 * coronas (street-lamp lights). Empty array if the cell isn't in the grid. The
 * streaming layer calls this per cell and caches the result.
 */
export function buildCell(
  archive: ImgArchive,
  defs: MapDefinitions,
  grid: WorldGrid,
  cx: number,
  cy: number,
  lod: boolean,
  options: BuildRegionOptions = {},
): Object3D[] {
  const objects: Object3D[] = [];
  for (const chunk of buildCellSteps(archive, defs, grid, cx, cy, lod, options)) {
    objects.push(...chunk);
  }

  return objects;
}

/**
 * The cell build as a sequence of small steps (plan 060 Phase 3): one chunk per model group, then the tail
 * passes (breakables, anim objects, road signs, particles, escalators, coronas) as one chunk each. The
 * streaming adapter drives this cooperatively — parsing a heavy cell (100–250 ms of DFF/TXD/geometry work)
 * yields between steps instead of freezing the frame. {@link buildCell} is the collect-everything wrapper.
 */
export function* buildCellSteps(
  archive: ImgArchive,
  defs: MapDefinitions,
  grid: WorldGrid,
  cx: number,
  cy: number,
  lod: boolean,
  options: BuildRegionOptions = {},
): Generator<Object3D[]> {
  const cell = grid.get(cellKey(cx, cy));
  if (!cell) {
    return;
  }
  const groups = [...cellGroups(defs, cell, lod).values()];
  const instancedMeshes: InstancedMesh[] = [];
  for (const group of groups) {
    // Warm the parse caches as their own steps (plan 060 round 6): a big group's TXD parse (DXT decode)
    // and DFF parse each rival the whole build — folded into one step they made 65–79 ms slices no
    // deadline could see. Cache hits make these yields free.
    getTextures(archive, group.def.txdName);
    yield [];
    getClump(archive, group.def.modelName);
    yield [];
    const meshes = buildGroupInstancedMeshes(archive, group, options);
    instancedMeshes.push(...meshes);
    yield meshes;
  }
  // Breakable props (plan 045): register the cell's smashable instances (HD only — props are
  // near-field and have no LOD collision/break). Registration is keyed by placement, so the cached
  // cell rebuild replaces stale entries rather than duplicating them.
  if (!lod) {
    collectBreakables(archive, instancedMeshes, options.breakableModels);
    yield [];
  }
  // IDE anim objects (plan 041): per-instance frame hierarchies with a looping IFP clip —
  // animation mutates node transforms, so they can't ride the InstancedMesh path above.
  yield buildAnimatedObjects(archive, groups);
  // Road-sign text (plan 042 item 5): world-space glyph quads, HD cells only (near-field text).
  if (!lod) {
    yield buildRoadsignMeshes(archive, groups);
    // 2dfx particle emitters (plan 044): fires, fountains, smoke — near-field, HD cells only.
    yield buildParticleEmitters(collectParticleEmitters(archive, groups));
    // 2dfx escalators (plan 044): moving step rows instanced from the vanilla esc_step model.
    yield buildEscalatorMeshes(archive, defs, groups);
  }
  // Coronas on BOTH layers: HD models carry their own 2dfx lights, and the baked cell-LODs now transplant the
  // source models' light entries (plan 003, Phase 5) — the distant night city glows. Stock lod* models carry no
  // lights, so this is a no-op for them; HD/LOD cells are mutually exclusive, so nothing double-glows. The ground
  // glow under lamps is the road's baked night vertex colours, not a projected pool.
  const coronas = buildCoronaPoints(collectCoronas(archive, groups));
  if (coronas) {
    yield [coronas];
  }
}

/** Group one cell's HD (`lod=false`) or LOD (`lod=true`) instances by model+txd. */
export function cellGroups(defs: MapDefinitions, cell: GridCell, lod: boolean): Map<string, RegionMeshData> {
  const groups = new Map<string, RegionMeshData>();
  for (const instance of lod ? cell.lod : cell.hd) {
    const def = defs.catalog.get(instance.id) ?? defs.timedCatalog?.get(instance.id);
    if (def) {
      addToGroup(groups, def, instance);
    }
  }

  return groups;
}
