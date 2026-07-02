import type { MergedMesh, Quat, Vec3 } from '@opensa/lod-common/mesh';
import type { ModelSource } from '@opensa/lod-common/model-source';

import { MeshBuilder, type VertexTransform } from '@opensa/lod-common/build-mesh';

import type { Cell } from '../../core/types';

/**
 * Merge a cell's instances into one cell-centre-relative, native Z-up mesh (Phase 1), triangles bucketed by
 * texture. Every instance's atomics are placed by their IPL transform — **rotation = the conjugate of the IPL
 * quaternion** (GTA stores its inverse; matches `build-region.ts`) — offset to the cell centre (small coords for
 * float precision; the cell-LOD inst places it back). The DFF **frame** transform is ignored, as the engine does
 * for map atomics (`build-clump.ts`). The shared {@link MeshBuilder} (`@opensa/lod-common`) accumulates the
 * geometry so opensa and lod-procobj build LOD meshes by the same rules.
 */
export function mergeCell(cell: Cell, cellSize: number, source: ModelSource): MergedMesh {
  const origin: Vec3 = [(cell.cx + 0.5) * cellSize, (cell.cy + 0.5) * cellSize, 0];
  const builder = new MeshBuilder();
  for (const instance of cell.instances) {
    const clump = source.load(instance.model);
    if (!clump) {
      continue;
    }
    const transform = instanceTransform(conjugate(instance.rotation), instance.position, origin);
    for (const atomic of clump.atomics) {
      const geometry = clump.geometries[atomic.geometryIndex];
      if (geometry) {
        builder.add(geometry, transform);
      }
    }
  }

  return builder.finish();
}

/** GTA IPL quaternions are the inverse of the standard convention — conjugate before use (cf. build-region). */
function conjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** The vertex map for one instance: rotate by `q`, then translate by `position`, offset to the cell `origin`. */
function instanceTransform(q: Quat, position: Vec3, origin: Vec3): VertexTransform {
  return {
    normal: (x, y, z) => rotate(q, x, y, z),
    point: (x, y, z): Vec3 => {
      const [rx, ry, rz] = rotate(q, x, y, z);

      return [rx + position[0] - origin[0], ry + position[1] - origin[1], rz + position[2] - origin[2]];
    },
  };
}

/** Rotate `(vx,vy,vz)` by quaternion `q` (x,y,z,w): `v + 2w(qv×v) + 2qv×(qv×v)`. */
function rotate(q: Quat, vx: number, vy: number, vz: number): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);

  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
