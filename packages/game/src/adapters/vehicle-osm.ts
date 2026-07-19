/**
 * `.osm` → everything a vehicle spawn needs (opensa-pack 003 phase 3) — the OPTIMIZED path.
 *
 * This is the inverse of opensa-pack's `packVehicleFixture`, and the point of the whole format: the work
 * the unoptimized path does at spawn (parse the DFF in a worker, walk the chunk tree for the embedded COL
 * on the main thread, decode a TXD, bucket it into an array) already happened offline. Here it is three
 * section reads and some `subarray` views — no RW parser is entered, and the texture payload stays
 * compressed all the way to `createVehicleModel`.
 *
 * The `DESC`/`GEOM` split is what makes that cheap: `COLL` is read without touching geometry, so the double
 * consumption of the DFF (worker for the model, main thread for collision) does not come back.
 */
import type { VehicleFixture } from '@opensa/renderware/vehicle/types';

import { decodeOsm, decodeOsmCollision, type OsmCollision, osmSection, OsmSectionTag } from '@opensa/engine-formats';

import type { ModelColliders } from '../interfaces/collider.interface';
import type { VehicleRigData } from './engine-vehicle-handle';
import type { RigidModelInit } from './vehicle-model-init';

/** Byte strides of the `GEOM` sections, matching what `packVehicleFixture` reserved. */
const STRIDE = { colors: 4, index: 2, meta: 4, normals: 12, positions: 12, reflect: 4, uvs: 8 };

/** What every converted rigid model carries: the engine-ready upload, its fixture, and collision if any. */
export interface OptimizedModel {
  /** Present only when the class bakes one (vehicles do; a clutter species does not). */
  collision?: OsmCollision;
  fixture: VehicleFixture;
  model: RigidModelInit;
}

export interface OptimizedVehicle {
  /** Null when the source DFF carried no collision — the same signal the unoptimized path gives. */
  colliders: ModelColliders | null;
  halfExtents: [number, number, number];
  model: RigidModelInit;
  /** The articulation the handle animates — the fixture IS this, so no conversion is needed. */
  rig: VehicleRigData;
  /** `ped_frontseat` dummy in vehicle space, or null. */
  seat: [number, number, number] | null;
  wheels: { connection: [number, number, number]; front: boolean; index: number; radius: number }[];
}

/**
 * Read any converted rigid model — geometry, dictionary and description in one container, engine-ready.
 *
 * `COLL` is NOT required — vehicles carry it, a clutter species does not. Every class the converter emits
 * shares `DESC`/`GEOM`/`TEXS`; the class-specific sections are read by their own callers.
 */
export function readModelOsm(name: string, osm: Uint8Array): OptimizedModel {
  const sections = decodeOsm(osm);
  const section = (tag: number, label: string): Uint8Array => {
    const bytes = osmSection(sections, tag);
    if (!bytes) {
      throw new Error(`${name}.osm is missing its ${label} section`);
    }

    return bytes;
  };
  const fixture = JSON.parse(new TextDecoder().decode(section(OsmSectionTag.DESC, 'DESC'))) as VehicleFixture;
  const geom = section(OsmSectionTag.GEOM, 'GEOM');
  const ostex = section(OsmSectionTag.TEXS, 'TEXS');
  const collisionBytes = osmSection(sections, OsmSectionTag.COLL);

  const at = (offset: number, length: number): Uint8Array => geom.subarray(offset, offset + length);
  const { layout, vertexCount } = fixture;

  return {
    ...(collisionBytes ? { collision: decodeOsmCollision(collisionBytes) } : {}),
    fixture,
    model: {
      colors: at(layout.colors, vertexCount * STRIDE.colors),
      indexCount: fixture.indexCount,
      indices: at(layout.indices, fixture.indexCount * STRIDE.index),
      meta: at(layout.meta, vertexCount * STRIDE.meta),
      normals: at(layout.normals, vertexCount * STRIDE.normals),
      parts: fixture.parts,
      positions: at(layout.positions, vertexCount * STRIDE.positions),
      reflect: at(layout.reflect, vertexCount * STRIDE.reflect),
      submeshes: fixture.submeshes,
      texture: { bytes: ostex, kind: 'ostex' },
      uvs: at(layout.uvs, vertexCount * STRIDE.uvs),
      vertexCount,
    },
  };
}

/** Read one converted vehicle. Throws when a required section is missing — a truncated `.osm` is a bug. */
export function readVehicleOsm(name: string, osm: Uint8Array): OptimizedVehicle {
  const read = readModelOsm(name, osm);
  const { collision, fixture } = read;
  if (!collision) {
    throw new Error(`${name}.osm is missing its COLL section`);
  }

  return {
    colliders: toColliders(name, collision),
    halfExtents: [...collision.halfExtents],
    model: read.model,
    rig: fixture,
    seat: seatOf(fixture),
    wheels: fixture.wheels.map((wheel, index) => ({
      connection: [...fixture.parts[wheel.part].localTranslation] as [number, number, number],
      front: wheel.front,
      index,
      radius: wheel.radius,
    })),
  };
}

function seatOf(fixture: VehicleFixture): [number, number, number] | null {
  const seat = fixture.dummies.find((dummy) => dummy.name === 'ped_frontseat');

  return seat ? [...seat.position] : null;
}

/**
 * The baked collision in engine shape. An EMPTY shape means the DFF had no COL and the writer baked the
 * fallback half-extents instead — the unoptimized path reports that as `colliders: null`, so this must too,
 * or a car with no collision would get a zero-triangle body instead of the adapter's fallback.
 */
function toColliders(name: string, collision: OsmCollision): ModelColliders | null {
  const empty = collision.vertices.length === 0 && collision.spheres.length === 0 && collision.boxes.length === 0;
  if (empty) {
    return null;
  }

  return {
    name,
    shape: {
      boxes: collision.boxes.map((box) => ({ max: [...box.max], min: [...box.min] })),
      indices: collision.indices,
      spheres: collision.spheres.map((sphere) => ({ center: [...sphere.center], radius: sphere.radius })),
      vertices: collision.vertices,
    },
    transforms: [],
  };
}
