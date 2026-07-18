import type { CellCoord } from '../streaming/grid';
import type { ModelColliders } from './collider.interface';

/** Request for one streamed grid cell's HD (`lod=false`) or LOD (`lod=true`) meshes. */
export interface CellRequest {
  cx: number;
  cy: number;
  lod: boolean;
}

export interface RegionRequest {
  center: Vec3;
  geometry: 'lods' | 'map';
  radius: number;
}

export type Vec3 = [number, number, number];

/** Raw driving feel from `handling.cfg` (the gameplay layer scales these into its model). */
export interface VehicleHandling {
  /** Braking deceleration. */
  brakeDecel: number;
  /** Engine acceleration. */
  engineAccel: number;
  /** Mass (kg) — heavier = less agile. */
  mass: number;
  /** Top speed (GTA units). */
  maxVelocity: number;
  /** Steering lock, degrees. */
  steeringLock: number;
}

/** One raycast wheel for the physics vehicle: hub position in vehicle space, radius, axle. */
export interface VehicleWheelPlacement {
  /** Wheel hub position in vehicle space `[x, y, z]`. */
  connection: [number, number, number];
  /** Front wheels steer; all wheels are powered/braked per the drive type. */
  front: boolean;
  /** Rolling radius (world units). */
  radius: number;
}

/**
 * The seam between the generic `game` engine and a concrete world implementation
 * (GTA SA / renderware). Implemented only under `game/adapters/**`; returns plain
 * three.js objects so the engine never names a `.dff`/`.txd`/IPL.
 */
export interface WorldAdapter {
  /** Edge length of a streaming grid cell, in world units. */
  readonly cellSize: number;
  /** Every grid cell that holds content (for the debug section inspector). */
  listCells(): CellCoord[];
  /** Build one grid cell's collision (its HD instances), for streaming the physics colliders. */
  loadCellColliders(cx: number, cy: number): Promise<ModelColliders[]>;
  /**
   * Load a painted, wheeled vehicle by model name (native Z-up; place under the streaming root).
   * `colour` overrides the paint with carcols palette indices (e.g. `'34,34'` or `'1,31,1,0'`); the
   * first two indices become the primary/secondary paint. Omit to use the car's default carcol combo.
  /** Download/parse everything needed; reports progress 0..1. */
  prepare(onProgress?: (fraction: number) => void): Promise<void>;
}

/** What a picked instance is (debug click-inspect). */
export interface WorldObjectInfo {
  /** Render diagnostics: the material's shader-variant cache key + whether the geometry carries the
   *  `nightColor` attribute — tells which day/night path the instance actually takes at runtime. */
  material?: string;
  modelName: string;
  position: Vec3;
  txdName: string;
}
