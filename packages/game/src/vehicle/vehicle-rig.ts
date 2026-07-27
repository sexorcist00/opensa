import type { VehicleHandle } from './vehicle-handle';

/** Smoothing rate (1/s) for the drawn suspension travel — a raycast length jitters by millimetres on a
 *  trimesh, and drawn raw it reads as a vibrating wheel (plan 081/06 §3.5). Runs in the FIXED step (this
 *  class is updated there), so the response is frame-rate independent. */
const LIFT_SMOOTHING = 25;

/**
 * Animates a vehicle's wheels: rolls them from the travelled distance, steers the front pair, and slides
 * each wheel with its suspension (plan 081/06 §3 — the travel half; camber joins with the axle rules).
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

  private speed = 0;
  private steerAngle = 0;

  constructor(handle: VehicleHandle) {
    this.handle = handle;
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
    this.handle.wheels.forEach((wheel, index) => {
      // Negative so positive speed rolls the top of the wheel forward (+Y).
      const spin = -this.distance / wheel.radius;
      let lift = 0;
      if (this.lift !== null && index < this.lift.length) {
        this.lift[index] += ((this.liftTarget[index] ?? this.lift[index]) - this.lift[index]) * blend;
        lift = this.lift[index];
      }
      this.handle.setWheel(index, { lift, spin, steer: wheel.front ? this.steerAngle : 0 });
    });
  }
}
