import type { AxleSetup, VehicleWheelPlacement } from '../interfaces/world-adapter.interface';
import type { VehicleHandle } from './vehicle-handle';

/** Smoothing rate (1/s) for the drawn suspension travel — a raycast length jitters by millimetres on a
 *  trimesh, and drawn raw it reads as a vibrating wheel (plan 081/06 §3.5). Runs in the FIXED step (this
 *  class is updated there), so the response is frame-rate independent. */
const LIFT_SMOOTHING = 25;
/**
 * How much an INDEPENDENT wheel leans per metre it stands proud of its axle partner (rad/m) — the one
 * fitted number in this file, and it is fitted to real suspensions rather than to a car.
 *
 * A road car's independent geometry gains roughly a degree of negative camber per 40 mm of compression;
 * 0.44 rad/m is that. It applies to the wheel's travel RELATIVE TO ITS AXLE PARTNER, not to an absolute rest
 * length: the rig is fed hub offsets, whose rest value is the standing pose of a car it does not know. The
 * price is stated plainly — a symmetric bump (both wheels compressing together) draws no camber here where a
 * real wishbone would gain some. In a corner, which is what the field brief is about, the two are the same.
 *
 * The original's own rule for these flags is NOT in the reversed source (nothing in gta-reversed reads
 * `AXLE_*`), so this is ours until it is; the solid-axle rule below needs no constant at all.
 */
const INDEPENDENT_CAMBER_GAIN = 0.44;
/** Below this track width (m) the two wheels are effectively in the same place and the solid-axle tilt would
 *  blow up. A model that authors it has no axle to speak of. */
const MIN_TRACK = 0.1;

/** What the rig needs to know about the car's suspension to LEAN its wheels (plan 081/06 §3). */
export interface VehicleRigSetup {
  /** The authored axle builds (`handling.cfg`'s `modelFlags`). */
  axles: { front: AxleSetup; rear: AxleSetup };
  /** Wheel hubs in vehicle space, in the SAME order as the handle's wheels — the x sign says which side a
   *  wheel is on, and a pair's separation is the track width the solid-axle tilt divides by. */
  wheels: readonly VehicleWheelPlacement[];
}

/**
 * Animates a vehicle's wheels: rolls them from the travelled distance, steers the front pair, slides each
 * wheel with its suspension and LEANS it the way its axle is built (plan 081/06 §3).
 * Driving (speed + steer) is fed in via {@link setSpeed} / {@link setSteer}; the per-wheel physics offset
 * from the model hub via {@link setLift}.
 *
 * Pure arithmetic since B5 step 3 — it emits POSES through the {@link VehicleHandle}; turning them into
 * quaternions/matrices is the renderer's business.
 */
export class VehicleRig {
  private distance = 0;
  private readonly handle: VehicleHandle;
  /** Smoothed per-wheel hub offsets (m). Null until the first {@link setLift} SEEDS it — easing in from
   *  zero would visibly drop every car onto its suspension on spawn. */
  private lift: null | number[] = null;
  private liftTarget: number[] = [];

  private readonly setup: null | VehicleRigSetup;
  private speed = 0;
  private steerAngle = 0;

  constructor(handle: VehicleHandle, setup: null | VehicleRigSetup = null) {
    this.handle = handle;
    this.setup = setup;
  }

  /** Per-wheel offset from the model hub (m, negative = dropped), from the physics suspension length. */
  setLift(values: readonly number[]): void {
    this.liftTarget = [...values];
    this.lift ??= [...values];
  }

  /** Forward speed (units/s) that rolls the wheels. */
  setSpeed(speed: number): void {
    this.speed = speed;
  }

  /** Front-wheel steering angle (radians). */
  setSteer(angle: number): void {
    this.steerAngle = angle;
  }

  update(delta: number): void {
    this.distance += this.speed * delta;
    const blend = Math.min(1, LIFT_SMOOTHING * delta);
    if (this.lift !== null) {
      this.lift.forEach((current, index) => {
        (this.lift as number[])[index] = current + ((this.liftTarget[index] ?? current) - current) * blend;
      });
    }
    this.handle.wheels.forEach((wheel, index) => {
      // Negative so positive speed rolls the top of the wheel forward (+Y).
      const spin = -this.distance / wheel.radius;
      const lift = this.lift?.[index] ?? 0;
      this.handle.setWheel(index, {
        camber: this.camberOf(index),
        lift,
        spin,
        steer: wheel.front ? this.steerAngle : 0,
      });
    });
  }

  /**
   * How far wheel `index` leans (rad, positive = its top toward the car's +X side), from the axle it is on.
   *
   * - **SOLID**: the axle is one beam, so both its wheels take the same tilt — `atan(Δlift / track)`, pure
   *   geometry with nothing fitted. This is the loud one: it is what a pickup's rear end does in a corner.
   * - **MCPHERSON / independent**: the wheel leans with its own travel relative to its partner, the
   *   compressed one gaining negative camber (top inward) — see {@link INDEPENDENT_CAMBER_GAIN}.
   * - **NOTILT**: zero. Bikes, and anything the artist froze.
   * - **REVERSE**: the sign flips, because the model's wheel dummies are mirrored.
   *
   * Zero whenever the car was built without a setup, or the wheel has no partner on its axle (a three-wheeler,
   * or a model whose dummies did not pair) — an unknown axle must not invent a lean.
   */
  private camberOf(index: number): number {
    const setup = this.setup;
    const wheel = setup?.wheels[index];
    if (!setup || !wheel || this.lift === null) {
      return 0;
    }
    const axle = this.handle.wheels[index].front ? setup.axles.front : setup.axles.rear;
    if (axle.type === 'notilt') {
      return 0;
    }
    const partner = this.partnerOf(index);
    if (partner < 0) {
      return 0;
    }
    const track = Math.abs(wheel.connection[0] - setup.wheels[partner].connection[0]);
    if (track < MIN_TRACK) {
      return 0;
    }
    // Signed so the maths below can be written once for both sides: `own − partner` measured toward +X.
    const toRight = wheel.connection[0] > setup.wheels[partner].connection[0];
    const [left, right] = toRight ? [partner, index] : [index, partner];
    const rise = (this.lift[left] ?? 0) - (this.lift[right] ?? 0);
    const sign = axle.reverse ? -1 : 1;
    if (axle.type === 'solid') {
      // One beam: both wheels stay square to it, so relative to the BODY they take the body's own roll back
      // out — `atan(Δ / track)` is exactly that angle. A pickup's rear wheels stay upright while its body
      // leans over them, which is the thing the field brief's screenshot shows.
      return sign * Math.atan2(rise, track);
    }
    // Independent: each wheel leans with its travel relative to its partner — the compressed one takes its
    // top inward, the drooping one lets it out, which comes to the same angle about the car's forward axis
    // for both. Same direction as the solid rule and a fraction of its size: camber gain only PARTLY answers
    // a rolling body, where a solid axle answers it entirely.

    return sign * INDEPENDENT_CAMBER_GAIN * (rise / 2);
  }

  /** The other wheel on this wheel's axle: the nearest one on the same end of the car, on the other side. */
  private partnerOf(index: number): number {
    const setup = this.setup;
    const wheel = setup?.wheels[index];
    if (!setup || !wheel) {
      return -1;
    }
    let best = -1;
    let bestDistance = Infinity;
    setup.wheels.forEach((candidate, other) => {
      if (other === index || Math.sign(candidate.connection[0]) === Math.sign(wheel.connection[0])) {
        return;
      }
      const distance = Math.abs(candidate.connection[1] - wheel.connection[1]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = other;
      }
    });

    return best;
  }
}
