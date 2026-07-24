/**
 * The own-engine player body (plan 074/10 B3): the B1 ped probe driven by GAMEPLAY state — position from
 * the physics Transform, heading from planar velocity, idle↔walk clip by speed. The model is the game's
 * `GAME_CONFIG.mainCharacter` `.osm` read BY NAME from the VFS (opensa-pack 003 phase 5f — see
 * {@link loadEnginePlayer}; hardcoded `male01` until 2026-07-23, a 074 bring-up leftover); the old
 * ped-probe fixture is gone.
 */
import type { Engine, PedProbe, SamplerClip } from '@opensa/engine';
import type { AssetFileSystem } from '@opensa/renderware';

import { IfpSampler } from '@opensa/engine';
import { writeGtaRoot } from '@opensa/game/adapters/engine-vehicle-handle';
import { readPedOsm } from '@opensa/game/adapters/ped-osm';
import { IDLE_SPEED_THRESHOLD } from '@opensa/game/character/locomotion';
import { VEHICLE_SCRIPTED_CLIPS } from '@opensa/game/vehicle/vehicle-clips';
import { getIfp } from '@opensa/renderware/archive/asset-cache';
import { type PedClip, pedClip } from '@opensa/renderware/ped/build-ped-model';

export interface EnginePlayer {
  /** Face a yaw directly (enter/exit uses it on the way out of the car). */
  faceTo(yaw: number): void;
  /** Lowest posed vertex of the model (GTA Z-up) — the host aligns it to the physics ground. */
  minZ: number;
  /**
   * Play a named clip (climb-in / sit / climb-out) instead of the speed-driven locomotion, or `null` to hand
   * control back. This is the {@link VehicleAnimator} surface `EnterVehicleSystem` drives — the same contract
   * the three `CharacterAnimationSystem` satisfies.
   */
  setScripted(
    clip: null | string,
    options?: { facing?: number; loop?: boolean; orientation?: readonly [number, number, number, number] },
  ): void;
  /** Advance the clip clock and upload the palette for this frame (`speed` = planar GTA m/s). */
  update(positionEngine: readonly [number, number, number], headingYaw: number, speed: number, dt: number): void;
}

/** Where the player's clips live. The archives hold it bare; a game dir keeps it under `anim/`, and the
 *  browser VFS keys loose files by their relative path — so both spellings have to be tried. */
const PLAYER_IFP_NAMES = ['ped', 'anim/ped'];
/** Clip order the state machine below indexes: [idle, walk, run]. */
const PLAYER_CLIPS = ['idle_stance', 'walk_civi', 'run_civi'];
const IDLE_CLIP = 0;
const WALK_CLIP = 1;
const RUN_CLIP = 2;
/**
 * Scripted clips `EnterVehicleSystem` asks for BY NAME (climb-in / climb-out / sit). Shared from the game
 * package ({@link VEHICLE_SCRIPTED_CLIPS}) so the requester and this resolver can't desync. They are resolved
 * from the SAME `ped.ifp` as locomotion; without them `setScripted` fell through to `idle_stance`, so the
 * driver rode STANDING with his legs out of the car.
 */
const SCRIPTED_CLIPS = VEHICLE_SCRIPTED_CLIPS;
/** Planar speed (GTA m/s) above which the run cycle plays — between walkSpeed 2 and runSpeed 7. */
const RUN_SPEED_THRESHOLD = 4;

/**
 * Name → index for `setScripted`. Locomotion (the first `locomotionCount`, always addressable by the state
 * machine) is registered unconditionally; a SCRIPTED clip earns a name entry ONLY when it actually resolved
 * from the IFP (`duration > 0`). An unresolved scripted clip MUST fall through to the standing locomotion
 * stand-in — sampling its empty clip would drop the ped to the flat bind pose (SA's bind mesh lies along X).
 * Pure + exported so the gate that decides "driver sits" vs "driver rides standing" is unit-testable.
 */
export function buildClipIndex(
  resolved: readonly Pick<PedClip, 'duration' | 'name'>[],
  locomotionCount: number,
): Map<string, number> {
  const clipByName = new Map<string, number>();
  resolved.forEach((clip, index) => {
    if (index < locomotionCount || clip.duration > 0) {
      clipByName.set(clip.name.toLowerCase(), index);
    }
  });

  return clipByName;
}

/**
 * The player, loaded BY NAME from the game's own assets (opensa-pack 003 phase 5f).
 *
 * It used to fetch `/ped/ped.json` + `/ped/ped.bin` over HTTP — the LAB's probe fixture, baked by a CLI —
 * in the production host. So the shipped player was whatever a developer last converted, animations frozen
 * at bake time, and the game dir the user picked had no say. Now the model comes from `<model>.osm` in the
 * archives and the clips are resolved from `ped.ifp` at load, exactly like every other asset.
 */
export function loadEnginePlayer(engine: Engine, fs: AssetFileSystem, model: string): EnginePlayer {
  const name = model.toLowerCase();
  const osm = fs.get(`${name}.osm`);
  if (!osm) {
    throw new Error(
      `player model ${name}.osm not found (GAME_CONFIG.mainCharacter) — check the model exists in the ` +
        'game/peds install and opensa-pack ran over the game dir',
    );
  }
  const { fixture, geometry, textureArrays } = readPedOsm(name, new Uint8Array(osm));
  const probe: PedProbe = engine.setPedProbe({
    boneCount: fixture.bones.length,
    indexCount: fixture.indexCount,
    indices: geometry.indices,
    joints: geometry.joints,
    normals: geometry.normals,
    positions: geometry.positions,
    submeshes: fixture.submeshes,
    textures: textureArrays.map((bytes) => ({ bytes, kind: 'ostex' as const })),
    uvs: geometry.uvs,
    weights: geometry.weights,
  });
  const sampler = new IfpSampler(fixture.bones);
  // The clips are resolved against THIS model's bones, from the game's own IFP — a modded ped.ifp changes
  // how the player walks, which a baked fixture could never express.
  const animations = PLAYER_IFP_NAMES.map((name) => getIfp(fs, name)).find((entries) => entries.length > 0) ?? [];
  if (animations.length === 0) {
    // Without clips the sampler holds the BIND pose — and SA's bind mesh lies flat along X, so the player
    // would lie on the ground instead of standing. Say so rather than shipping a corpse.
    // eslint-disable-next-line no-console -- a silent bind-pose player is worse than a console line
    console.warn(`[player] no ped.ifp found (tried ${PLAYER_IFP_NAMES.join(', ')}) — the player cannot animate`);
  }
  // Returns pedClip's richer (NAMED) shape, not the engine's name-free SamplerClip: we need the resolved
  // clip's name below to key `clipByName`.
  const resolveClip = (name: string): PedClip => {
    const animation = animations.find((entry) => entry.name.toLowerCase() === name);

    return animation ? pedClip(animation, fixture.bones) : { duration: 0, name, tracks: [] };
  };
  // Locomotion first (its indices are the [idle, walk, run] the state machine hard-codes), scripted after.
  const resolved = [...PLAYER_CLIPS, ...SCRIPTED_CLIPS].map(resolveClip);
  const clips: SamplerClip[] = resolved;
  const clipByName = buildClipIndex(resolved, PLAYER_CLIPS.length);
  let clipTime = 0;
  let activeClip = IDLE_CLIP;
  let scripted: null | { index: number; loop: boolean } = null;
  let scriptedFacing = 0;
  /**
   * The car's FULL orientation while riding (prod passes it every fixed step). It OVERRIDES the yaw: a
   * yaw-only root cannot express the body's tilt and roll, and rebuilding the angle from our own atan2
   * leaves the driver turning out of sync with the car he is bolted into.
   */
  let scriptedOrientation: null | readonly [number, number, number, number] = null;
  const root = new Float32Array(16);

  return {
    faceTo(yaw: number): void {
      scriptedFacing = yaw;
    },
    minZ: fixture.minZ,
    setScripted(clip, options = {}): void {
      if (clip === null) {
        scripted = null;
        scriptedOrientation = null;
        clipTime = 0;

        return;
      }
      const index = clipByName.get(clip.toLowerCase());
      if (index === undefined) {
        scripted = null; // the fixture lacks the clip — locomotion keeps running rather than freezing
        scriptedOrientation = null;

        return;
      }
      // Re-issued EVERY fixed step while seated (with a fresh orientation) — restarting the clock on each
      // call would freeze the sit clip on its first frame, so only a CHANGE of clip rewinds it.
      if (scripted?.index !== index) {
        clipTime = 0;
      }
      scripted = { index, loop: options.loop ?? false };
      scriptedOrientation = options.orientation ?? null;
      if (options.facing !== undefined) {
        scriptedFacing = options.facing;
      }
    },
    update(positionEngine, headingYaw, speed, dt): void {
      if (scripted) {
        const clip = clips[scripted.index];
        clipTime += dt;
        // A one-shot clip HOLDS its last pose (the seated driver stays seated); a looping one wraps.
        const time = scripted.loop ? clipTime : Math.min(clipTime, clip.duration);
        sampler.sample(clip, time, probe.palette, 1);
      } else {
        const wanted = speed > RUN_SPEED_THRESHOLD ? RUN_CLIP : speed > IDLE_SPEED_THRESHOLD ? WALK_CLIP : IDLE_CLIP;
        if (wanted !== activeClip) {
          activeClip = wanted;
          clipTime = 0; // v1: hard switch — the crossfade is the plan-08 sampler follow-up
        }
        clipTime += dt;
        sampler.sample(clips[activeClip] ?? clips[0], clipTime, probe.palette, 1);
        scriptedFacing = headingYaw;
      }
      if (scriptedOrientation) {
        // Riding: the car's full transform — the same matrix its own parts ride, so the driver is welded to
        // the seat through turns, lean and flips.
        writeGtaRoot(root, positionEngine, [...scriptedOrientation] as [number, number, number, number]);
        probe.palette.set(root, 0);
      } else {
        const yaw = scripted ? scriptedFacing : headingYaw;
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        probe.palette.set(
          [c, 0, -s, 0, -s, 0, -c, 0, 0, 1, 0, 0, positionEngine[0], positionEngine[1], positionEngine[2], 1],
          0,
        );
      }
      engine.updatePedPalette();
    },
  };
}
