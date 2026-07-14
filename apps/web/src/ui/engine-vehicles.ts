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

import { parseParkedVehicles } from '../parked-vehicles';

/** Raise the ground-snap ray start / how far it probes (mirrors canvas-host's car-generator snapping). */
const GROUND_SNAP_LIFT = 2;
const GROUND_SNAP_DROP = 6;

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
  /**
   * The car whose pose OWNS the player right now — from the start of the climb-in slide to the end of the
   * climb-out one, not merely while walking to the door. The host must switch its walking rules off for it
   * (ground snap, locomotion heading), else the rider floats above the roof through the whole climb-in.
   */
  ridingVehicle(): EnterableVehicle | null;
  /** Per-frame (variable dt): input/approach/doors, damage, LOD streaming. */
  update(delta: number): void;
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

  /** One uploaded engine model per car TYPE — instances share geometry, textures and the pipeline. */
  const models = new Map<string, { data: EngineVehicleData; id: VehicleModelId }>();
  const modelFor = async (name: string): Promise<{ data: EngineVehicleData; id: VehicleModelId }> => {
    const cached = models.get(name);
    if (cached) {
      return cached;
    }
    // The model is colour-AGNOSTIC by construction (paint is a per-vertex slot resolved per instance), so
    // one upload serves every colour of this car — and the DFF is parsed exactly once per type.
    const data = await adapter.loadVehicleData(name);
    const entry = {
      data,
      id: engine.createVehicleModel({
        colors: data.model.colors,
        indexCount: data.model.indices.length,
        indices: new Uint8Array(
          data.model.indices.buffer,
          data.model.indices.byteOffset,
          data.model.indices.byteLength,
        ),
        meta: data.model.meta,
        normals: bytesOf(data.model.normals),
        parts: data.model.parts,
        positions: bytesOf(data.model.positions),
        reflect: data.model.reflect,
        submeshes: data.model.submeshes,
        texture: {
          height: data.model.texture.height,
          layers: data.model.texture.layers,
          rgba: data.model.texture.rgba,
          width: data.model.texture.width,
        },
        uvs: bytesOf(data.model.uvs),
        vertexCount: data.model.positions.length / 3,
      }),
    };
    models.set(name, entry);

    return entry;
  };

  const spawnVehicle = async (placement: VehiclePlacement): Promise<SpawnedVehicle> => {
    const { heading, model } = placement;
    const { data, id } = await modelFor(model);
    const paint = await adapter.vehiclePaint(model, placement.colour); // the model is shared; the paint is not

    let position: Vec3 = placement.position;
    // Map car generators (plan 059): seat the body on the ground beneath the IPL spot so it doesn't
    // penetrate terrain/props and get launched.
    if (placement.groundSnap) {
      const ground = physics.groundBelow([position[0], position[1], position[2] + GROUND_SNAP_LIFT], GROUND_SNAP_DROP);
      if (ground !== null) {
        position = [position[0], position[1], ground + data.halfExtents[2] + 0.1];
      }
    }

    const instance = engine.createVehicle(id);
    instance.setPaint(paint);
    const handle = new EngineVehicleHandle(instance, data.model, () => engine.destroyVehicle(instance));
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
      },
      handle,
      position: live,
    };
  };

  const vehicleLod = new VehicleLodSystem(deps.viewOf, config, spawnVehicle);
  // Parked cars come from the game's `parked.json` in the VFS (shipped per game); absent → none.
  for (const placement of parseParkedVehicles(deps.fs.getText('parked.json'))) {
    vehicleLod.add(placement, await spawnVehicle(placement));
  }

  return {
    activeVehicle: (): EnterableVehicle | null => seated,
    fixedUpdate(step: number): void {
      enterVehicle.fixedUpdate(step);
    },
    ridingVehicle: (): EnterableVehicle | null => (enterVehicle.isRiding() ? enterVehicle.getActive() : null),
    update(delta: number): void {
      // Same order the three host registers them in: physics writes the chassis pose and rolls the wheels,
      // damage reacts to this step's impacts, enter/exit handles input and doors, LOD streams last.
      vehiclePhysics.update(delta);
      vehicleDamage.update(delta);
      enterVehicle.update(delta);
      lamps.update();
      vehicleLod.update();
      engine.updateVehicles(); // ONE flatten+upload for every car, after all of them have moved
    },
  };
}

function bytesOf(array: Float32Array): Uint8Array {
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

/** Body quaternion for a heading about GTA +Z. */
function headingQuat(heading: number): [number, number, number, number] {
  return [0, 0, Math.sin(heading / 2), Math.cos(heading / 2)];
}
