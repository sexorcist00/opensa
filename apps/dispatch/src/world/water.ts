/**
 * The sea. Los Santos is a coastal city, and a dispatch map without water reads as a hole in the world rather
 * than as a shoreline — an operator has to be able to tell "no data here" from "this is the ocean".
 *
 * The baked `water.bin` rides next to the pak (stride-20 vertices: x, y, z, depth, class). Ripple and foam
 * textures live in `models/particle.txd`, which this app does not ingest; the engine substitutes 1×1 stubs, so
 * the surface reads as the flat timecyc water tint — which is all a map needs it for.
 */
import type { Engine } from '@opensa/engine';

import { pakTraffic } from '@opensa/engine';

/** Floats per baked water vertex: position, shore depth, water class. */
const WATER_STRIDE_FLOATS = 5;

/** Install the baked sea. Returns the triangle count, or 0 when the pak carries no water. */
export async function installWater(
  engine: Engine,
  base: string,
  water: undefined | { file: string; indexCount: number; vertexCount: number },
): Promise<number> {
  if (!water) {
    return 0;
  }
  const response = await fetch(`${base}/${water.file}`);
  if (!response.ok) {
    return 0;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  // The one pak read that does NOT go through the IO worker: `water.bin` rides beside the pak as a loose
  // file, so it is recorded here or it is missing from the bytes column entirely.
  pakTraffic.record(water.file, bytes.byteLength);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vertexCount = view.getUint32(0, true);
  const indexCount = view.getUint32(4, true);
  const gta = new Float32Array(bytes.buffer, bytes.byteOffset + 8, vertexCount * WATER_STRIDE_FLOATS);
  const indices = new Uint32Array(bytes.buffer.slice(bytes.byteOffset + 8 + vertexCount * 20), 0, indexCount);
  engine.setWater(engineWaterVertices(gta), indices, null, null);

  return indices.length / 3;
}

/** GTA Z-up → engine Y-up; the shore field and the water class ride along untouched. */
function engineWaterVertices(gta: Float32Array): Float32Array {
  const vertices = new Float32Array(gta.length);
  for (let v = 0; v < gta.length; v += WATER_STRIDE_FLOATS) {
    vertices[v] = gta[v];
    vertices[v + 1] = gta[v + 2];
    vertices[v + 2] = -gta[v + 1];
    vertices[v + 3] = gta[v + 3];
    vertices[v + 4] = gta[v + 4];
  }

  return vertices;
}
