/**
 * Vehicles on the own engine (plan 074/08 B5 step 4) — the `?engine=opensa` twin of canvas-host's vehicle
 * block. Every gameplay system here is REUSED verbatim (enter/exit, driving, physics, damage, LOD); the only
 * new code is the wiring, because the systems now speak {@link VehicleHandle} instead of three objects.
 *
 * The model cache is the point of the B5 engine work: one uploaded model per CAR TYPE, one instance per car.
 * A street of Landstalkers shares its geometry and its texture array, and differs only by part matrices and
 * a four-colour paint slot.
 */
import type { Engine, VehicleInstance, VehicleModelId } from '@opensa/engine';
import type { EngineVehicleData, GtaSaWorldAdapter } from '@opensa/game/adapters/gta-sa-world.adapter';
import type { CharacterControllerSystem } from '@opensa/game/character/character-controller.system';
import type { Logger } from '@opensa/game/diagnostics/logger';
import type { InputState } from '@opensa/game/input';
import type { Config } from '@opensa/game/interfaces/config.interface';
import type { Vec3 } from '@opensa/game/interfaces/world-adapter.interface';
import type { PhysicsWorld, VehicleSpringReading, VehicleStance } from '@opensa/game/physics/physics-world';
import type { EnterableVehicle, VehicleAnimator } from '@opensa/game/vehicle/enter-vehicle.system';
import type { SpawnedVehicle, VehiclePlacement } from '@opensa/game/vehicle/vehicle-lod.system';
import type { PlatePlacement } from '@opensa/game/vehicle/vehicle-plates';
import type { CityBox } from '@opensa/game/zones/city';

import { frameSpans, PLATE_CAPACITY } from '@opensa/engine';
import { EngineVehicleHandle, gtaPositionToEngine } from '@opensa/game/adapters/engine-vehicle-handle';
import { EnterVehicleSystem } from '@opensa/game/vehicle/enter-vehicle.system';
import { composePlateText, plateBackgroundIndex } from '@opensa/game/vehicle/plate-raster';
import { BLANK_PLATE_SLOT, PlateSlots } from '@opensa/game/vehicle/plate-slots';
import { STRONG_HIT, VehicleDamageSystem } from '@opensa/game/vehicle/vehicle-damage.system';
import { VehicleLampSystem } from '@opensa/game/vehicle/vehicle-lamp.system';
import { VehicleLodSystem } from '@opensa/game/vehicle/vehicle-lod.system';
import { VehiclePhysicsSystem } from '@opensa/game/vehicle/vehicle-physics.system';
import { resolvePlate } from '@opensa/game/vehicle/vehicle-plates';
import { VehicleRig } from '@opensa/game/vehicle/vehicle-rig';
import { seatVehicleOnGround } from '@opensa/game/vehicle/vehicle-seating';
import { VehicleSkidMarkSystem } from '@opensa/game/vehicle/vehicle-skid-marks.system';
import { planarMotion, type PlanarMotion, VehicleTelemetry } from '@opensa/game/vehicle/vehicle-telemetry';
import {
  TYRE_SMOKE_DEFAULTS,
  type TyreSmokeDials,
  VehicleTyreSmokeSystem,
} from '@opensa/game/vehicle/vehicle-tyre-smoke.system';

import type { DynamicFxEmitter } from './engine-particles';

import { parseParkedVehicles } from '../parked-vehicles';

export interface EngineVehicles {
  /** The car the player is seated in, or null — the host follows it with the camera. */
  activeVehicle(): EnterableVehicle | null;
  /**
   * Apply the driven car's controls — call BEFORE the physics step (plan 081/02 §4). Without it the systems
   * still drive, one step late; with it a press reaches the wheels in the step it was made.
   */
  applyControls(step: number): void;
  /**
   * The driven car's speed and slip RIGHT NOW, or null on foot (plan 080/05's drift framing reads it every
   * rendered frame). Deliberately not behind {@link EngineVehicles.telemetry}'s capture gate: this is four
   * dot products off the body, while a capture is the ring plus the per-wheel channels. Same
   * `planarMotion` either way, so the camera and a capture can never disagree about a slide's direction.
   */
  drivenMotion(): null | PlanarMotion;
  /**
   * FIXED step — must be called from the host's fixed loop, AFTER the physics step. Enter/exit does all its
   * rider placement and its driving here (prod's `Game` runs every system's `fixedUpdate` before `update`).
   * Skipping this leaves the sequence frozen mid-climb-in: the controller stays disabled, the door stays
   * open and the car never drives — the phase machine simply never advances.
   */
  fixedUpdate(step: number): void;
  /**
   * The hardest contact force the DRIVEN car took this frame (N), 0 on foot or when nothing hit it — the
   * camera's impact shake (plan 080/06). It comes from the damage system's own collision observation
   * because `physics.takeImpacts()` drains: a second listener would race it and one of them would see
   * nothing.
   */
  impactForce(): number;
  /** True while a scripted enter/exit is mid-sequence — the camera glides to its target instead of
   *  auto-centering on the ped's approach/climb twitches. */
  isSettling(): boolean;
  /** Register placements to spawn LAZILY by distance (the LOD system streams them) — the bench road cars. */
  register(placements: readonly VehiclePlacement[]): void;
  /**
   * The car whose pose OWNS the player right now — from the start of the climb-in slide to the end of the
   * climb-out one, not merely while walking to the door. The host must switch its walking rules off for it
   * (ground snap, locomotion heading), else the rider floats above the roof through the whole climb-in.
   */
  ridingVehicle(): EnterableVehicle | null;
  /**
   * Put the player straight into the nearest car, skipping the walk/door/climb-in (plan 081/01). False when
   * nothing is in range or a sequence is already running. For automation that measures DRIVING — a scripted
   * lap must not lose its baseline to a walk-in that cancelled itself.
   */
  seatInstantly(): boolean;
  /** Spawn a car and register it with the LOD system (persists like a parked car) — used for test spawns. */
  spawn(placement: VehiclePlacement): Promise<void>;
  /**
   * The driven car's spring setup, or null on foot (plan 081/02). Constant per car, so a capture reads it
   * once — and it exists so a run can SAY what it was configured with. An A/B where the runs cannot be told
   * apart from their own record is not a measurement.
   */
  springs(): null | readonly VehicleSpringReading[];
  /** What the car is STANDING on — see {@link VehicleStance}. Null on foot. */
  stance(): null | VehicleStance;
  /**
   * The driven car's physics telemetry (plan 081/01): speed, slip, per-wheel load and travel, sampled every
   * fixed step while `enabled`. **This is the slip/speed channel plan 080/05 reads for drift framing** —
   * the camera must not re-derive it from poses, or it measures the render loop instead of the physics.
   * Disabled by default and inert then.
   */
  readonly telemetry: VehicleTelemetry;
  /** Per-frame (variable dt): draw cars at the interpolated pose (`alpha` = fraction into the next fixed
   *  step), then input/approach/doors, damage, LOD streaming. */
  update(delta: number, alpha: number): void;
}

export interface EngineVehiclesDeps {
  adapter: GtaSaWorldAdapter;
  /** Turn the follow camera to an azimuth (enter-vehicle centres it behind the car once). */
  aimCamera: (azimuth: number) => void;
  animator: VehicleAnimator;
  /** The city boxes plates read (desert first) — a thunk because they load after this setup runs. */
  cityBoxes: () => readonly CityBox[];
  config: Readonly<Config>;
  engine: Engine;
  /** Camera position (native Z-up) — the lamp coronas fade by how squarely a lamp faces it. */
  eye: () => Vec3;
  fs: { getText(name: string): null | string };
  input: InputState;
  /** Night gate for the lamps (the shared timecyc `dn`, like prod's `isNight`). */
  isNight: () => boolean;
  logger: Logger;
  physics: PhysicsWorld;
  placePlayer: (position: Vec3, moveBody?: boolean) => void;
  playerCollider: number;
  playerController: CharacterControllerSystem;
  playerPosition: () => Vec3;
  /** Session overrides for the tyre-smoke dials (`?smokeStart/?smokeFull/?smokeRate` — 081/09 pattern). */
  smokeDials?: Partial<TyreSmokeDials>;
  /** The dynamic lane's collisionsmoke emitter (089/02); null = no FX library, smoke silently off. */
  smokeEmitter?: DynamicFxEmitter | null;
  viewOf: () => Vec3;
}

export async function setupEngineVehicles(deps: EngineVehiclesDeps): Promise<EngineVehicles> {
  const { adapter, config, engine, physics } = deps;

  // --- License plates (plan 082/04) -------------------------------------------------------------------
  // The rasters come from the game's own `generic/vehicle.txd` via the adapter (the layer that may read
  // renderware). A dictionary we cannot read leaves `plateSources` null and every car keeps the stock
  // placeholder — plates are cosmetic and must never be a reason a car fails to spawn.
  const plateSources = adapter.plateSources();
  const plateSlots = plateSources ? new PlateSlots(engine, PLATE_CAPACITY) : null;
  if (plateSources) {
    engine.uploadPlateBackgrounds(plateSources.backgrounds);
    // Layer 0 is reserved and never handed out — an unassigned car reads it, so it must hold a BLANK
    // plate rather than the uninitialised black the array starts as. Empty text composes eight blank cells.
    engine.uploadPlateText(BLANK_PLATE_SLOT, composePlateText('', plateSources.charset));
  }

  /** Give one spawned car its plate; returns the atlas layer it claimed, so despawn can release it. */
  const dressPlate = (instance: VehicleInstance, placement: PlatePlacement): null | number => {
    if (!plateSources || !plateSlots) {
      return null;
    }
    const plate = resolvePlate(placement, config.vehicle.plates, deps.cityBoxes());
    const slot = plateSlots.claim(plate.text, () => composePlateText(plate.text, plateSources.charset));
    instance.setPlate(slot, plateBackgroundIndex(plate.city));

    return slot;
  };

  const vehiclePhysics = new VehiclePhysicsSystem(physics);
  const vehicleDamage = new VehicleDamageSystem(physics, deps.logger);
  let seated: EnterableVehicle | null = null;

  const enterVehicle = new EnterVehicleSystem(
    deps.input,
    deps.playerPosition,
    deps.playerController,
    deps.placePlayer,
    deps.animator,
    deps.aimCamera,
    (vehicle) => (seated = vehicle), // the host's camera follows the car while seated
    config,
    physics,
    deps.playerCollider,
    deps.logger,
  );

  // Telemetry (plan 081/01): only the DRIVEN car is instrumented — a capture is about the car under the
  // player, and sampling a street of parked cars would cost per step for nothing. Off by default: the
  // `enabled` check comes first so a shipped build does not even read the body.
  // 60 s of fixed steps: the longest scripted scene is 24 s and a capture must hold the WHOLE lap — a ring
  // that wrapped mid-lap would silently drop the launch and report the tail as the run.
  const telemetry = new VehicleTelemetry(3600);
  let instrumented: EnterableVehicle | null = null;
  const stepTelemetry = (step: number): void => {
    const car = enterVehicle.isSeated() ? enterVehicle.getActive() : null;
    if (!telemetry.enabled || car === null) {
      instrumented = car;

      return;
    }
    if (car !== instrumented) {
      // A different car (or the first one this capture): its history belongs to the previous car.
      telemetry.reset();
      instrumented = car;
    }
    const controls = enterVehicle.appliedControls();
    telemetry.step(
      {
        brake: controls.brake,
        engineForce: controls.engineForce,
        gear: controls.gear,
        handbrake: controls.handbrake,
        linvel: physics.getLinvel(car.body),
        orientation: car.orientation,
        position: car.position,
        steer: controls.steer,
        // What each wheel is standing on (081/10 step 4). Only the DRIVEN car is probed, and only while a
        // capture is running — four rays are the same order as the whole controller update (081/07 §3).
        // What each wheel is standing on (081/10 step 4). Only the DRIVEN car is probed, and only while a
        // capture is running — four rays are the same order as the whole controller update (081/07 §3).
        surfaces: physics.readVehicleWheelSurfaces(car.controller, car.body),
        throttle: controls.throttle,
        wheels: physics.readVehicleWheels(car.controller),
      },
      step,
    );
  };

  // Lamps (step 5): the SAME decision logic the three path uses, wired to the engine's light pool and its
  // EXISTING corona pass — no second corona renderer.
  const lamps = new VehicleLampSystem(enterVehicle, deps.isNight, () => config.graphics.headlights, {
    corona: (corona): void => {
      engine.dynamicCoronas.push({
        color: corona.color,
        fade: corona.fade,
        position: gtaPositionToEngine(corona.position),
        size: corona.size,
      });
    },
    eye: deps.eye,
    light: (light): void => {
      engine.dynamicLights.push({
        color: light.color,
        // The cone DIRECTION is a vector, not a point — it takes the same Z-up → Y-up basis change.
        ...(light.cone
          ? {
              cone: {
                cosAngle: light.cone.cosAngle,
                direction: gtaPositionToEngine(light.cone.direction),
              },
            }
          : {}),
        position: gtaPositionToEngine(light.position),
        radius: light.radius,
      });
    },
    reset: (): void => {
      engine.dynamicLights.length = 0;
      engine.dynamicCoronas.length = 0;
    },
  });

  // Tyre smoke (plan 089/02): the driven car's sliding wheels burst collisionsmoke into the dynamic lane
  // (089/01). Signal = contact-patch slide speed (covers burnout, lockup and the handbrake slide with one
  // number); the look mapping is an EYE-FIT — docs/hacks/tyre-smoke-intensity-fit.md. Deliberately not on
  // the telemetry sampler: that is the F2/capture gate, and smoke must not need the debugger open.
  const smokeEmitter = deps.smokeEmitter ?? null;
  const tyreSmoke = new VehicleTyreSmokeSystem(
    () => (enterVehicle.isSeated() ? enterVehicle.getActive() : null),
    physics,
    (puff): void => {
      if (!smokeEmitter) {
        return;
      }
      const [ex, ey, ez] = gtaPositionToEngine(puff.position);
      smokeEmitter.position[0] = ex;
      smokeEmitter.position[1] = ey;
      smokeEmitter.position[2] = ez;
      // Life from intensity: a gentle chirp wisps away (~1.25 s of the authored 5), a hard skid lingers
      // (~2.5 s). Opacity from intensity SQUARED (field round 2): a launch reads ~12 %, a full slide 50 %.
      smokeEmitter.lifeScale = 0.25 + 0.25 * puff.intensity;
      smokeEmitter.alphaScale = 0.1 + 0.4 * puff.intensity * puff.intensity;
      smokeEmitter.burst(puff.count);
    },
    { ...TYRE_SMOKE_DEFAULTS, ...deps.smokeDials },
    () => config.graphics.effects.enabled,
  );

  // Impact smoke (plan 089/04): a puff at the contact point when a hit passes the damage system's
  // strong-hit gate — the same event that deforms a panel, so a kerb tap never puffs. Sized by how far
  // past the gate the force went (an eye-fit — docs/hacks/impact-smoke-fit.md). Reuses the collisionsmoke
  // emitter; a burst is instantaneous, so repositioning the shared emitter per event is safe.
  vehicleDamage.onStrongHit = (force, point): void => {
    if (!smokeEmitter || !config.graphics.effects.enabled) {
      return;
    }
    const [ex, ey, ez] = gtaPositionToEngine([point[0], point[1], point[2]]);
    smokeEmitter.position[0] = ex;
    smokeEmitter.position[1] = ey;
    smokeEmitter.position[2] = ez;
    const severity = Math.min(1, (force - STRONG_HIT) / (3 * STRONG_HIT)); // 1 at ~4× the damage gate
    smokeEmitter.lifeScale = 0.4 + 0.3 * severity;
    smokeEmitter.alphaScale = 0.25 + 0.25 * severity;
    smokeEmitter.burst(3 + Math.round(5 * severity));
  };

  // Skid marks (plan 089/03): the same slide signal, laid down as decal-ribbon segments. The sink converts
  // each corner to engine space; the engine's ring recycles the oldest mark when full and fades on the
  // WALL clock (the brief's 5 real seconds).
  const skidMarks = new VehicleSkidMarkSystem(
    () => (enterVehicle.isSeated() ? enterVehicle.getActive() : null),
    physics,
    (segment): void => {
      engine.addSkidSegment({
        alpha0: segment.alpha0,
        alpha1: segment.alpha1,
        l0: gtaPositionToEngine(segment.left0),
        l1: gtaPositionToEngine(segment.left1),
        r0: gtaPositionToEngine(segment.right0),
        r1: gtaPositionToEngine(segment.right1),
        v0: segment.v0,
        v1: segment.v1,
      });
    },
    () => config.graphics.effects.enabled,
  );

  /**
   * One uploaded engine model per car TYPE — instances share geometry, textures and the pipeline. LRU-BOUNDED
   * (074/21 follow-up, pre-flip fix): types accumulated forever (+950 MB of texture arrays over one bench
   * sweep — the residency field report), so despawning the last instance of a type makes it evictable and
   * the cache trims back to {@link MODEL_CACHE_TEXTURE_BYTES} oldest-first. A re-encountered type rebuilds
   * through the existing worker (spawns already defer, so the ~100–200 ms build never blocks the frame).
   */
  const models = new Map<string, VehicleModelEntry>();
  /** In-flight builds by type — two simultaneous spawns of a NEW type must share one build (the loser used
   *  to overwrite the winner's map entry, leaking the winner's GPU model — harmless before eviction existed,
   *  a real leak now). */
  const pendingModels = new Map<string, Promise<VehicleModelEntry>>();
  const evictModels = (): void => {
    let total = 0;
    for (const entry of models.values()) {
      total += entry.textureBytes;
    }
    while (total > MODEL_CACHE_TEXTURE_BYTES) {
      let lruName: null | string = null;
      let lru: null | VehicleModelEntry = null;
      for (const [name, entry] of models) {
        if (entry.instances === 0 && (lru === null || entry.lastUsed < lru.lastUsed)) {
          lru = entry;
          lruName = name;
        }
      }
      if (lruName === null || lru === null) {
        break; // every cached type has live instances — the budget is a trim floor, not a hard cap
      }
      engine.destroyVehicleModel(lru.id);
      models.delete(lruName);
      total -= lru.textureBytes;
    }
  };
  const buildModel = async (name: string): Promise<VehicleModelEntry> => {
    // The model is colour-AGNOSTIC by construction (paint is a per-vertex slot resolved per instance), so
    // one upload serves every colour of this car — and the DFF is parsed exactly once per type.
    const data = await adapter.loadVehicleData(name);
    const entry: VehicleModelEntry = {
      data,
      // The adapter hands over an already engine-ready model — both the optimized (`.osm`/`.ostex`) and the
      // unoptimized (DFF/TXD) path converge on it, so nothing here needs to know which one ran.
      //
      // This runs in a promise continuation, BETWEEN frames, so no timer the loop keeps can see it — it
      // reports itself instead (plan 091 phase 2), and the next frame is charged for it.
      id: frameSpans.measure(`vehicle-model:${name}`, () => engine.createVehicleModel(data.model)),
      instances: 0,
      lastUsed: performance.now(),
      textureBytes: textureBytesOf(data.model.textures),
    };
    models.set(name, entry);

    return entry;
  };
  /**
   * Resolve a type's model AND claim one instance on it, atomically from eviction's point of view: the
   * increment happens with no await between the entry becoming visible and the claim, and `evictModels`
   * only ever runs AFTER a claim (or on release) — so a fresh build can never be evicted before its
   * requester claims it. (The first version evicted the just-built entry inside `buildModel` whenever the
   * budget was already full of pinned types — the boot's parked cars died with "unknown model".)
   */
  const acquireModel = async (name: string): Promise<VehicleModelEntry> => {
    const cached = models.get(name);
    if (cached) {
      cached.instances += 1;
      cached.lastUsed = performance.now();

      return cached;
    }
    let pending = pendingModels.get(name);
    if (!pending) {
      pending = buildModel(name).finally(() => pendingModels.delete(name));
      pendingModels.set(name, pending);
    }
    const entry = await pending;
    entry.instances += 1;
    entry.lastUsed = performance.now();
    evictModels();

    return entry;
  };

  const spawnVehicle = async (placement: VehiclePlacement): Promise<SpawnedVehicle> => {
    const { heading, model } = placement;
    const entry = await acquireModel(model);
    const { data, id } = entry;
    let plateSlot: null | number = null;
    const release = (): void => {
      entry.instances = Math.max(0, entry.instances - 1);
      entry.lastUsed = performance.now();
      if (plateSlot !== null) {
        plateSlots?.release(plateSlot); // one fewer car wearing this plate; the raster stays resident
        plateSlot = null;
      }
      evictModels();
    };
    try {
      const paint = await adapter.vehiclePaint(model, placement.colour); // the model is shared; the paint is not
      // From here down the spawn is synchronous, and it runs between frames like the build above — so it
      // times itself (plan 091 phase 2). A spawn that THROWS is not attributed; that path is rare and it
      // already names itself in the console.
      const spawnStarted = performance.now();

      let position: Vec3 = placement.position;
      let pitch = 0;
      // Map car generators (plan 059) + bench road cars (074): seat the body on the ground so it doesn't
      // penetrate terrain/props and get launched (pitch with the street, slide off blocked spots, defer
      // until the collision cell exists — the shared helper carries the bench field lessons).
      if (placement.groundSnap) {
        const seated = seatVehicleOnGround(physics, position, placement.heading, data.halfExtents);
        position = seated.position;
        pitch = seated.pitch;
      }

      const instance = engine.createVehicle(id);
      instance.setPaint(paint);
      // The plate is resolved from the PLACEMENT, not from where the player is standing (plan 082/04), so a
      // far-streamed San Fierro car wears SF plates and a parked car keeps its number across LOD respawns.
      // This is the single wiring point every spawn path flows through: parked cars, map car generators,
      // popcycle road cars, the bench fleet and the debug spawner.
      plateSlot = dressPlate(instance, { ...placement, position });
      const handle = new EngineVehicleHandle(instance, data.rig, () => engine.destroyVehicle(instance));
      const wheels = data.wheels.map((wheel) => ({
        connection: wheel.connection,
        front: wheel.front,
        radius: wheel.radius,
      }));
      // The rig leans the drawn wheels the way the car was AUTHORED (081/06 §3): the axle build comes from
      // `modelFlags`, the track width from the same hub placements the physics is given.
      const rig = new VehicleRig(handle, {
        axles: { front: data.handling.axleFront, rear: data.handling.axleRear },
        drive: data.handling.drive,
        wheels,
      });
      const { body, controller, wheelLift } = physics.createDynamicVehicle(
        position,
        heading,
        data.colliders?.shape ?? null,
        {
          centreOfMass: data.handling.centreOfMass,
          mass: data.handling.mass,
          suspension: {
            bias: data.handling.suspBias,
            damping: data.handling.suspDamping,
            force: data.handling.suspForce,
            restLength: Math.abs(data.handling.suspLower),
            travel: Math.abs(data.handling.suspUpper),
          },
          traction: {
            bias: data.handling.tractionBias,
            loss: data.handling.tractionLoss,
            mult: data.handling.tractionMult,
          },
          turnMass: data.handling.turnMass,
        },
        wheels,
        data.halfExtents,
        pitch,
      );
      // Driver seat = the front-seat dummy mirrored to the −X (driver) side.
      const seatLocal: [number, number, number] = data.seat
        ? [-Math.abs(data.seat[0]), data.seat[1], data.seat[2]]
        : [-0.4, 0, 0];
      const live: Vec3 = [position[0], position[1], position[2]];
      const vehicle: EnterableVehicle = {
        body,
        controller,
        halfExtents: data.halfExtents,
        handle,
        handling: data.handling,
        heading,
        // Seeded from the placement; the physics system keeps it live from the body.
        orientation: headingQuat(heading),
        position: live,
        renderOrientation: headingQuat(heading),
        renderPosition: [position[0], position[1], position[2]],
        rig,
        seatLocal,
        wheelLift,
        wheels,
      };
      handle.setTransform(position, headingQuat(heading)); // pose it before the first frame draws it
      vehiclePhysics.add(vehicle);
      enterVehicle.add(vehicle);
      vehicleDamage.add({ body, handle });
      frameSpans.add(`vehicle-spawn:${model}`, performance.now() - spawnStarted);

      return {
        despawn: (): void => {
          vehiclePhysics.remove(vehicle);
          enterVehicle.remove(vehicle);
          vehicleDamage.remove(body);
          physics.removeVehicle(controller); // drop the raycast controller before its body
          physics.removeBodies([body]);
          handle.dispose();
          release(); // the type becomes evictable once its last instance is gone
        },
        handle,
        position: live,
      };
    } catch (error) {
      release(); // a failed spawn must not pin the type in the cache forever
      throw error;
    }
  };

  const vehicleLod = new VehicleLodSystem(deps.viewOf, config, spawnVehicle);
  // Parked cars come from the game's `parked.json` in the VFS (shipped per game); absent → none.
  //
  // ONE placement must never cost the whole system. This loop used to let a build failure escape into
  // `setupEngineVehicles`' caller, which catches and leaves `vehicles` NULL — so two unconvertible hi-poly
  // mod cars killed spawning for all 201 models, from the debugger and the road-car registrar alike. A car
  // that cannot be built is now skipped and NAMED; the rest of the street still parks.
  const failedModels = new Set<string>();
  for (const placement of parseParkedVehicles(deps.fs.getText('parked.json'))) {
    try {
      vehicleLod.add(placement, await spawnVehicle(placement));
    } catch (error) {
      if (!failedModels.has(placement.model)) {
        failedModels.add(placement.model);
        // eslint-disable-next-line no-console -- a silently missing car is exactly what hid this for a day
        console.warn(
          `[vehicles] '${placement.model}' could not be built, skipping it: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }
  }

  return {
    activeVehicle: (): EnterableVehicle | null => seated,
    applyControls: (step: number): void => enterVehicle.applyControls(step),
    drivenMotion(): null | PlanarMotion {
      const car = enterVehicle.isSeated() ? enterVehicle.getActive() : null;

      return car === null ? null : planarMotion(car.orientation, physics.getLinvel(car.body));
    },
    fixedUpdate(step: number): void {
      // Sample the bodies (which the physics step just moved) into the gameplay pose + the interp snapshots,
      // BEFORE enter/exit reads car.position/heading for this step.
      vehiclePhysics.snapshot(step);
      enterVehicle.fixedUpdate(step);
      // Telemetry LAST: it records the step as it ended, including the controls `drive()` just applied.
      stepTelemetry(step);
      // Smoke and marks after the snapshot for the same reason: they read the wheel state this step produced.
      tyreSmoke.fixedUpdate(step);
      skidMarks.fixedUpdate();
    },
    impactForce(): number {
      const car = enterVehicle.isSeated() ? enterVehicle.getActive() : null;

      return car === null ? 0 : vehicleDamage.peakImpact(car.body);
    },
    isSettling: (): boolean => enterVehicle.isSettling(),
    register(placements: readonly VehiclePlacement[]): void {
      for (const placement of placements) {
        vehicleLod.register(placement);
      }
    },
    ridingVehicle: (): EnterableVehicle | null => (enterVehicle.isRiding() ? enterVehicle.getActive() : null),
    seatInstantly: (): boolean => enterVehicle.seatInstantly(),
    async spawn(placement: VehiclePlacement): Promise<void> {
      vehicleLod.add(placement, await spawnVehicle(placement));
    },
    springs: (): null | readonly VehicleSpringReading[] => {
      const car = enterVehicle.isSeated() ? enterVehicle.getActive() : null;

      return car === null ? null : physics.readVehicleSprings(car.controller);
    },
    stance: (): null | VehicleStance => {
      const car = enterVehicle.isSeated() ? enterVehicle.getActive() : null;
      if (car === null) {
        return null;
      }
      const wheels = physics.readVehicleWheels(car.controller);
      const { mass } = physics.readMassProperties(car.body);

      return {
        mass,
        // The whole point of the block: a car standing on its own collision hull carries part of its weight
        // on the hull, so its springs read light — and since tyre grip is `μ × load`, its wheels quietly
        // stop steering, driving and braking. Nothing else in a capture shows that.
        weightOnGround: Number((wheels.reduce((total, w) => total + w.suspensionForce, 0) / (mass * 9.81)).toFixed(3)),
        wheels: wheels.map((wheel) => ({
          contact: wheel.contact,
          load: Number(wheel.suspensionForce.toFixed(1)),
          radius: wheel.radius,
          restLength: wheel.restLength,
          suspensionLength: Number(wheel.suspensionLength.toFixed(4)),
        })),
      };
    },
    telemetry,
    update(delta: number, alpha: number): void {
      // Draw each car at the interpolated pose (smooth at any refresh), then the variable-rate systems:
      // damage reacts to this step's impacts, enter/exit handles input and doors, LOD streams last.
      vehiclePhysics.render(alpha);
      vehicleDamage.update(delta);
      enterVehicle.update(delta);
      lamps.update();
      vehicleLod.update();
      engine.updateVehicles(); // ONE flatten+upload for every car, after all of them have moved
    },
  };
}

/**
 * Cached-model TEXTURE budget, bytes (the dominant per-type cost — geometry is small next to a 512²×16
 * RGBA array at ~16 MB). Types with live instances never evict, so this is a trim FLOOR, not a hard cap:
 * ~15 modded or ~70 stock idle types stay warm; beyond it the least-recently-used idle type is destroyed
 * and rebuilds through the worker on the next encounter.
 */
const MODEL_CACHE_TEXTURE_BYTES = 256 * 1024 * 1024;

/** One cached car TYPE: the adapter data + the uploaded engine model + the LRU bookkeeping. */
interface VehicleModelEntry {
  data: EngineVehicleData;
  id: VehicleModelId;
  /** Live engine instances of this type — non-zero pins the entry (never evicted under it). */
  instances: number;
  /** `performance.now()` of the last build/spawn/despawn touch — the LRU ordering key. */
  lastUsed: number;
  /** The texture-array payload size — what the budget actually meters. */
  textureBytes: number;
}

/** Body quaternion for a heading about GTA +Z. */
function headingQuat(heading: number): [number, number, number, number] {
  return [0, 0, Math.sin(heading / 2), Math.cos(heading / 2)];
}

/** What a model's texture arrays cost the budget — the `.ostex` payloads, or the raw RGBA8 layers. */
function textureBytesOf(textures: EngineVehicleData['model']['textures']): number {
  return textures.reduce(
    (total, texture) => total + (texture.kind === 'ostex' ? texture.bytes.byteLength : texture.rgba.byteLength),
    0,
  );
}
