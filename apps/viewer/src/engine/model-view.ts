import type { Engine, VehicleInstance, VehicleModelId } from '@opensa/engine';
import type { VehicleModelData } from '@opensa/renderware';

import { toRigidModelInit } from '@opensa/game/adapters/vehicle-model-init';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';

/**
 * One DFF + its TXDs → something on screen, with no pak, no cells and no streaming.
 *
 * This reuses the engine's RIGID path, which is renderer-level rather than vehicle-level: props, felled
 * trees, animated objects and cars all upload through `createVehicleModel`. A viewed map object is just
 * a model with no paint — the same observation `engine-props.ts` already relies on in the game host.
 *
 * Geometry stays in its native RenderWare (Z-up) frame; {@link ROOT} carries the basis change to the
 * engine's Y-up world, so nothing here has to rotate vertices.
 */

export interface ViewedModel {
  /** Axis-aligned bounds in ENGINE space, for framing the camera. */
  bounds: { center: [number, number, number]; radius: number };
  data: VehicleModelData;
  dispose(): void;
  instance: VehicleInstance;
  modelId: VehicleModelId;
  triangles: number;
}

/**
 * Column-major GTA (Z-up) → engine (Y-up): x stays, engine-y = gta-z, engine-z = -gta-y.
 * The same basis change `writeGtaRoot` applies in the game host, without the position/rotation terms.
 */
const ROOT = new Float32Array([1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]);

export function loadModel(engine: Engine, dff: ArrayBuffer, txds: readonly ArrayBuffer[]): ViewedModel {
  const data = buildVehicleModel(parseDff(dff), new VehicleTextures(txds));
  const modelId = engine.createVehicleModel(toRigidModelInit(data));
  const instance = engine.createVehicle(modelId);
  instance.entity.setRoot(ROOT);

  return {
    bounds: measure(data.positions),
    data,
    dispose() {
      engine.destroyVehicle(instance);
      engine.destroyVehicleModel(modelId);
    },
    instance,
    modelId,
    triangles: data.indices.length / 3,
  };
}

/** Bounds over the raw vertex array, in engine space (positions are native Z-up, so y/z swap). */
function measure(positions: Float32Array): ViewedModel['bounds'] {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 2];
    const z = -positions[i + 1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  if (minX > maxX) {
    return { center: [0, 0, 0], radius: 1 }; // empty geometry — don't hand the camera NaNs
  }

  return {
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    radius: Math.max(0.5, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2),
  };
}
