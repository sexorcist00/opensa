import type { VehicleModelData } from '@opensa/renderware';

/**
 * The engine's rigid-model upload shape. Structural on purpose: `packages/game` must not import
 * `@opensa/engine` types just to describe an argument, and the engine must not learn RenderWare types.
 */
export interface RigidModelInit {
  colors: Uint8Array;
  indexCount: number;
  indices: Uint8Array;
  meta: Uint8Array;
  normals: Uint8Array;
  parts: VehicleModelData['parts'];
  positions: Uint8Array;
  reflect: Uint8Array;
  submeshes: VehicleModelData['submeshes'];
  texture: { height: number; layers: number; rgba: Uint8Array; width: number };
  uvs: Uint8Array;
  vertexCount: number;
}

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
    indexCount: model.indices.length,
    indices: new Uint8Array(model.indices.buffer, model.indices.byteOffset, model.indices.byteLength),
    meta: model.meta,
    normals: bytes(model.normals),
    parts: model.parts,
    positions: bytes(model.positions),
    reflect: model.reflect,
    submeshes: model.submeshes,
    texture: {
      height: model.texture.height,
      layers: model.texture.layers,
      rgba: model.texture.rgba,
      width: model.texture.width,
    },
    uvs: bytes(model.uvs),
    vertexCount: model.positions.length / 3,
  };
}
