import type { VehicleModelData } from '@opensa/renderware';

/**
 * The engine's rigid-model upload shape. Structural on purpose: `packages/game` must not import
 * `@opensa/engine` types just to describe an argument, and the engine must not learn RenderWare types.
 */
export interface RigidModelInit {
  colors: Uint8Array;
  /** False when `indices` is uint32 — a model past 65 536 vertices. Absent = the historical uint16. */
  index16?: boolean;
  indexCount: number;
  indices: Uint8Array;
  meta: Uint8Array;
  /** NIGHT vertex colours (same layout as `colors`) — SA's extra-vertex-colour set, or a synthesized one. */
  night: Uint8Array;
  normals: Uint8Array;
  parts: VehicleModelData['parts'];
  positions: Uint8Array;
  reflect: Uint8Array;
  submeshes: VehicleModelData['submeshes'];
  /** One per texture ARRAY; a submesh's `array` indexes it. Runtime-built models always carry exactly one. */
  textures: readonly RigidTextureInit[];
  uvs: Uint8Array;
  vertexCount: number;
}

/** Mirrors the engine's `ModelTextureInit` — our optimized `.ostex`, or RGBA8 layers from a runtime parse. */
export type RigidTextureInit =
  | { bytes: Uint8Array; kind: 'ostex' }
  | { height: number; kind: 'rgba'; layers: number; rgba: Uint8Array; width: number };

const bytes = (values: Float32Array): Uint8Array => new Uint8Array(values.buffer, values.byteOffset, values.byteLength);

/**
 * `buildVehicleModel` output → `engine.createVehicleModel` input.
 *
 * The rigid path is RENDERER-level, not vehicle-level: a prop, a felled tree, an animated object and a
 * car all upload through it — a prop is just a model with no paint and no lamps. Hence this lives here
 * rather than in any one host.
 */
export function toRigidModelInit(model: VehicleModelData): RigidModelInit {
  return {
    colors: model.colors,
    // The builder narrows the index array to the model; carry the width instead of assuming it, or a
    // hi-poly car binds uint32 data as uint16 and draws a scrambled mesh.
    index16: model.indices.BYTES_PER_ELEMENT === 2,
    indexCount: model.indices.length,
    indices: new Uint8Array(model.indices.buffer, model.indices.byteOffset, model.indices.byteLength),
    meta: model.meta,
    night: model.night,
    normals: bytes(model.normals),
    parts: model.parts,
    positions: bytes(model.positions),
    reflect: model.reflect,
    submeshes: model.submeshes,
    textures: [
      {
        height: model.texture.height,
        kind: 'rgba',
        layers: model.texture.layers,
        rgba: model.texture.rgba,
        width: model.texture.width,
      },
    ],
    uvs: bytes(model.uvs),
    vertexCount: model.positions.length / 3,
  };
}
