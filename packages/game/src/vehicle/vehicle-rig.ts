import type { VehicleHandle } from './vehicle-handle';

/**
 * Animates a vehicle's wheels: rolls them from the travelled distance and steers the front pair. Driving
 * (speed + steer) is fed in via {@link setSpeed} / {@link setSteer}.
 *
 * Pure arithmetic since B5 step 3 — it emits ANGLES through the {@link VehicleHandle}; turning them into
 * quaternions (or a three spinner's rotation) is the renderer's business.
 */
export class VehicleRig {
  private distance = 0;
  private readonly handle: VehicleHandle;

  private speed = 0;
  private steerAngle = 0;

  constructor(handle: VehicleHandle) {
    this.handle = handle;
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
    this.handle.wheels.forEach((wheel, index) => {
      // Negative so positive speed rolls the top of the wheel forward (+Y).
      const spin = -this.distance / wheel.radius;
      this.handle.setWheel(index, spin, wheel.front ? this.steerAngle : 0);
    });
  }
}
