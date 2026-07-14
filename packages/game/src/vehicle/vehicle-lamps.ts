/**
 * Vehicle lamps — the renderer-agnostic half (plan 074/08 B5 step 5).
 *
 * The three headlight system used to own all of this: deciding WHICH car is lit, where its lamps sit, and
 * how a brake light differs from a running one — tangled together with sprites, materials and uniform
 * arrays. The decision and the geometry are pure; only the drawing is renderer-specific. This module is the
 * pure part, shared by both renderers.
 */
import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { EnterableVehicle } from './enter-vehicle.system';
import type { VehicleQuat } from './vehicle-handle';

/** One lamp of a lit car, in WORLD space (native Z-up) — what a light pool or a corona needs. */
export interface VehicleLamp {
  /** Unit direction the lamp faces (a corona fades out when seen from behind it). */
  facing: [number, number, number];
  kind: 'head' | 'tail';
  position: Vec3;
}

/** What the lamps of ONE car are doing. Both renderers consume exactly this. */
export interface VehicleLampState {
  /** Brake lights: the tail lamps go from their dim running level to full. */
  brakes: boolean;
  /** Headlights on (SA swaps the lamp texture to its lit twin, and the glass glows). */
  headlights: boolean;
  /** Config glow multiplier (`graphics.headlights.intensity`) — both renderers scale their glow by it. */
  intensity: number;
}

/** Fallback lamp anchors as fractions of the half-extents — for models with no head/tail dummies. */
const FALLBACK_X = 0.7;
const FALLBACK_Y = 0.9;
const FALLBACK_Z = -0.3;

/**
 * A car's head/tail lamp anchors in VEHICLE space. SA authors one dummy per end; models without them fall
 * back to a fraction of the half-extents. Both renderers mirror each anchor to ±X for the left/right lamp.
 */
export function lampAnchorsOf(vehicle: EnterableVehicle): { front: Vec3; rear: Vec3 } {
  const [hx, hy, hz] = vehicle.halfExtents;

  return {
    front: vehicle.handle.lampAnchor('head') ?? [hx * FALLBACK_X, hy * FALLBACK_Y, hz * FALLBACK_Z],
    rear: vehicle.handle.lampAnchor('tail') ?? [hx * FALLBACK_X, -hy * FALLBACK_Y, hz * FALLBACK_Z],
  };
}

/**
 * The four lamps of a car in world space: each anchor yields a left and a right lamp (mirrored on X).
 * Heads face forward (+Y), tails backward (−Y) — a corona fades out when seen from behind its lamp.
 */
export function lampsOf(vehicle: EnterableVehicle): VehicleLamp[] {
  const { front: head, rear: tail } = lampAnchorsOf(vehicle);
  const quat = quatFromHeading(vehicle.heading);
  const lamps: VehicleLamp[] = [];
  for (const [anchor, kind] of [
    [head, 'head'],
    [tail, 'tail'],
  ] as const) {
    for (const mirror of [1, -1]) {
      lamps.push({
        facing: rotate([0, kind === 'head' ? 1 : -1, 0], quat),
        kind,
        position: add(vehicle.position, rotate([anchor[0] * mirror, anchor[1], anchor[2]], quat)),
      });
    }
  }

  return lamps;
}

/**
 * Which car has its lamps on, and how. Occupant-agnostic by design (it asks whether the car is BEING DRIVEN,
 * not whether the player is in it), so NPC traffic drops in unchanged.
 */
export function lampStateFor(
  car: EnterableVehicle | null,
  seated: boolean,
  braking: boolean,
  night: boolean,
  intensity: number,
): { car: EnterableVehicle | null; state: VehicleLampState } {
  const lit = car && seated && night ? car : null;

  return { car: lit, state: { brakes: lit ? braking : false, headlights: lit !== null, intensity } };
}

function add(a: Vec3, b: [number, number, number]): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** Yaw about GTA +Z (the car's heading) as a quaternion. */
function quatFromHeading(heading: number): VehicleQuat {
  return [0, 0, Math.sin(heading / 2), Math.cos(heading / 2)];
}

function rotate(v: readonly [number, number, number], q: VehicleQuat): [number, number, number] {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  // t = 2 × (q.xyz × v); v' = v + w·t + q.xyz × t
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);

  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
