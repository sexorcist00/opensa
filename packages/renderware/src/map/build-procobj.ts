import type { Object3D } from 'three';

import { Matrix4 as EngineMatrix4 } from '@opensa/math';
import { InstancedMesh, Matrix4 } from 'three';

import type { ImgArchive } from '../archive';
import type { IdeObjectDef } from '../parsers/text';
import type { BuildRegionOptions } from './build-region';
import type { ProcObjBatch } from './procobj-scatter';

import { getClump, getTextures } from '../archive';
import { buildClumpParts } from '../three/build-clump';
import { registerProcObjMesh } from './procobj-runtime';
import { placementMatrix } from './procobj-scatter';

/** Options for {@link buildProcObjMeshes}: the shared mod hook + the per-cell render budget. */
export interface ProcObjBuildOptions extends BuildRegionOptions {
  /** Per-cell render-budget lottery threshold (see `procObjLotteryCap`) — caps the runtime
   *  density cutoff so the cell never draws more clutter than budgeted. Default: unlimited. */
  lotteryCap?: number;
}

/**
 * Turn one cell's scatter batches into renderable `InstancedMesh`es (plan 042, iteration 3c).
 * Models resolve through the regular IDE catalog (`defOf` — the clutter defs ship in the generic
 * IDEs); batches whose model has no def are skipped. Instances keep the batch's lottery order so
 * the runtime density cutoff works; each mesh registers with the procobj runtime and starts
 * INVISIBLE — the per-frame settings pass decides visibility/count (avoids a one-frame
 * full-density flash before the config applies).
 */
export function buildProcObjMeshes(
  archive: ImgArchive,
  batches: readonly ProcObjBatch[],
  defOf: (model: string) => IdeObjectDef | undefined,
  options: ProcObjBuildOptions = {},
): Object3D[] {
  const meshes: Object3D[] = [];
  const matrix = new Matrix4();
  const engineMatrix = new EngineMatrix4();

  for (const batch of batches) {
    const def = defOf(batch.model);
    if (!def || batch.placements.length === 0) {
      continue;
    }
    const parts = buildClumpParts(getClump(archive, def.modelName), getTextures(archive, def.txdName));
    const lotteries = new Float32Array(batch.placements.map((placement) => placement.lottery));
    for (const part of parts) {
      options.decoratePart?.(def, part); // mods compose here too (wind sways procedural bushes)
      const mesh = new InstancedMesh(part.geometry, part.material, batch.placements.length);
      mesh.castShadow = false;
      mesh.receiveShadow = false; // unlit world material — manual shadow sampling (plan 038)
      batch.placements.forEach((placement, index) => {
        // TEMPORARY bridge: placementMatrix now returns an @opensa/math Matrix4 while
        // InstancedMesh still wants three's. Dies with this file in plan 074/13 phase 5c.
        mesh.setMatrixAt(index, matrix.fromArray(placementMatrix(placement, engineMatrix).elements));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.visible = false; // the runtime settings pass enables it
      mesh.userData.procObj = { category: batch.category, model: batch.model };
      registerProcObjMesh(mesh, batch.category, lotteries, options.lotteryCap);
      meshes.push(mesh);
    }
  }

  return meshes;
}
