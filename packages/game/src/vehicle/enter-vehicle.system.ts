import { Quaternion, Vector3 } from '@opensa/math';

import type { CharacterControllerSystem } from '../character/character-controller.system';
import type { System } from '../core/system';
import type { Logger } from '../diagnostics/logger';
import type { InputState } from '../input';
import type { Config } from '../interfaces/config.interface';
import type { Vec3, VehicleHandling, VehicleWheelPlacement } from '../interfaces/world-adapter.interface';
import type { PhysicsWorld, VehicleController } from '../physics/physics-world';
import type { VehicleHandle } from './vehicle-handle';
import type { VehicleRig } from './vehicle-rig';

import {
  CAR_CRAWLOUT,
  CAR_GETIN,
  CAR_GETIN_RHS,
  CAR_GETOUT,
  CAR_GETOUT_RHS,
  CAR_SHUFFLE,
  CAR_SIT,
} from './vehicle-clips';

/** A car the player can interact with + sit in (driver side). It is a dynamic
 * physics body; `position`/`heading` are kept live by the vehicle-physics system. */
export interface EnterableVehicle {
  /** Chassis rigid-body handle (dynamic). */
  body: number;
  /** Raycast vehicle controller (drive/brake/steer). */
  controller: VehicleController;
  /** Half-extents in vehicle space `[hx, hy, hz]` (routing uses x/y). */
  halfExtents: [number, number, number];
  /** The renderer-agnostic render handle (B5) — gameplay never touches a mesh. */
  handle: VehicleHandle;
  /** Driving feel from handling.cfg. */
  handling: VehicleHandling;
  /** Heading about Z (native) — kept live from the body by the physics system. */
  heading: number;
  /**
   * The chassis's FULL orientation (native GTA quaternion), kept live by the physics system.
   *
   * `heading` alone is a yaw, and a yaw cannot describe a car that is upside down. Anything bolted to the
   * BODY — its lamps, and the coronas that sit on them — has to ride this, or it slides off the car the
   * moment the car rolls.
   */
  orientation: [number, number, number, number];
  /** World position (native Z-up) — kept live from the body by the physics system. */
  position: Vec3;
  /** Wheel rig (spin/steer). */
  rig: VehicleRig;
  /** Driver seat position in vehicle space `[x, y, z]` (mirrored to the −X driver side). */
  seatLocal: [number, number, number];
  /** Raycast wheel placements (front flags for steering/drive). */
  wheels: VehicleWheelPlacement[];
}

/** A scripted clip's authored root travel (088/09a): ped-local metres, x = right of facing, y = forward,
 *  z = up — measured on `ped.ifp`: `CAR_getin_LHS` runs (0,0,0)→(0.95, 0.49, −0.35), i.e. ~1 m into the
 *  car, half a metre forward, dropping into the seat. */
export interface ScriptedMotion {
  /** Clip length (s) — the slide runs THIS long, not a hardcoded constant. */
  duration: number;
  /** Root position at `time` (clamped to the clip's ends). */
  sample(time: number): readonly [number, number, number];
}

/**
 * The animation surface enter/exit needs (B5 step 4). `CharacterAnimationSystem` (three) satisfies it
 * structurally, and so does the own engine's ped — the climb-in/sit/climb-out clips are the whole contract.
 */
export interface VehicleAnimator {
  faceTo(yaw: number): void;
  /** The authored root travel of a named scripted clip, or null (a TC without it → the linear slide). */
  scriptedMotion(clip: string): null | ScriptedMotion;
  setScripted(
    clip: null | string,
    options?: { facing?: number; loop?: boolean; orientation?: readonly [number, number, number, number] },
  ): void;
}

/** Front doors the enter sequence can use (088/09b): `lf` = driver (−X), `rf` = passenger (+X). */
type DoorSide = 'lf' | 'rf';

/** −1 on the driver (−X) side, +1 on the passenger side — mirrors every door-relative x. */
function sideSign(side: DoorSide): number {
  return side === 'lf' ? -1 : 1;
}

/** Planar distance (m) from the car within which Enter starts the sequence. */
const ENTER_RANGE = 4;
/** How far out from the hinge (m, driver −X side) the player stands to open the door. */
const DOOR_STANDOFF = 1.2;
/** Clearance (m) outside the body where the player stands in the open doorway before climbing in. */
const DOORWAY_CLEAR = 0.35;
/** Driver-door open angle about the hinge (sign tuned in-browser). */
const DOOR_OPEN_ANGLE = -Math.PI / 3;
/** Door swing speed (rad/s). */
const DOOR_SPEED = Math.PI;
/** Seconds the climb-in/out clip plays while the body slides between door and seat. */
const GETIN_DURATION = 1.2;
const GETOUT_DURATION = 1.2;
/** Capsule-CENTRE height above the ground a standing player needs (radius 0.3 + half-height 0.6,
 *  rounded up for the controller offset) — a ground-anchored exit spot must be lifted by it, or the
 *  capsule lands half-buried and sticks in the collision (field 2026-07-24, overturned crawl-out). */
const PLAYER_STAND_LIFT = 1;
/** How far behind the hinge the open panel's swept arc reaches (m, with margin) — the step-in path
 *  crosses inboard BEHIND this line so it never clips the door. */
const DOOR_SWEPT_CLEARANCE = 0.95;
/** Fallback seat-shuffle length (s) when the clip is absent — the real CAR_shuffle_RHS runs 0.4 s. */
const SHUFFLE_DURATION = 0.4;
/** Capsule-centre height above the seat dummy (tuned in-browser). */
const SEAT_RAISE = 0;

// handling.cfg → driving forces (tuned in-browser). Engine/brake are forces (N) scaled from the
// car's mass + handling accel/decel; the controller (raycast wheels) integrates them.
const ENGINE_ACCEL_SCALE = 0.28; // engineAccel → target accel (m/s²) the engine force aims for
// Rapier's wheel brake is a small-scale value (NOT a Newton force like the engine): ~120/wheel
// already gives ~12 m/s² of braking, while ≳400/wheel over-constrains and pitches the body hard.
const BRAKE_FORCE = 480; // total brake split across wheels (≈120 each) at a reference brakeDecel
const BRAKE_DECEL_REF = 8.5; // handling.brakeDecel that maps to BRAKE_FORCE (others scale from it)
const REVERSE_FRACTION = 0.4; // reverse force/top-speed as a fraction of forward
const IDLE_BRAKE_FRACTION = 0.08; // light brake when off throttle, so the car coasts to a stop
const ENGINE_RAMP_TIME = 0.2; // seconds for the engine force to reach full (snappy but no force spike)
const MAXVEL_SCALE = 0.25; // handling.maxVelocity → top speed (m/s)
const MIN_TOP_SPEED = 8; // floor for top speed (m/s)
const REVERSE_SPEED_EPS = 0.6; // below this forward speed, S means reverse (else brake)
const REVERSE_SEED_SPEED = 1; // m/s backward to kick reverse off a dead stop
const STEER_RATE = 1.2; // steering slew (rad/s) — eased so the car doesn't snap into turns
const STEER_RECENTER_RATE = 2.4; // faster return to centre when the wheel is released
const STEER_SPEED_FALLOFF = 0.6; // fraction the steering lock shrinks toward top speed
const STEER_LOCK_SCALE = 0.6; // use only this fraction of the handling lock (gentler turn radius)
const UPRIGHT_MIN = 0.6; // car-up·world-up above this = upright enough for the normal door entry
const STOP_THRESHOLD = 0.8; // forward speed (m/s) below which the car counts as stopped (for exit)
const VEHICLE_CLEARANCE = 0.6; // how far outside the car footprint the player must be to re-collide
const APPROACH_CANCEL_HOLD = 0.18; // s of movement input during the run-to-door before control returns (GTA-like lag)
const APPROACH_STALL_TIMEOUT = 1.5; // s of no progress toward the door (blocked path) before auto-cancelling
const APPROACH_STALL_EPSILON = 0.02; // planar distance (m) under which the player counts as not progressing per frame

type Phase =
  | 'approaching'
  | 'exiting'
  | 'exitopen'
  | 'getin'
  | 'idle'
  | 'opening'
  | 'seated'
  | 'shuffle'
  | 'stepin'
  | 'stopping';

/**
 * Drives the full "enter the car" sequence (driver side): from within
 * {@link ENTER_RANGE}, Enter runs the player around to the driver door, opens it,
 * plays the climb-in clip while sliding into the seat, then holds the seated pose
 * and shuts the door. While seated the player rides the (dynamic) car. The
 * character controller + locomotion animation are gated while scripted.
 */
export class EnterVehicleSystem implements System {
  readonly name = 'enter-vehicle';

  private active: EnterableVehicle | null = null;
  private readonly aimCamera: (azimuth: number) => void;
  private readonly animation: VehicleAnimator;
  private approachHeld = 0; // s of movement input held during 'approaching' → hand control back (GTA-like lag)
  private approachLast: Vec3 = [0, 0, 0]; // player position last 'approaching' frame (stall detection)
  private approachStalled = 0; // s without progress toward the door → auto-cancel a blocked approach
  /** Whether the driver is actively braking (handbrake or braking forward motion) — for the brake lights. */
  private braking = false;
  /** After an exit: pull the used door shut once the player has stepped clear of the footprint —
   *  closing it while he still stands in the doorway sweeps the panel through him. */
  private closeDoorWhenClear = false;
  private readonly config: Readonly<Config>;
  private readonly controller: CharacterControllerSystem;
  private readonly doors = new Map<EnterableVehicle, { lf: number; rf: number }>(); // per-side door angles
  private doorTarget = 0;
  private engine = 0; // current engine force (N), ramped toward the throttle target
  private enterHeld = false;
  private exitElapsed = 0;
  private exitFrom: Vec3 = [0, 0, 0];
  private exitTo: Vec3 = [0, 0, 0];
  /** Point the follow camera at the car while seated (null restores the player). */
  private readonly followTarget: (vehicle: EnterableVehicle | null) => void;
  private getinElapsed = 0;
  private getinFrom: Vec3 = [0, 0, 0];
  /** The climb-in/out clips' authored root travel (null on a TC without them → linear slide). */
  private getinMotion: null | ScriptedMotion = null;
  private getoutMotion: null | ScriptedMotion = null;
  private holdPos: Vec3 = [0, 0, 0]; // parked car pose, held still while the player slides in/out
  private holdQuat: [number, number, number, number] = [0, 0, 0, 1];
  private readonly input: InputState;
  private readonly logger: Logger;
  private phase: Phase = 'idle';
  private readonly physics: PhysicsWorld;
  private readonly placePlayer: (position: Vec3, moveBody?: boolean) => void;
  private readonly playerCollider: number;
  private readonly playerPosition: () => Vec3;
  private restoreWhenClear = false; // after exit: re-enable car collision once the player is clear
  private readonly seatOffset = new Vector3(); // scratch: seat-local → world offset (rotated by the car)
  private readonly seatQuat = new Quaternion(); // scratch: car body orientation
  private seatWorld: Vec3 = [0, 0, 0];
  /** The kerb-side shuffle to the driver seat after a passenger-door entry (088/09b). */
  private shuffleElapsed = 0;
  private shuffleFrom: Vec3 = [0, 0, 0];
  private shuffleMotion: null | ScriptedMotion = null;
  /** Which front door this sequence uses — picked by the player's side at approach (088/09b). */
  private side: DoorSide = 'lf';
  private steerAngle = 0; // current front-wheel steering (rad), slewed toward the input
  private readonly vehicles: EnterableVehicle[] = [];

  constructor(
    input: InputState,
    playerPosition: () => Vec3,
    controller: CharacterControllerSystem,
    placePlayer: (position: Vec3, moveBody?: boolean) => void,
    animation: VehicleAnimator,
    aimCamera: (azimuth: number) => void,
    followTarget: (vehicle: EnterableVehicle | null) => void,
    config: Readonly<Config>,
    physics: PhysicsWorld,
    playerCollider: number,
    logger: Logger,
  ) {
    this.input = input;
    this.playerPosition = playerPosition;
    this.controller = controller;
    this.placePlayer = placePlayer;
    this.animation = animation;
    this.aimCamera = aimCamera;
    this.followTarget = followTarget;
    this.config = config;
    this.physics = physics;
    this.playerCollider = playerCollider;
    this.logger = logger;
  }

  add(vehicle: EnterableVehicle): void {
    this.vehicles.push(vehicle);
    this.doors.set(vehicle, { lf: 0, rf: 0 });
  }

  /** Whether pressing enter/exit now would do something: seated → can exit, idle with a car in range → can
   *  enter (mid-sequence the edge is a no-op). Drives the mobile Enter button's visibility (plan 055). */
  canEnterExit(): boolean {
    if (this.phase === 'seated') {
      return true;
    }

    return this.phase === 'idle' && this.nearestEnterable() !== null;
  }

  /**
   * Driving + the seated rider run on the fixed step (lockstep with physics, after
   * the physics step and before render-sync) so the rider doesn't lag/jitter behind
   * the car: WSAD → engine/brake/steer, then snap the player onto the seat.
   */
  fixedUpdate(step: number): void {
    // All rider placement runs here (after the physics step, before render-sync) so render-sync
    // sees it the same frame AND the kinematic body is never teleported into the car (moveBody:
    // false) — a body inside the car shoves it (the entry/exit "pop").
    if (this.phase === 'getin') {
      this.advanceGetin(step);
    } else if (this.phase === 'shuffle') {
      this.advanceShuffle(step);
    } else if (this.phase === 'exiting') {
      this.advanceGetout(step);
    } else if ((this.phase === 'seated' || this.phase === 'stopping') && this.active) {
      this.driveSeated(this.active, step);
    }
  }

  /** The car the player is currently in/entering (for debug actions like flip), or null on foot. */
  getActive(): EnterableVehicle | null {
    return this.active;
  }

  /** Whether the seated driver is braking right now (for the brake lights). False unless actively driving. */
  isBraking(): boolean {
    return this.isSeated() && this.braking;
  }

  /**
   * Whether this system OWNS the player's pose right now — it is teleporting the rider along the climb-in /
   * seat / climb-out path, so a renderer must not apply its own walking rules (ground snap, locomotion
   * heading) on top. True from the moment the climb-in slide starts until the climb-out slide ends; merely
   * WALKING to the door is not riding.
   */
  isRiding(): boolean {
    return (
      this.phase === 'getin' ||
      this.phase === 'shuffle' ||
      this.phase === 'exiting' ||
      this.phase === 'exitopen' ||
      this.isSeated()
    );
  }

  /** Whether the player is seated in (driving) the active car — distinct from merely approaching/exiting. */
  isSeated(): boolean {
    return this.phase === 'seated' || this.phase === 'stopping';
  }

  /** Drop a (parked, unoccupied) car when it is unloaded. No-op if it is the active car. */
  remove(vehicle: EnterableVehicle): void {
    if (this.active === vehicle) {
      return;
    }
    const index = this.vehicles.indexOf(vehicle);
    if (index >= 0) {
      this.vehicles.splice(index, 1);
    }
    this.doors.delete(vehicle);
  }

  update(delta: number): void {
    const pressed = this.input.isActive('enterExit');
    const edge = pressed && !this.enterHeld;
    this.enterHeld = pressed;
    if (edge && this.phase === 'idle') {
      this.beginApproach();
    } else if (edge && this.phase === 'seated') {
      this.phase = 'stopping'; // brake to a halt first, then climb out (no exiting a moving car)
    }

    if (this.phase === 'approaching') {
      this.updateApproachCancel(delta); // movement input / a blocked path hands control back
    }
    if (this.phase === 'approaching' && this.controller.arrived) {
      this.phase = 'opening';
      this.doorTarget = this.openAngle();
    }
    // Shut the exit door behind the player once he has stepped clear (field 2026-07-24: it must
    // close — just never through him standing in the doorway). Before animateDoor so the swing
    // starts this same frame.
    if (this.closeDoorWhenClear && this.phase === 'idle' && this.active && this.playerClearOf(this.active)) {
      this.doorTarget = 0;
      this.closeDoorWhenClear = false;
    }
    // The getin/exiting slides + seated ride run on the fixed step (see fixedUpdate).
    this.animateDoor(delta);
    if (this.phase === 'opening' && this.doorAngleOf(this.active) === this.openAngle()) {
      this.startStepin();
    }
    if (this.phase === 'stepin' && this.controller.arrived) {
      this.startGetin();
    }
    if (this.phase === 'exitopen' && this.doorAngleOf(this.active) === this.openAngle()) {
      this.startGetout();
    }
    // After exiting, only let the player collide with cars again once he's stepped clear —
    // restoring it while he still overlaps the body would shove the (dynamic) car.
    if (this.restoreWhenClear && this.phase === 'idle' && this.active && this.playerClearOf(this.active)) {
      this.physics.ignoreVehicles(this.playerCollider, false);
      this.restoreWhenClear = false;
    }
  }

  /** Move the player from the door to the seat along the climb-in clip's root path; then sit. */
  private advanceGetin(delta: number): void {
    if (this.active) {
      this.physics.holdBody(this.active.body, this.holdPos, this.holdQuat); // pin the parked car
    }
    this.getinElapsed += delta;
    const duration = this.getinMotion?.duration ?? GETIN_DURATION;
    const t = Math.min(this.getinElapsed / duration, 1);
    this.placePlayer(
      warpAlongRootMotion(this.getinFrom, this.seatWorld, this.getinMotion, t, this.active?.heading ?? 0),
    );
    if (t >= 1) {
      if (this.side === 'rf') {
        this.startShuffle();
      } else {
        this.startSeated();
      }
    }
  }

  /** Move the player from the seat back to the doorway along the climb-out clip's root path. */
  private advanceGetout(delta: number): void {
    if (this.active) {
      this.physics.holdBody(this.active.body, this.holdPos, this.holdQuat); // pin the parked car
    }
    this.exitElapsed += delta;
    const duration = this.getoutMotion?.duration ?? GETOUT_DURATION;
    const t = Math.min(this.exitElapsed / duration, 1);
    this.placePlayer(warpAlongRootMotion(this.exitFrom, this.exitTo, this.getoutMotion, t, this.active?.heading ?? 0));
    if (t >= 1) {
      this.finishExit();
    }
  }

  /** Advance the kerb-side shuffle to the driver seat (088/09b) — same warp as the climb-in. */
  private advanceShuffle(delta: number): void {
    if (this.active) {
      this.physics.holdBody(this.active.body, this.holdPos, this.holdQuat); // pin the parked car
    }
    this.shuffleElapsed += delta;
    const duration = this.shuffleMotion?.duration ?? SHUFFLE_DURATION;
    const t = Math.min(this.shuffleElapsed / duration, 1);
    this.placePlayer(
      warpAlongRootMotion(this.shuffleFrom, this.seatWorld, this.shuffleMotion, t, this.active?.heading ?? 0),
    );
    if (t >= 1) {
      this.startSeated();
    }
  }

  /** Move the active car's SEQUENCE door toward {@link doorTarget} — and always ease the OTHER
   *  door shut: an exit that picks the opposite side used to strand the entry door mid-swing
   *  (it read as "the driver door opened" while the body left through the passenger side). */
  private animateDoor(delta: number): void {
    if (!this.active) {
      return;
    }
    const angles = this.doors.get(this.active) ?? { lf: 0, rf: 0 };
    for (const side of ['lf', 'rf'] as const) {
      const target = side === this.side ? this.doorTarget : 0;
      const angle = angles[side];
      if (angle === target) {
        continue;
      }
      const remaining = target - angle;
      angles[side] = angle + Math.sign(remaining) * Math.min(Math.abs(remaining), DOOR_SPEED * delta);
      this.active.handle.setDoorAngle(side, angles[side]);
    }
    this.doors.set(this.active, angles);
  }

  /** Lock onto the nearest in-range car and send the player to its driver door. */
  private beginApproach(): void {
    const nearest = this.nearestEnterable();
    if (!nearest) {
      return;
    }

    this.active = nearest;
    this.closeDoorWhenClear = false; // entering again — the entry flow owns the door now
    // The NEAR front door (088/09b): a passenger-side approach uses the rf door + the seat shuffle,
    // instead of hiking around the car to the driver door.
    this.side = this.playerLocal(nearest)[0] > 0 ? 'rf' : 'lf';
    this.phase = 'approaching';
    this.approachHeld = 0;
    this.approachStalled = 0;
    this.approachLast = this.playerPosition();
    // Stop the player shoving the dynamic car while walking to the door / climbing in.
    this.physics.ignoreVehicles(this.playerCollider, true);
    this.restoreWhenClear = false; // entering again — keep ignoring cars
    this.controller.runPath(this.doorApproachPath(nearest, this.side));
    this.logger.debug('enter-vehicle', 'approach');
  }

  /** Abort an in-progress run-to-door: restore manual control and go idle. The player keeps ignoring the
   *  car until he steps clear (reuses the post-exit cleanup), so he doesn't shove it while standing next to it. */
  private cancelApproach(): void {
    this.controller.runPath([]); // empty path → manual control resumes next step
    this.phase = 'idle';
    this.restoreWhenClear = true; // re-collide with the car once the player walks clear (see update)
    this.approachHeld = 0;
    this.approachStalled = 0;
    this.logger.debug('enter-vehicle', 'approach cancelled');
  }

  /** The first clear crawl spot around a WRECK (roof-down OR on its side — the yaw-planar probe
   *  covers both): right side → left side → nose → tail; null when boxed in on all four. */
  private clearCrawlSpot(vehicle: EnterableVehicle): null | { local: [number, number]; target: Vec3 } {
    const [hx, hy] = vehicle.halfExtents;
    const candidates: [number, number][] = [
      [hx + DOORWAY_CLEAR + 0.4, vehicle.seatLocal[1]],
      [-(hx + DOORWAY_CLEAR + 0.4), vehicle.seatLocal[1]],
      [0, hy + 1.2],
      [0, -(hy + 1.2)],
    ];
    for (const local of candidates) {
      const target = this.crawlTargetAt(vehicle, local);
      if (this.pathClearTo(vehicle, target)) {
        return { local, target };
      }
    }

    return null;
  }

  /** The first FRONT door whose egress ray is clear, driver side first — or null when both are blocked. */
  private clearDoorSide(vehicle: EnterableVehicle): DoorSide | null {
    const [hx] = vehicle.halfExtents;
    for (const side of ['lf', 'rf'] as const) {
      this.side = side;
      // Probe PAST the doorway spot: a wall just beyond it still blocks the standing body there.
      const target = this.toWorld(vehicle, [sideSign(side) * (hx + DOORWAY_CLEAR + 0.6), vehicle.seatLocal[1]]);
      if (this.pathClearTo(vehicle, target)) {
        return side;
      }
    }

    return null;
  }

  /** Standing spot a crawl-out ends at, from a vehicle-local planar offset. The z is the real
   *  ground there LIFTED to capsule centre — anchoring at the ground itself buried half the capsule
   *  and stuck it in the collision (fell through / froze, field 2026-07-24). */
  private crawlTargetAt(vehicle: EnterableVehicle, local: [number, number]): Vec3 {
    const spot = this.toWorld(vehicle, local);
    const ground = this.physics.groundBelow([spot[0], spot[1], vehicle.position[2] + 1.5], 4, vehicle.body);

    return [spot[0], spot[1], ground === null ? spot[2] : ground + PLAYER_STAND_LIFT];
  }

  private doorAngleOf(vehicle: EnterableVehicle | null): number {
    return vehicle ? (this.doors.get(vehicle)?.[this.side] ?? 0) : 0;
  }

  /**
   * A world-space path (Z-up) to the standing spot outside `side`'s front door (088/09b). The door is
   * always on the PLAYER'S side of the car now, so the approach is straight — no bumper routing.
   */
  private doorApproachPath(vehicle: EnterableVehicle, side: DoorSide): Vec3[] {
    const [hx] = vehicle.halfExtents;
    const sign = sideSign(side);
    const hinge = vehicle.handle.doorHinge(side);
    const entry: [number, number] = [(hinge?.[0] ?? sign * hx) + sign * DOOR_STANDOFF, hinge?.[1] ?? 0];

    return [this.toWorld(vehicle, entry)];
  }

  /** Standing spot in the open doorway of the sequence's side, aligned with the seat row. */
  private doorwayWorld(vehicle: EnterableVehicle): Vec3 {
    const [hx] = vehicle.halfExtents;

    return this.toWorld(vehicle, [sideSign(this.side) * (hx + DOORWAY_CLEAR), vehicle.seatLocal[1]]);
  }

  /**
   * Drive the seated car from WSAD via the raycast controller: engine force toward
   * a handling-scaled top speed, braking / reverse on back, and slewed front-wheel
   * steering (lock shrinks with speed). Forces are integrated by the physics step.
   */
  private drive(car: EnterableVehicle, step: number): void {
    const stopping = this.phase === 'stopping'; // braking to a halt before the player climbs out
    const move = this.input.move();
    const throttle = stopping ? 0 : move.y;
    const steerInput = stopping ? 0 : move.x;
    const handbrake = stopping || this.input.isActive('jump'); // Space = brake / handbrake
    const hnd = car.handling;
    // Real forward speed from the body's *horizontal* velocity (the controller's
    // currentVehicleSpeed carries a phantom ~0.95 at rest → would misread reverse).
    const [vx, vy] = this.physics.getLinvel(car.body);
    const speed = -vx * Math.sin(car.heading) + vy * Math.cos(car.heading);
    if (stopping && Math.abs(speed) <= STOP_THRESHOLD) {
      this.startExit(); // stopped → begin the climb-out

      return;
    }
    const topSpeed = Math.max(MIN_TOP_SPEED, hnd.maxVelocity * MAXVEL_SCALE);
    const engineForce = hnd.mass * hnd.engineAccel * ENGINE_ACCEL_SCALE;
    const brakeForce = BRAKE_FORCE * (hnd.brakeDecel / BRAKE_DECEL_REF);

    let targetEngine = 0;
    let brake = 0;
    if (handbrake) {
      brake = brakeForce; // Space overrides → brake to a stop / hold
    } else if (throttle > 0) {
      targetEngine = speed < topSpeed ? engineForce : 0;
    } else if (throttle < 0) {
      if (speed > REVERSE_SPEED_EPS) {
        brake = brakeForce; // moving forward → brake
      } else {
        // The raycast controller won't start reverse from a dead stop; seed a small
        // backward velocity until it's rolling, then the engine force sustains it.
        if (speed > -REVERSE_SEED_SPEED) {
          this.physics.seedReverse(car.body, car.heading, REVERSE_SEED_SPEED);
        }
        targetEngine = speed > -topSpeed * REVERSE_FRACTION ? -engineForce * REVERSE_FRACTION : 0;
      }
    } else {
      brake = brakeForce * IDLE_BRAKE_FRACTION; // coast to a stop off-throttle
    }
    // Brake lights: full braking only (handbrake / braking forward motion sets brake = brakeForce), not the
    // light idle-coast brake or reverse (which drives the engine, leaving brake at 0).
    this.braking = brake === brakeForce;

    // Ramp the engine force toward its target so sudden throttle doesn't jolt the
    // suspension (a visible launch hop); braking stays instant.
    const rampStep = (engineForce / ENGINE_RAMP_TIME) * step;
    this.engine += clamp(targetEngine - this.engine, -rampStep, rampStep);

    // Ease the steering toward the input (gentle turn-in, quicker return to centre);
    // the usable lock shrinks toward top speed so it doesn't twitch at speed.
    const speedFactor = Math.min(Math.abs(speed) / topSpeed, 1);
    const lock = ((hnd.steeringLock * Math.PI) / 180) * STEER_LOCK_SCALE * (1 - speedFactor * STEER_SPEED_FALLOFF);
    const target = -steerInput * lock; // D (right) turns the car right
    const rate = steerInput === 0 ? STEER_RECENTER_RATE : STEER_RATE;
    this.steerAngle += clamp(target - this.steerAngle, -rate * step, rate * step);

    this.physics.setVehicleControls(car.controller, car.wheels, this.engine, brake, this.steerAngle);
    car.rig.setSteer(this.steerAngle); // front wheels turn with the physics steer
  }

  /** Drive the seated car and snap the rider onto its (full-transform) seat. */
  private driveSeated(car: EnterableVehicle, step: number): void {
    const { position, quaternion } = this.physics.readBody(car.body);
    car.position[0] = position[0];
    car.position[1] = position[1];
    car.position[2] = position[2];
    car.heading = headingFromQuat(quaternion);
    this.drive(car, step);
    if (this.phase === 'exiting' || this.phase === 'idle') {
      // The exit consumed this step (a crawl-out began / the roof fallback placed the player) —
      // re-seating now would clobber the crawl clip. `exitopen` still seats: the door is only opening.
      return;
    }

    // Seat the rider via the car's FULL transform so he tilts/flips with it (not just yaw).
    this.seatQuat.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
    this.seatOffset
      .set(car.seatLocal[0], car.seatLocal[1], car.seatLocal[2] + SEAT_RAISE)
      .applyQuaternion(this.seatQuat);
    this.placePlayer([
      position[0] + this.seatOffset.x,
      position[1] + this.seatOffset.y,
      position[2] + this.seatOffset.z,
    ]);
    this.animation.setScripted(CAR_SIT, { loop: true, orientation: quaternion });
  }

  /** Out of the car: restore manual control + locomotion, face away from the car, shut the door. */
  private finishExit(): void {
    const heading = this.active?.heading ?? 0;
    // Yaw facing out of the used doorway (mirrored on a passenger-side exit), away from the car body.
    const outward =
      this.side === 'lf'
        ? Math.atan2(Math.cos(heading), -Math.sin(heading))
        : Math.atan2(-Math.cos(heading), Math.sin(heading));
    this.placePlayer(this.exitTo);
    this.followTarget(null); // back to following the player on foot
    this.animation.setScripted(null);
    this.animation.faceTo(outward);
    this.aimCamera(outward); // swing the camera behind the player so forward goes away from the car
    this.physics.setColliderSensor(this.playerCollider, false); // solid again — walking
    this.restoreWhenClear = true; // re-enable car collision once the player has stepped clear (update)
    this.controller.setEnabled(true);
    // The door closes only once the player has STEPPED CLEAR (see update) — closing it now would
    // sweep the panel straight through him standing in the doorway (field 2026-07-24).
    this.doorTarget = this.doorAngleOf(this.active);
    this.closeDoorWhenClear = true;
    this.phase = 'idle';
    this.logger.log('enter-vehicle', 'exited');
  }

  /** True if the car is roughly the right way up (its local +Z still points mostly up). */
  private isUpright(vehicle: EnterableVehicle): boolean {
    const [x, y] = this.physics.readBody(vehicle.body).quaternion;

    return 1 - 2 * (x * x + y * y) > UPRIGHT_MIN; // world-Z component of the body's local up
  }

  /** The nearest upright car within enter range, or null — the car Enter would target from idle. */
  private nearestEnterable(): EnterableVehicle | null {
    const [px, py] = this.playerPosition();
    let nearest: EnterableVehicle | null = null;
    let nearestDistance = ENTER_RANGE * ENTER_RANGE;
    for (const vehicle of this.vehicles) {
      // Can't get into an overturned / on-its-side car (must be roughly on its wheels).
      if (!this.isUpright(vehicle)) {
        continue;
      }
      const dx = vehicle.position[0] - px;
      const dy = vehicle.position[1] - py;
      const distance = dx * dx + dy * dy;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = vehicle;
      }
    }

    return nearest;
  }

  /** The sequence door's fully-open angle — the driver-side sign, mirrored for the passenger door. */
  private openAngle(): number {
    return this.side === 'lf' ? DOOR_OPEN_ANGLE : -DOOR_OPEN_ANGLE;
  }

  /** Whether the egress toward `target` is unobstructed (the car excluded): two HORIZONTAL rays at
   *  fixed heights above the car's ground contact (knee 0.35 m + chest 0.85 m). Heights anchored to
   *  the car CENTRE grazed the road on cambered streets and false-blocked the driver door — the exit
   *  then silently went out the passenger side (field 2026-07-24). */
  private pathClearTo(vehicle: EnterableVehicle, target: Vec3): boolean {
    const { position } = this.physics.readBody(vehicle.body);
    // Anchor the ray heights to the REAL ground under the car: `position.z − hz` sat BELOW the road
    // for real models (the bbox is roof-heavy, the origin near the axles), so the knee ray grazed
    // the asphalt and false-blocked whichever side faced the road crown (field 2026-07-24 ×2).
    const ground = this.physics.groundBelow([position[0], position[1], position[2] + 0.5], 5, vehicle.body);
    const base = ground ?? position[2] - vehicle.halfExtents[2];
    for (const height of [0.35, 0.85]) {
      const z = base + height;
      if (!this.physics.pathClear([position[0], position[1], z], [target[0], target[1], z], vehicle.body)) {
        return false;
      }
    }

    return true;
  }

  /** True once the player is outside the car's footprint (+ clearance) — safe to re-collide. */
  private playerClearOf(vehicle: EnterableVehicle): boolean {
    const [hx, hy] = vehicle.halfExtents;
    const [lx, ly] = this.playerLocal(vehicle);

    return Math.abs(lx) > hx + VEHICLE_CLEARANCE || Math.abs(ly) > hy + VEHICLE_CLEARANCE;
  }

  /** Player position in the vehicle's local frame (planar). */
  private playerLocal(vehicle: EnterableVehicle): [number, number] {
    const [px, py] = this.playerPosition();
    const dx = px - vehicle.position[0];
    const dy = py - vehicle.position[1];
    const cos = Math.cos(vehicle.heading);
    const sin = Math.sin(vehicle.heading);

    return [dx * cos + dy * sin, -dx * sin + dy * cos];
  }

  /** World seat position (Z-up): seat dummy in vehicle space → world, raised onto the capsule centre.
   *  The passenger seat is the driver seat mirrored to +X (088/09b). */
  private seatWorldOf(vehicle: EnterableVehicle, seat: 'driver' | 'passenger' = 'driver'): Vec3 {
    const seatX = seat === 'passenger' ? -vehicle.seatLocal[0] : vehicle.seatLocal[0];
    const [wx, wy] = this.toWorld(vehicle, [seatX, vehicle.seatLocal[1]]);

    return [wx, wy, vehicle.position[2] + vehicle.seatLocal[2] + SEAT_RAISE];
  }

  /** Crawl out (overturned / windscreen egress, 088/09d): no door swing, the crawl clip's root motion
   *  carries the low scramble; reuses the exiting phase's warp. */
  private startCrawlout(target: Vec3): void {
    if (!this.active) {
      return;
    }
    this.phase = 'exiting';
    this.exitElapsed = 0;
    this.exitFrom = this.playerPosition();
    this.exitTo = target;
    this.getoutMotion = this.animation.scriptedMotion(CAR_CRAWLOUT);
    this.storeHold(this.active);
    this.animation.setScripted(CAR_CRAWLOUT, { facing: this.active.heading, loop: false });
  }

  /** Settled in the seat + Enter → park (brake to a stop) and open the door to climb back out. */
  private startExit(): void {
    if (!this.active) {
      return;
    }
    this.physics.parkVehicle(this.active.controller); // hold the car still while CJ climbs out
    this.steerAngle = 0;
    this.active.rig.setSteer(0);
    if (!this.isUpright(this.active)) {
      // A WRECK (roof-down or on its side): probe the four planar exits and crawl out the first
      // clear one — a side-lying car has one door against the ground, so nothing is assumed. The
      // door that swings is the one on the CHOSEN flank (a fixed rf swing read as "the wrong door
      // opened" in the field); nose/tail crawls swing nothing. All four blocked → appear on top.
      const spot = this.clearCrawlSpot(this.active);
      this.logger.log('enter-vehicle', `egress wreck ${spot ? `crawl [${spot.local.join(',')}]` : 'boxed in'}`);
      if (spot) {
        if (spot.local[0] !== 0) {
          this.side = spot.local[0] > 0 ? 'rf' : 'lf';
          this.doorTarget = this.openAngle();
        }
        this.startCrawlout(spot.target);

        return;
      }
      const top = Math.max(...this.active.halfExtents);
      this.exitTo = [this.active.position[0], this.active.position[1], this.active.position[2] + top + 1];
      this.finishExit();

      return;
    }
    // The 09d egress chain: driver door → passenger door → windscreen → appear on the car. A ray
    // from the car's centre to each spot decides "blocked" (a wall/car inside it).
    const side = this.clearDoorSide(this.active);
    this.logger.log('enter-vehicle', `egress ${side ?? 'doors blocked'}`);
    if (side) {
      this.side = side;
      this.phase = 'exitopen';
      this.doorTarget = this.openAngle();

      return;
    }
    const windscreen = this.crawlTargetAt(this.active, [0, this.active.halfExtents[1] + 1.2]);
    if (this.pathClearTo(this.active, windscreen)) {
      this.startCrawlout(windscreen);

      return;
    }
    // Everything around is blocked — appear on top of the car (the honest last resort, no clip).
    const [, , hz] = this.active.halfExtents;
    this.exitTo = [this.active.position[0], this.active.position[1], this.active.position[2] + hz + 1];
    this.finishExit();
  }

  /** At the doorway → gate the player, start the climb-in clip and slide to the seat. */
  private startGetin(): void {
    if (!this.active) {
      return;
    }
    this.phase = 'getin';
    this.getinElapsed = 0;
    this.getinFrom = this.playerPosition();
    const clip = this.side === 'rf' ? CAR_GETIN_RHS : CAR_GETIN;
    this.getinMotion = this.animation.scriptedMotion(clip);
    // A passenger-door entry climbs into the PASSENGER seat first; the shuffle crosses after.
    this.seatWorld = this.seatWorldOf(this.active, this.side === 'rf' ? 'passenger' : 'driver');
    this.storeHold(this.active); // pin the parked car here while the player climbs in
    this.controller.setEnabled(false);
    this.physics.setColliderSensor(this.playerCollider, true); // rider = sensor → can't shove the car
    this.animation.setScripted(this.side === 'rf' ? CAR_GETIN_RHS : CAR_GETIN, {
      facing: this.active.heading,
      loop: false,
    });
  }

  /** Door is open → play the climb-out clip and slide from the seat to the doorway. */
  private startGetout(): void {
    if (!this.active) {
      return;
    }
    this.phase = 'exiting';
    this.exitElapsed = 0;
    this.exitFrom = this.playerPosition();
    this.exitTo = this.doorwayWorld(this.active);
    this.getoutMotion = this.animation.scriptedMotion(this.side === 'rf' ? CAR_GETOUT_RHS : CAR_GETOUT);
    this.storeHold(this.active); // pin the (stopped) car here while the player climbs out
    this.animation.setScripted(this.side === 'rf' ? CAR_GETOUT_RHS : CAR_GETOUT, {
      facing: this.active.heading,
      loop: false,
    });
  }

  /** Settle into the seat: hold the driving pose and shut the door. */
  private startSeated(): void {
    if (!this.active) {
      return;
    }
    this.phase = 'seated';
    this.engine = 0; // start from idle; drive() ramps the throttle
    this.steerAngle = 0; // start straight; drive() takes over the wheels from here
    this.placePlayer(this.seatWorld);
    this.animation.setScripted(CAR_SIT, { facing: this.active.heading, loop: true });
    this.followTarget(this.active); // track the car (smooth) — not the per-frame-teleported rider
    this.aimCamera(this.active.heading); // centre behind the rear once; free to orbit while driving
    this.doorTarget = 0; // pull the door shut from inside
    this.logger.log('enter-vehicle', 'seated');
  }

  /** Passenger-door entry reached the passenger seat → slide across to the driver seat (088/09b). */
  private startShuffle(): void {
    if (!this.active) {
      return;
    }
    this.phase = 'shuffle';
    this.shuffleElapsed = 0;
    this.shuffleFrom = this.playerPosition();
    this.shuffleMotion = this.animation.scriptedMotion(CAR_SHUFFLE);
    this.seatWorld = this.seatWorldOf(this.active, 'driver');
    this.doorTarget = 0; // pull the passenger door shut while sliding across
    this.animation.setScripted(CAR_SHUFFLE, { facing: this.active.heading, loop: false });
  }

  /** Door is open → walk AROUND the open panel into the doorway (088/09c): back along the outside
   *  of the door's swept arc at the standoff distance (the panel at 60° reaches ~0.9 m out — inside
   *  the 1.2 m standoff ring), then straight in from abeam the seat. The old single-waypoint path cut
   *  a diagonal THROUGH the open panel. */
  private startStepin(): void {
    if (!this.active) {
      return;
    }
    this.phase = 'stepin';
    const [hx] = this.active.halfExtents;
    const sign = sideSign(this.side);
    const hinge = this.active.handle.doorHinge(this.side);
    const standoffX = (hinge?.[0] ?? sign * hx) + sign * DOOR_STANDOFF;
    // Three legs, all outside the open panel (field 2026-07-24 — the two-leg path still clipped it):
    // back along the standoff ring past the panel's swept rear edge, inboard BEHIND the panel, then
    // forward along the body into the doorway.
    const behindY = Math.min(this.active.seatLocal[1], (hinge?.[1] ?? 0) - DOOR_SWEPT_CLEARANCE);
    this.controller.runPath([
      this.toWorld(this.active, [standoffX, behindY]),
      this.toWorld(this.active, [sign * (hx + DOORWAY_CLEAR), behindY]),
      this.doorwayWorld(this.active),
    ]);
  }

  /** Snapshot the car's current transform so {@link advanceGetin}/{@link advanceGetout} can pin it. */
  private storeHold(car: EnterableVehicle): void {
    const { position, quaternion } = this.physics.readBody(car.body);
    this.holdPos = [position[0], position[1], position[2]];
    this.holdQuat = [quaternion[0], quaternion[1], quaternion[2], quaternion[3]];
  }

  /** A vehicle-local planar point → world point (Z-up), at the car's height. */
  private toWorld(vehicle: EnterableVehicle, local: [number, number]): Vec3 {
    const cos = Math.cos(vehicle.heading);
    const sin = Math.sin(vehicle.heading);

    return [
      vehicle.position[0] + local[0] * cos - local[1] * sin,
      vehicle.position[1] + local[0] * sin + local[1] * cos,
      vehicle.position[2],
    ];
  }

  /**
   * GTA-style interrupt of the run-to-door (only while 'approaching'): movement input hands control back
   * after a short hold (a slight lag, not an instant cancel on a stray tap); and a blocked path — no planar
   * progress for {@link APPROACH_STALL_TIMEOUT} — auto-cancels so Tommy doesn't run in place forever.
   */
  private updateApproachCancel(delta: number): void {
    const move = this.input.move();
    const moving = move.x !== 0 || move.y !== 0;
    this.approachHeld = moving ? this.approachHeld + delta : 0;

    const [px, py] = this.playerPosition();
    const progressed = Math.hypot(px - this.approachLast[0], py - this.approachLast[1]) > APPROACH_STALL_EPSILON;
    this.approachLast = [px, py, 0];
    this.approachStalled = progressed ? 0 : this.approachStalled + delta;

    if (this.approachHeld >= APPROACH_CANCEL_HOLD || this.approachStalled >= APPROACH_STALL_TIMEOUT) {
      this.cancelApproach();
    }
  }
}

/**
 * A point along a scripted move (plan 088/09a): the clip's authored root path carries the SHAPE
 * (the doorway dip, the drop into the seat) while a linear correction distributes the clip-vs-world
 * endpoint mismatch — the move still starts exactly at `from` and ends exactly at `to`. The clip's
 * ped-local frame maps through the facing `heading` (x = right, y = forward, z = up). Without a
 * motion (a TC whose IFP lacks the clip) it degrades to the straight slide. Pure + exported so the
 * warp guarantees are unit-testable.
 */
export function warpAlongRootMotion(
  from: Vec3,
  to: Vec3,
  motion: null | ScriptedMotion,
  t: number,
  heading: number,
): Vec3 {
  if (!motion) {
    return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
  }
  const start = motion.sample(0);
  const now = motion.sample(t * motion.duration);
  const end = motion.sample(motion.duration);
  const forward: [number, number] = [-Math.sin(heading), Math.cos(heading)];
  const right: [number, number] = [Math.cos(heading), Math.sin(heading)];
  const world = (p: readonly [number, number, number]): Vec3 => [
    right[0] * (p[0] - start[0]) + forward[0] * (p[1] - start[1]),
    right[1] * (p[0] - start[0]) + forward[1] * (p[1] - start[1]),
    p[2] - start[2],
  ];
  const path = world([now[0], now[1], now[2]]);
  const total = world([end[0], end[1], end[2]]);

  return [
    from[0] + path[0] + (to[0] - from[0] - total[0]) * t,
    from[1] + path[1] + (to[1] - from[1] - total[1]) * t,
    from[2] + path[2] + (to[2] - from[2] - total[2]) * t,
  ];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Yaw about +Z from a body quaternion `[x, y, z, w]` (the car's heading), via its forward (+Y). */
function headingFromQuat(q: readonly number[]): number {
  const [x, y, z, w] = q;
  const forwardX = 2 * (x * y - w * z);
  const forwardY = 1 - 2 * (x * x + z * z);

  return Math.atan2(-forwardX, forwardY);
}
