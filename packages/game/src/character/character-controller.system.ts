import { Vector3 } from '@opensa/math';
import { query } from 'bitecs';

import type { System } from '../core/system';
import type { EcsWorld } from '../ecs/world';
import type { InputState } from '../input';
import type { Config } from '../interfaces/config.interface';
import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { CharacterController, PhysicsWorld } from '../physics/physics-world';

import { Locomotion, PlayerControlled, RigidBody, Transform, Velocity } from '../ecs/components';
import {
  angleDelta,
  approachAngle,
  IDLE_SPEED_THRESHOLD,
  LAND_MIN_FALL_SPEED,
  LOCOMOTION_AIRBORNE,
  LOCOMOTION_COLLAPSE,
  LOCOMOTION_FALL,
  LOCOMOTION_GROUNDED,
  LOCOMOTION_HARD_LAND,
  LOCOMOTION_LAND,
  LOCOMOTION_LAUNCH,
  LOCOMOTION_SLIDE,
  REVERSAL_ANGLE,
  scheduledTurnRate,
  yawFromPlanar,
} from './locomotion';

/** All the controller needs from a camera: the scene-space (Y-up) look direction. */
export interface LookDirectionSource {
  getWorldDirection(target: Vector3): Vector3;
}

/** What the air FSM hands the move step: the one-shot launch impulse + the grounded control scale. */
interface AirStep {
  controlFactor: number;
  launch: boolean;
}

/** Gravity integrated into the kinematic body's vertical velocity (Z-up). */
const GRAVITY = -9.81;

/** Debug fly mode moves at this multiple of the run speed (horizontal + vertical). */
const FLY_SPEED_MULTIPLIER = 2;

/** Metres the player lifts off the moment fly mode is turned on (so they're immediately airborne). */
const FLY_INITIAL_LIFT = 4;

/** Planar distance (m) at which a scripted {@link CharacterControllerSystem.runTo} target is reached. */
const ARRIVE_DISTANCE = 0.6;

/** How far below the body the slope probe looks (m), and the hysteresis (deg) before a slide ends. */
const SLOPE_PROBE_DROP = 2;
const SLIDE_EXIT_HYSTERESIS_DEG = 4;

/**
 * Drives the player's **kinematic capsule** from the keyboard while playing.
 * Movement is **camera-relative** (W goes where the camera looks). Each fixed
 * step it builds a desired velocity — horizontal **accelerated** toward the input
 * target (ramp-up, turn momentum, reduced air control), vertical from gravity +
 * jump — asks the {@link CharacterController} for the collision-corrected move
 * (slides along obstacles, climbs steps, snaps to ground), and writes the result
 * + grounded state to the ECS {@link Velocity}.
 */
export class CharacterControllerSystem implements System {
  readonly name = 'character-controller';

  /** True once the player has reached a {@link runTo} target (until the next `runTo`). */
  get arrived(): boolean {
    return this.autoArrived;
  }
  /** Per-player jump-buffer/coyote clocks (seconds remaining) for the 088/04 FSM. */
  private readonly airTimers = new Map<number, { buffer: number; coyote: number }>();
  private autoArrived = false;
  private autoIndex = 0;
  private autoPath: Vec3[] = [];
  private readonly camera: LookDirectionSource;
  private readonly config: Readonly<Config>;
  private readonly controller: CharacterController;
  private enabled = true;
  private flyMode = false;
  private readonly forward = new Vector3();
  private readonly input: InputState;
  private readonly physics: PhysicsWorld;
  /** Last step's jump-held signal — the buffer arms on the RISING edge only (no held-key auto-hop). */
  private prevJumpHeld = false;
  private readonly right = new Vector3();

  private readonly world: EcsWorld;

  constructor(
    world: EcsWorld,
    physics: PhysicsWorld,
    input: InputState,
    config: Readonly<Config>,
    controller: CharacterController,
    camera: LookDirectionSource,
  ) {
    this.world = world;
    this.physics = physics;
    this.input = input;
    this.config = config;
    this.controller = controller;
    this.camera = camera;
  }

  fixedUpdate(step: number): void {
    if (this.config.gameState !== 'play') {
      return;
    }
    if (this.flyMode) {
      this.flyUpdate(step);

      return;
    }
    if (!this.enabled) {
      return; // gated (e.g. while the player is scripted into a car)
    }
    const players = query(this.world, [PlayerControlled, RigidBody, Velocity]);
    const { jump, target } = this.desiredMove(players);
    const jumpEdge = jump && !this.prevJumpHeld;
    this.prevJumpHeld = jump;
    const moving = target.x !== 0 || target.y !== 0;
    const intentYaw = moving ? yawFromPlanar(target.x, target.y) : 0;

    for (const eid of players) {
      this.moveOnFoot(eid, step, jumpEdge, moving, intentYaw, target);
    }
  }

  /** Whether the debug fly mode is on. */
  isFlying(): boolean {
    return this.flyMode;
  }

  /**
   * Drive the player along a world-space path (Z-up), ignoring the keyboard until
   * the last point is reached. Pass `[]` to restore manual control.
   */
  runPath(points: readonly Vec3[]): void {
    this.autoPath = [...points];
    this.autoIndex = 0;
    this.autoArrived = points.length === 0;
  }

  /** Enable/disable manual + scripted control (e.g. while the player is seated in a car). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.autoPath = [];
      this.zeroVelocity(); // stop the body so stale velocity doesn't drive facing/locomotion when control returns
    }
  }

  /** Toggle the debug fly mode: the player floats (no gravity/collision), moving at 2× run speed — horizontal
   *  from the camera-relative move keys, vertical from jump (up) / descend (down), hovering when neither is held.
   *  Turning it on lifts the player off the ground so they are immediately airborne. */
  setFlying(on: boolean): void {
    this.flyMode = on;
    this.zeroVelocity();
    if (on) {
      for (const eid of query(this.world, [PlayerControlled, RigidBody, Velocity])) {
        const [px, py, pz] = this.physics.readBody(RigidBody.handle[eid]).position;
        this.placeFlying(eid, [px, py, pz + FLY_INITIAL_LIFT], 0, 0, 0);
      }
    }
  }

  /**
   * The per-player jump/fall FSM (plan 088/04), advanced once per fixed step BEFORE the move.
   * Returns this step's physics modifiers: `launch` fires the vertical impulse (once, at the end of
   * the anticipation delay), `controlFactor` scales the grounded horizontal rate (the landing beat).
   */
  private advanceAirState(
    eid: number,
    step: number,
    jumpEdge: boolean,
    grounded: boolean,
    slopeDeg: null | number,
  ): AirStep {
    const { movement } = this.config;
    const timers = this.airTimers.get(eid) ?? { buffer: 0, coyote: 0 };
    this.airTimers.set(eid, timers);
    timers.buffer = jumpEdge ? movement.jumpBufferSeconds : Math.max(0, timers.buffer - step);
    timers.coyote = grounded ? movement.coyoteSeconds : Math.max(0, timers.coyote - step);

    let state = Locomotion.state[eid] ?? LOCOMOTION_GROUNDED;
    let time = (Locomotion.stateTime[eid] ?? 0) + step;
    let launch = false;
    let controlFactor = 1;
    if (state === LOCOMOTION_GROUNDED) {
      [state, time] = this.groundedTransition(timers, grounded, slopeDeg, state, time);
    } else if (state === LOCOMOTION_SLIDE) {
      controlFactor = movement.airControl; // braced, not steering
      [state, time] = this.slideTransition(timers, grounded, slopeDeg, state, time);
    } else if (state === LOCOMOTION_LAUNCH) {
      if (time >= movement.launchDelaySeconds) {
        launch = true; // the crouch is over — fire the impulse and leave the ground
        [state, time] = [LOCOMOTION_AIRBORNE, 0];
      }
    } else if (state === LOCOMOTION_AIRBORNE || state === LOCOMOTION_FALL) {
      // A landing needs DESCENT: right after the impulse the controller can still report grounded for
      // a frame (ground snap) while the body rises — that frame must not read as a touchdown.
      if (grounded && (Velocity.z[eid] ?? 0) <= 0) {
        [state, time] = [this.touchdownState(eid, timers), 0];
      }
    } else {
      // LAND / HARD_LAND / COLLAPSE: a recovery at reduced control, then back to the ground state.
      controlFactor = movement.airControl;
      if (time >= this.recoverySecondsOf(state)) {
        [state, time] = [LOCOMOTION_GROUNDED, 0];
      }
    }
    Locomotion.state[eid] = state;
    Locomotion.stateTime[eid] = time;

    return { controlFactor, launch };
  }

  /** Planar velocity (Z-up) for a forward/right input at `speed`, relative to the camera. */
  private cameraRelativeMove(forwardInput: number, rightInput: number, speed: number): { x: number; y: number } {
    // Camera look direction (scene Y-up) projected to the ground, converted to
    // GTA Z-up: (x, y, z) → (x, −z, 0). Right = forward × up(0,0,1).
    this.camera.getWorldDirection(this.forward);
    this.forward.set(this.forward.x, -this.forward.z, 0);
    if (this.forward.lengthSq() < 1e-6) {
      this.forward.set(0, 1, 0); // looking straight down/up — pick a stable axis
    }
    this.forward.normalize();
    this.right.set(this.forward.y, -this.forward.x, 0);

    let x = this.forward.x * forwardInput + this.right.x * rightInput;
    let y = this.forward.y * forwardInput + this.right.y * rightInput;
    const length = Math.hypot(x, y);
    if (length > 0) {
      x = (x / length) * speed;
      y = (y / length) * speed;
    }

    return { x, y };
  }

  /** Desired planar velocity + jump for this step — scripted auto-run if active, else player input. */
  private desiredMove(players: ArrayLike<number>): { jump: boolean; target: { x: number; y: number } } {
    const { movement } = this.config;
    if (this.autoIndex < this.autoPath.length && players.length > 0) {
      // Scripted auto-run (e.g. around to a car door) — ignore manual input until arrival.
      return { jump: false, target: this.moveToward(players[0], movement.runSpeed) };
    }
    const move = this.input.move();
    const target = this.cameraRelativeMove(move.y, move.x, this.tierSpeed());

    return { jump: this.input.isActive('jump'), target };
  }

  /** Float the player by directly teleporting the kinematic body (no gravity, no collision): horizontal from the
   *  move keys, vertical from jump (up) / descend (down), all at 2× run speed; hovers when neither is held.
   *  `grounded` stays set so the animation shows run/idle (never the fall clip) while flying. */
  private flyUpdate(step: number): void {
    const speed = this.config.movement.runSpeed * FLY_SPEED_MULTIPLIER;
    const move = this.input.move();
    const { x, y } = this.cameraRelativeMove(move.y, move.x, speed);
    const vz = (this.input.isActive('jump') ? speed : 0) - (this.input.isActive('descend') ? speed : 0);
    for (const eid of query(this.world, [PlayerControlled, RigidBody, Velocity])) {
      // Base the next position on the **body** (what the PhysicsSystem syncs Transform from) — not Transform —
      // so releasing the keys (vz = 0) leaves the player hovering instead of the two desyncing.
      const [px, py, pz] = this.physics.readBody(RigidBody.handle[eid]).position;
      this.placeFlying(eid, [px + x * step, py + y * step, pz + vz * step], x, y, vz);
    }
  }

  /** Where the GROUNDED state goes this step: a (buffered/coyote) jump launches, walking off an edge
   *  falls once the coyote window dies (micro-airborne stair steps never get here), and ground too
   *  steep to stand starts the slide (088/08). */
  private groundedTransition(
    timers: { buffer: number; coyote: number },
    grounded: boolean,
    slopeDeg: null | number,
    state: number,
    time: number,
  ): [number, number] {
    if (timers.buffer > 0 && (grounded || timers.coyote > 0)) {
      timers.buffer = 0;

      return [LOCOMOTION_LAUNCH, 0];
    }
    if (!grounded && timers.coyote <= 0) {
      return [LOCOMOTION_FALL, 0];
    }
    if (grounded && slopeDeg !== null && slopeDeg > this.config.movement.slideSlopeDeg) {
      return [LOCOMOTION_SLIDE, 0]; // Rapier is already sliding the capsule
    }

    return [state, time];
  }

  /** Slope (deg) of the ground under the body, or null when nothing is within the probe (088/08). */
  private groundSlopeDeg(eid: number): null | number {
    const { position } = this.physics.readBody(RigidBody.handle[eid]);
    const normal = this.physics.groundNormalBelow(
      [position[0], position[1], position[2]],
      SLOPE_PROBE_DROP,
      RigidBody.handle[eid],
    );
    if (!normal) {
      return null;
    }

    return (Math.acos(Math.min(1, Math.max(-1, normal[2]))) * 180) / Math.PI;
  }

  /** One player's fixed step on foot: planar accel/plant, rate-limited heading, the air FSM + gravity. */
  private moveOnFoot(
    eid: number,
    step: number,
    jumpEdge: boolean,
    moving: boolean,
    intentYaw: number,
    target: { x: number; y: number },
  ): void {
    const { movement } = this.config;
    const grounded = Velocity.grounded[eid] === 1;
    const air = this.advanceAirState(eid, step, jumpEdge, grounded, grounded ? this.groundSlopeDeg(eid) : null);
    const heading = Locomotion.heading[eid] ?? 0;
    // A reversal (intent far behind the facing) PLANTS: decelerate on the old heading to a stop,
    // then about-face near-idle — turning a full run through 180° in place reads as skating.
    const reversing = moving && Math.abs(angleDelta(heading, intentYaw)) > REVERSAL_ANGLE;
    const accelerating = moving && !reversing;
    // Horizontal: accelerate toward the target (decelerate toward rest with no input or mid-plant),
    // at a reduced rate in the air (or during a landing recovery) → ramp-up, turn momentum, momentum
    // into jumps, and a beat where a landing dampens steering instead of stopping it.
    const rate =
      (accelerating ? movement.accel : movement.deceleration) *
      (grounded ? air.controlFactor : movement.airControl) *
      step;
    approach(eid, accelerating ? target.x : 0, accelerating ? target.y : 0, rate);
    // Heading: rate-limited turn toward the intent (plan 088/01) — snappy near idle, wide arcs at
    // speed. A plant holds the old facing until the speed has bled off, then turns.
    const speed = Math.hypot(Velocity.x[eid], Velocity.y[eid]);
    if (moving && (!reversing || speed <= IDLE_SPEED_THRESHOLD)) {
      const turnRate = scheduledTurnRate(
        speed,
        movement.sprintSpeed, // the top gait tier (was runSpeed before 088/03 added sprint)
        movement.turnRateIdleDeg,
        movement.turnRateFullDeg,
      );
      Locomotion.heading[eid] = approachAngle(heading, intentYaw, turnRate * step);
    }
    // Vertical: the FSM's launch impulse (fired once, after the anticipation crouch), else rest on
    // the ground, else keep integrating the flight — then gravity. A RISING body keeps its velocity
    // even if the controller still reports grounded (the post-launch snap frame must not eat the jump).
    let vz = air.launch ? movement.jumpSpeed : grounded && Velocity.z[eid] <= 0 ? 0 : Velocity.z[eid];
    vz += GRAVITY * step;

    const move = this.physics.moveCharacter(this.controller, RigidBody.handle[eid], RigidBody.collider[eid], [
      Velocity.x[eid] * step,
      Velocity.y[eid] * step,
      vz * step,
    ]);
    Velocity.grounded[eid] = move.grounded ? 1 : 0;
    if (move.grounded && vz < 0) {
      if (!grounded) {
        // A TOUCHDOWN (air → ground this step): record the impact for the FSM's land-tier pick.
        // Standing gravity ticks also come through here and must not clobber it.
        Locomotion.fallSpeed[eid] = -vz;
      }
      Velocity.z[eid] = 0;
    } else {
      Velocity.z[eid] = vz;
    }
  }

  /** Planar velocity toward the current path waypoint; advances/flags arrival as points are reached. */
  private moveToward(eid: number, speed: number): { x: number; y: number } {
    const target = this.autoPath[this.autoIndex];
    const dx = target[0] - Transform.x[eid];
    const dy = target[1] - Transform.y[eid];
    const distance = Math.hypot(dx, dy);
    if (distance < ARRIVE_DISTANCE) {
      this.autoIndex += 1;
      if (this.autoIndex >= this.autoPath.length) {
        this.autoPath = [];
        this.autoArrived = true;

        return { x: 0, y: 0 };
      }

      return this.moveToward(eid, speed); // head to the next waypoint
    }

    return { x: (dx / distance) * speed, y: (dy / distance) * speed };
  }

  /** Teleport the kinematic body to `next` and write the matching Transform + Velocity (grounded, for the run
   *  animation) — the one place fly mode moves the player, so the body and Transform never diverge. */
  private placeFlying(eid: number, next: Vec3, vx: number, vy: number, vz: number): void {
    this.physics.teleport(RigidBody.handle[eid], next);
    Transform.x[eid] = next[0];
    Transform.y[eid] = next[1];
    Transform.z[eid] = next[2];
    Velocity.x[eid] = vx;
    Velocity.y[eid] = vy;
    Velocity.z[eid] = vz;
    Velocity.grounded[eid] = 1;
    if (Math.hypot(vx, vy) > IDLE_SPEED_THRESHOLD) {
      Locomotion.heading[eid] = yawFromPlanar(vx, vy); // debug fly turns instantly — no plant, no rate
    }
  }

  /** How long a landing state locks control (088/07): the collapse's stand-back-up is the longest. */
  private recoverySecondsOf(state: number): number {
    const { movement } = this.config;
    if (state === LOCOMOTION_COLLAPSE) {
      return movement.collapseRecoverySeconds;
    }

    return state === LOCOMOTION_HARD_LAND ? movement.hardLandRecoverySeconds : movement.landRecoverySeconds;
  }

  /** Where a SLIDE goes this step (088/08): a jump kicks off the slope, sliding off an edge falls,
   *  a flattened slope (with hysteresis, so the boundary never flickers) returns to the ground state. */
  private slideTransition(
    timers: { buffer: number; coyote: number },
    grounded: boolean,
    slopeDeg: null | number,
    state: number,
    time: number,
  ): [number, number] {
    if (timers.buffer > 0 && grounded) {
      timers.buffer = 0;

      return [LOCOMOTION_LAUNCH, 0];
    }
    if (!grounded && timers.coyote <= 0) {
      return [LOCOMOTION_FALL, 0]; // slid off the edge
    }
    if (grounded && (slopeDeg === null || slopeDeg < this.config.movement.slideSlopeDeg - SLIDE_EXIT_HYSTERESIS_DEG)) {
      return [LOCOMOTION_GROUNDED, 0];
    }

    return [state, time];
  }

  /** Gait tier (088/03): sprint > walk modifiers, RUN is the default — SA jogs when nothing is held. */
  private tierSpeed(): number {
    const { movement } = this.config;
    if (this.input.isActive('sprint')) {
      return movement.sprintSpeed;
    }
    if (this.input.isActive('walk')) {
      return movement.walkSpeed;
    }

    return movement.runSpeed;
  }

  /** The state a touchdown lands in (088/07 tiers): past `collapseSpeed` the ped goes DOWN and stands
   *  back up; past `hardLandSpeed` it takes the impact crouch (neither is buffer-bypassed); else a
   *  buffered press re-launches on the landing frame, a real impact takes the quick recovery beat,
   *  a feather touch takes none. */
  private touchdownState(eid: number, timers: { buffer: number }): number {
    const { movement } = this.config;
    const impact = Locomotion.fallSpeed[eid] ?? 0;
    if (impact > movement.collapseSpeed) {
      return LOCOMOTION_COLLAPSE;
    }
    if (impact > movement.hardLandSpeed) {
      return LOCOMOTION_HARD_LAND;
    }
    if (timers.buffer > 0) {
      timers.buffer = 0;

      return LOCOMOTION_LAUNCH;
    }

    return impact >= LAND_MIN_FALL_SPEED ? LOCOMOTION_LAND : LOCOMOTION_GROUNDED;
  }

  private zeroVelocity(): void {
    for (const eid of query(this.world, [PlayerControlled, Velocity])) {
      Velocity.x[eid] = 0;
      Velocity.y[eid] = 0;
      Velocity.z[eid] = 0;
      // Both callers (seating into a car, toggling fly mode) also abandon any in-flight jump state.
      Locomotion.state[eid] = LOCOMOTION_GROUNDED;
      Locomotion.stateTime[eid] = 0;
    }
    this.airTimers.clear();
  }
}

/** Move an entity's horizontal velocity toward (tx, ty) by at most `maxDelta` (planar). */
function approach(eid: number, tx: number, ty: number, maxDelta: number): void {
  const dx = tx - Velocity.x[eid];
  const dy = ty - Velocity.y[eid];
  const distance = Math.hypot(dx, dy);
  if (distance <= maxDelta || distance === 0) {
    Velocity.x[eid] = tx;
    Velocity.y[eid] = ty;

    return;
  }
  Velocity.x[eid] += (dx / distance) * maxDelta;
  Velocity.y[eid] += (dy / distance) * maxDelta;
}
