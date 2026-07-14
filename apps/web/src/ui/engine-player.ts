/**
 * The own-engine player body (plan 074/10 B3): the B1 ped probe driven by GAMEPLAY state — position from
 * the physics Transform, heading from planar velocity, idle↔walk clip by speed. The fixture comes from
 * `tools/opensa-pack/src/ped-probe.ts` (served at `/ped`, a root-public symlink like the paks).
 */
import type { Engine, PedProbe, SamplerClip } from '@opensa/engine';

import { IfpSampler } from '@opensa/engine';
import { writeGtaRoot } from '@opensa/game/adapters/engine-vehicle-handle';

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

interface PedFixtureJson {
  bones: {
    bindPosition: [number, number, number];
    bindRotation: [number, number, number, number];
    inverseBind: number[];
    name: string;
    parent: number;
  }[];
  clips: { duration: number; name: string; tracks: { quats: number[]; times: number[] }[] }[];
  indexCount: number;
  layout: { indices: number; joints: number; normals: number; positions: number; uvs: number; weights: number };
  minZ?: number;
  submeshes: { indexCount: number; indexOffset: number; texture: string }[];
  textures: { height: number; name: string; offset: number; width: number }[];
  vertexCount: number;
}

// Fixture clip order: [idle, walk, run] (ped-probe --clips idle_stance,walk_civi,run_civi).
const IDLE_CLIP = 0;
const WALK_CLIP = 1;
const RUN_CLIP = 2;
/** Planar speed (GTA m/s) above which the run cycle plays — between walkSpeed 2 and runSpeed 7. */
const RUN_SPEED_THRESHOLD = 4;

export async function loadEnginePlayer(engine: Engine): Promise<EnginePlayer> {
  const [fixture, bin] = await Promise.all([
    fetch('/ped/ped.json').then((response) => response.json() as Promise<PedFixtureJson>),
    fetch('/ped/ped.bin').then((response) => response.arrayBuffer()),
  ]);
  const bytes = new Uint8Array(bin);
  const slice = (offset: number, length: number): Uint8Array => bytes.subarray(offset, offset + length);
  const texture = fixture.textures[0];
  const probe: PedProbe = engine.setPedProbe({
    boneCount: fixture.bones.length,
    indexCount: fixture.indexCount,
    indices: slice(fixture.layout.indices, fixture.indexCount * 2),
    joints: slice(fixture.layout.joints, fixture.vertexCount * 4),
    normals: slice(fixture.layout.normals, fixture.vertexCount * 12),
    positions: slice(fixture.layout.positions, fixture.vertexCount * 12),
    submeshes: fixture.submeshes,
    texture: {
      height: texture.height,
      rgba: slice(texture.offset, texture.width * texture.height * 4),
      width: texture.width,
    },
    uvs: slice(fixture.layout.uvs, fixture.vertexCount * 8),
    weights: slice(fixture.layout.weights, fixture.vertexCount * 4),
  });
  const sampler = new IfpSampler(fixture.bones);
  const clips: SamplerClip[] = fixture.clips;
  // The fixture names its clips (`CAR_getin_LHS`, …); the engine's SamplerClip is name-free, so index them here.
  const clipByName = new Map(fixture.clips.map((clip, index) => [clip.name.toLowerCase(), index]));
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
    minZ: fixture.minZ ?? 0,
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
        const wanted = speed > RUN_SPEED_THRESHOLD ? RUN_CLIP : speed > 0.3 ? WALK_CLIP : IDLE_CLIP;
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
