/**
 * Skinning-probe host (074/08 B1, `?ped=1`): fetch the probe fixture (tools/opensa-pack/src/ped-probe.ts),
 * feed it to the engine, and drive the own IFP sampler each frame. The model matrix owns the GTA→engine
 * axis change + a slow yaw so every side comes around; clips alternate so both idle and walk get eyeballed.
 */
import type { Engine, PedProbe, SamplerClip } from '@opensa/engine';

import { IfpSampler } from '@opensa/engine';

export interface PedProbeHost {
  /** Sample the active clip at `nowSec`, upload the palette; returns the CPU cost in ms. */
  update(nowSec: number): number;
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
  name: string;
  submeshes: { indexCount: number; indexOffset: number; texture: string }[];
  textures: { height: number; name: string; offset: number; width: number }[];
  vertexCount: number;
}

const CLIP_SWAP_SECONDS = 6;

export async function loadPedProbe(engine: Engine, position: readonly [number, number, number]): Promise<PedProbeHost> {
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
    submeshes: fixture.submeshes.map((submesh) => ({ ...submesh, array: 0, layer: 0 })),
    textures: [
      {
        height: texture.height,
        kind: 'rgba',
        layers: 1,
        rgba: slice(texture.offset, texture.width * texture.height * 4),
        width: texture.width,
      },
    ],
    uvs: slice(fixture.layout.uvs, fixture.vertexCount * 8),
    weights: slice(fixture.layout.weights, fixture.vertexCount * 4),
  });
  const sampler = new IfpSampler(fixture.bones);
  const clips: SamplerClip[] = fixture.clips;

  return {
    update(nowSec: number): number {
      const started = performance.now();
      const clip = clips[Math.floor(nowSec / CLIP_SWAP_SECONDS) % clips.length];
      sampler.sample(clip, nowSec, probe.palette, 1);
      writeModelMatrix(probe.palette, position, nowSec * 0.4);
      engine.updatePedPalette();

      return performance.now() - started;
    },
  };
}

/** Slot 0 = GTA Z-up → engine Y-up axis change × yaw(θ about GTA Z) × translation (engine space). */
function writeModelMatrix(palette: Float32Array, position: readonly [number, number, number], yaw: number): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  palette[0] = c;
  palette[1] = 0;
  palette[2] = -s;
  palette[3] = 0;
  palette[4] = -s;
  palette[5] = 0;
  palette[6] = -c;
  palette[7] = 0;
  palette[8] = 0;
  palette[9] = 1;
  palette[10] = 0;
  palette[11] = 0;
  palette[12] = position[0];
  palette[13] = position[1];
  palette[14] = position[2];
  palette[15] = 1;
}
