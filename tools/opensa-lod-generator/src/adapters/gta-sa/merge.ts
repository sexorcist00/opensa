import type { ClumpEffect } from '@opensa/lod-common/clump-effects';
import type { MergedMesh, Quat, Vec3 } from '@opensa/lod-common/mesh';
import type { ModelSource } from '@opensa/lod-common/model-source';

import { MeshBuilder, type VertexTransform } from '@opensa/lod-common/build-mesh';
import { collectClumpEffects } from '@opensa/lod-common/clump-effects';
import { registerScopedName, type ScopedRegistry } from '@opensa/lod-common/scoped-texture';
import { transform2dfxEntry } from '@opensa/lod-common/two-dfx-transform';

import type { Cell } from '../../core/types';

/** 2dfx entry type 0 — light/corona. Cells carry only these (rotation-bearing types can't ride a raw transplant). */
const LIGHT_2DFX = new Set([0]);

/**
 * Gather the cell's 2dfx **light** entries (street lamps, casino lights) in cell-centre-relative space — the
 * same instance transform {@link mergeCell} applies to vertices, so the baked cell's coronas glow exactly where
 * the source models' did (plan 003, Phase 5: distant night city lights). Raw entry bytes stay verbatim
 * (`collectClumpEffects`); only positions are rewritten. Per-model entries are memoized via `cache`.
 */
export function collectCellLightEffects(
  cell: Cell,
  cellSize: number,
  loadRaw: (model: string) => null | Uint8Array,
  source: ModelSource,
  cache: Map<string, ClumpEffect[]>,
): { bytes: Uint8Array; position: Vec3 }[] {
  const origin: Vec3 = [(cell.cx + 0.5) * cellSize, (cell.cy + 0.5) * cellSize, 0];
  const out: { bytes: Uint8Array; position: Vec3 }[] = [];
  for (const instance of cell.instances) {
    let effects = cache.get(instance.model);
    if (!effects) {
      const clump = source.load(instance.model);
      const raw = clump ? loadRaw(instance.model) : null;
      effects = clump && raw ? collectClumpEffects(raw, clump, LIGHT_2DFX) : [];
      cache.set(instance.model, effects);
    }
    if (effects.length === 0) {
      continue;
    }
    const transform = instanceTransform(conjugate(instance.rotation), instance.position, origin);
    for (const effect of effects) {
      out.push(transform2dfxEntry(effect, transform));
    }
  }

  return out;
}

/**
 * Merge a cell's instances into one cell-centre-relative, native Z-up mesh (Phase 1), triangles bucketed by
 * texture. Every instance's atomics are placed by their IPL transform — **rotation = the conjugate of the IPL
 * quaternion** (GTA stores its inverse; matches `build-region.ts`) — offset to the cell centre (small coords for
 * float precision; the cell-LOD inst places it back). The DFF **frame** transform is ignored, as the engine does
 * for map atomics (`build-clump.ts`). The shared {@link MeshBuilder} (`@opensa/lod-common`) accumulates the
 * geometry so opensa and lod-procobj build LOD meshes by the same rules.
 */
export function mergeCell(cell: Cell, cellSize: number, source: ModelSource, registry?: ScopedRegistry): MergedMesh {
  const origin: Vec3 = [(cell.cx + 0.5) * cellSize, (cell.cy + 0.5) * cellSize, 0];
  const builder = new MeshBuilder();
  for (const instance of cell.instances) {
    const clump = source.load(instance.model);
    if (!clump) {
      continue;
    }
    // Scoped texture names (lod-common plan 004): bucket triangles by the (def txd, name) pair, not the bare
    // name — SA reuses names across TXDs with different pixels, and the bare-name bucket would merge two
    // models' different variants into one group (and the shared LOD TXD would then pick a random one).
    const textureName =
      registry === undefined ? undefined : (raw: string): string => registerScopedName(registry, instance.txd, raw);
    const transform = instanceTransform(conjugate(instance.rotation), instance.position, origin);
    for (const atomic of clump.atomics) {
      const geometry = clump.geometries[atomic.geometryIndex];
      if (geometry) {
        builder.add(geometry, transform, textureName);
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
