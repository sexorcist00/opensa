/**
 * Vehicles on the own engine (plan 074/08 B5 step 4) — the `?engine=opensa` twin of canvas-host's vehicle
 * block. Every gameplay system here is REUSED verbatim (enter/exit, driving, physics, damage, LOD); the only
 * new code is the wiring, because the systems now speak {@link VehicleHandle} instead of three objects.
 *
 * The model cache is the point of the B5 engine work: one uploaded model per CAR TYPE, one instance per car.
 * A street of Landstalkers shares its geometry and its texture array, and differs only by part matrices and
 * a four-colour paint slot.
 */
import type { Engine, VehicleModelId } from '@opensa/engine';
import type { EngineVehicleData, GtaSaWorldAdapter } from '@opensa/game/adapters/gta-sa-world.adapter';
import type { CharacterControllerSystem } from '@opensa/game/character/character-controller.system';
import type { Logger } from '@opensa/game/diagnostics/logger';
import type { InputState } from '@opensa/game/input';
import type { Config } from '@opensa/game/interfaces/config.interface';
import type { Vec3 } from '@opensa/game/interfaces/world-adapter.interface';
import type { PhysicsWorld } from '@opensa/game/physics/physics-world';
import type { EnterableVehicle, VehicleAnimator } from '@opensa/game/vehicle/enter-vehicle.system';
import type { SpawnedVehicle, VehiclePlacement } from '@opensa/game/vehicle/vehicle-lod.system';

import { EngineVehicleHandle, gtaPositionToEngine } from '@opensa/game/adapters/engine-vehicle-handle';
import { EnterVehicleSystem } from '@opensa/game/vehicle/enter-vehicle.system';
import { VehicleDamageSystem } from '@opensa/game/vehicle/vehicle-damage.system';
import { VehicleLampSystem } from '@opensa/game/vehicle/vehicle-lamp.system';
import { VehicleLodSystem } from '@opensa/game/vehicle/vehicle-lod.system';
import { VehiclePhysicsSystem } from '@opensa/game/vehicle/vehicle-physics.system';
import { VehicleRig } from '@opensa/game/vehicle/vehicle-rig';
import { seatVehicleOnGround } from '@opensa/game/vehicle/vehicle-seating';

import { parseParkedVehicles } from '../parked-vehicles';

export interface EngineVehicles {
  /** The car the player is seated in, or null — the host follows it with the camera. */
  activeVehicle(): EnterableVehicle | null;
  /**
   * FIXED step — must be called from the host's fixed loop, AFTER the physics step. Enter/exit does all its
   * rider placement and its driving here (prod's `Game` runs every system's `fixedUpdate` before `update`).
   * Skipping this leaves the sequence frozen mid-climb-in: the controller stays disabled, the door stays
   * open and the car never drives — the phase machine simply never advances.
   */
  fixedUpdate(step: number): void;
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
  /** Spawn a car and register it with the LOD system (persists like a parked car) — used for test spawns. */
  spawn(placement: VehiclePlacement): Promise<void>;
  /** Per-frame (variable dt): draw cars at the interpolated pose (`alpha` = fraction into the next fixed
   *  step), then input/approach/doors, damage, LOD streaming. */
  update(delta: number, alpha: number): void;
}

export interface EngineVehiclesDeps {
  adapter: GtaSaWorldAdapter;
  /** Turn the follow camera to an azimuth (enter-vehicle centres it behind the car once). */
  aimCamera: (azimuth: number) => void;
  animator: VehicleAnimator;
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
  viewOf: () => Vec3;
}

export async function setupEngineVehicles(deps: EngineVehiclesDeps): Promise<EngineVehicles> {
  const { adapter, config, engine, physics } = deps;
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
      id: engine.createVehicleModel(data.model),
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
    const release = (): void => {
      entry.instances = Math.max(0, entry.instances - 1);
      entry.lastUsed = performance.now();
      evictModels();
    };
    try {
      const paint = await adapter.vehiclePaint(model, placement.colour); // the model is shared; the paint is not

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
      const handle = new EngineVehicleHandle(instance, data.rig, () => engine.destroyVehicle(instance));
      const rig = new VehicleRig(handle);
      const wheels = data.wheels.map((wheel) => ({
        connection: wheel.connection,
        front: wheel.front,
        radius: wheel.radius,
      }));
      const { body, controller } = physics.createDynamicVehicle(
        position,
        heading,
        data.colliders?.shape ?? null,
        data.handling.mass,
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
        wheels,
      };
      handle.setTransform(position, headingQuat(heading)); // pose it before the first frame draws it
      vehiclePhysics.add(vehicle);
      enterVehicle.add(vehicle);
      vehicleDamage.add({ body, handle });

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
    fixedUpdate(step: number): void {
      // Sample the bodies (which the physics step just moved) into the gameplay pose + the interp snapshots,
      // BEFORE enter/exit reads car.position/heading for this step.
      vehiclePhysics.snapshot(step);
      enterVehicle.fixedUpdate(step);
    },
    isSettling: (): boolean => enterVehicle.isSettling(),
    register(placements: readonly VehiclePlacement[]): void {
      for (const placement of placements) {
        vehicleLod.register(placement);
      }
    },
    ridingVehicle: (): EnterableVehicle | null => (enterVehicle.isRiding() ? enterVehicle.getActive() : null),
    async spawn(placement: VehiclePlacement): Promise<void> {
      vehicleLod.add(placement, await spawnVehicle(placement));
    },
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
