/**
 * A cell's collision, baked (plan 097/3-01).
 *
 * Converts what `buildCellColliders` already produces into the `.oscol` container, so the parse the browser
 * pays 9.6–78.3 ms per cell for happens here instead, once.
 *
 * **The grid is the trap.** Collision streams on the GAME grid (`GAME_CELL_SIZE`, 256) while the pak's render
 * cells are 250 (`CELL_SIZE`) — two different tessellations of the same world. A bake keyed on the render
 * grid lands every collider in the wrong slot, and nothing catches it: the world renders, the player falls
 * through it in some places and stands on nothing in others. So the cell coordinates here are the CALLER's,
 * and the caller is responsible for having asked `buildCellColliders` on the same grid it writes the key
 * with. See `docs/restrictions/architecture.md`.
 */
import type { OscolRegion } from '@opensa/engine-formats';
import type { RegionColliders } from '@opensa/renderware';

/** Every region of one cell. An empty cell is a legitimate result and still gets an entry: "nothing here"
 *  and "not baked yet" must not look the same to the runtime. */
export function bakeCellCollision(regions: readonly RegionColliders[]): { regions: OscolRegion[] } {
  return { regions: regions.map(bakeRegion) };
}

/**
 * One region per model, exactly as the runtime's `toModelColliders` builds it — same index order, same
 * per-TRIANGLE surface byte, same conjugated world transforms. The bake may not reinterpret the data; it
 * only moves when it is read.
 */
export function bakeRegion(region: RegionColliders): OscolRegion {
  const { col, name, transforms } = region;
  const indices = new Uint32Array(col.faces.length * 3);
  // One surface byte per TRIANGLE, in the same order as the indices — what lets a wheel ask what it is
  // standing on (plan 081/10). Losing it is a DATA regression, not a performance one.
  const materials = new Uint8Array(col.faces.length);
  col.faces.forEach((face, index) => {
    indices[index * 3] = face.a;
    indices[index * 3 + 1] = face.b;
    indices[index * 3 + 2] = face.c;
    materials[index] = face.material;
  });

  return {
    boxes: col.boxes.map((box) => ({
      material: box.surface.material,
      max: [...box.max],
      min: [...box.min],
    })),
    indices,
    materials,
    name,
    spheres: col.spheres.map((sphere) => ({
      center: [...sphere.center],
      material: sphere.surface.material,
      radius: sphere.radius,
    })),
    // `Matrix4.elements` is column-major, which is what `.oscol` stores and what the physics layer already
    // consumes — copied rather than referenced, since the matrices belong to the builder's scratch.
    transforms: transforms.map((matrix) => Float32Array.from(matrix.elements)),
    vertices: col.vertices,
  };
}
