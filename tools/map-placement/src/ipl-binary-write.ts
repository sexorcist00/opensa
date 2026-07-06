/** One INST record for a binary ("bnry") IPL stream. Rotation uses the same (conjugated) quaternion
 *  convention as text IPL rows — real SA and the OpenSA parser treat both paths identically. */
export interface BinaryIplInstance {
  readonly id: number;
  readonly interior: number;
  /** Index into the area's companion TEXT IPL inst array (the LOD parent), or -1. */
  readonly lod: number;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
}

const HEADER_SIZE = 76;
const INST_SIZE = 40;
const FIELD_NUM_INST = 0x04;
const FIELD_NUM_CARS = 0x14;
const OFFSET_INST = 0x1c;
const OFFSET_CARS = 0x3c;

/**
 * Encode instances as a binary IPL stream (`<area>_streamN.ipl`, shipped inside an IMG).
 *
 * Mirror of the engine's `parseBinaryIpl`: 76-byte header — `"bnry"`, `numInst` @0x04, `instOffset` @0x1C,
 * `numCars` @0x14 (0) with `carsOffset` @0x3C pointing past the INST block (empty section at a valid offset);
 * all other counts stay 0. Then `numInst` × 40-byte records: pos (3×f32), rot quat (4×f32), id (u32),
 * interior (i32), lod (i32).
 */
export function encodeBinaryIpl(instances: readonly BinaryIplInstance[]): Uint8Array {
  const bytes = new Uint8Array(HEADER_SIZE + instances.length * INST_SIZE);
  const view = new DataView(bytes.buffer);
  bytes.set([0x62, 0x6e, 0x72, 0x79], 0); // 'bnry'
  view.setUint32(FIELD_NUM_INST, instances.length, true);
  view.setUint32(FIELD_NUM_CARS, 0, true);
  view.setUint32(OFFSET_INST, HEADER_SIZE, true);
  view.setUint32(OFFSET_CARS, HEADER_SIZE + instances.length * INST_SIZE, true);

  instances.forEach((inst, i) => {
    const at = HEADER_SIZE + i * INST_SIZE;
    view.setFloat32(at + 0, inst.position[0], true);
    view.setFloat32(at + 4, inst.position[1], true);
    view.setFloat32(at + 8, inst.position[2], true);
    view.setFloat32(at + 12, inst.rotation[0], true);
    view.setFloat32(at + 16, inst.rotation[1], true);
    view.setFloat32(at + 20, inst.rotation[2], true);
    view.setFloat32(at + 24, inst.rotation[3], true);
    view.setUint32(at + 28, inst.id, true);
    view.setInt32(at + 32, inst.interior, true);
    view.setInt32(at + 36, inst.lod, true);
  });

  return bytes;
}
