import type { IfpAnimation, RWClump, RWFrame, RWSkin } from '@opensa/renderware';

import { parseDff, parseIfp } from '@opensa/renderware';
import { groupTrianglesByMaterial } from '@opensa/renderware/mesh/prepare-clump';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { decodeDxt } from '@opensa/renderware/textures/dxt';
/**
 * Skinning-probe fixture extractor (plan 074/08, the B1 early probe).
 *
 *   npx tsx tools/opensa-pack/src/ped-probe.ts --game game-src/non-modified --out apps/engine-lab/public/ped
 *     [--model male01] [--clips idle_stance,walk_civi]
 *
 * Packs ONE skinned ped + a few IFP clips into a THROWAWAY probe fixture (`ped.json` + `ped.bin`) the lab
 * feeds to the engine: bones in SKIN order (HAnim hierarchy mapping — the plan-052 lesson), inverse binds
 * from the skin plugin (authoritative — frame-derived binds render standard peds lying down), clip tracks
 * matched by bone id with a name fallback, times in seconds. Geometry stays in NATIVE RW bind space — the
 * runtime model matrix owns the GTA→engine axis change (parity with the prod skinned path).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { openGameDir } from './game-fs';

export interface PedFixture {
  bones: PedFixtureBone[];
  clips: PedFixtureClip[];
  indexCount: number;
  /** Byte offsets into `ped.bin` (all 4-aligned). */
  layout: {
    indices: number;
    joints: number;
    normals: number;
    positions: number;
    uvs: number;
    weights: number;
  };
  name: string;
  submeshes: { indexCount: number; indexOffset: number; texture: string }[];
  textures: { height: number; name: string; offset: number; width: number }[];
  vertexCount: number;
}

/** Fixture bone, SKIN order. Local bind = frame transform; inverse bind = skin plugin (pad rows fixed). */
export interface PedFixtureBone {
  bindPosition: [number, number, number];
  bindRotation: [number, number, number, number];
  boneId: number;
  /** 16 floats, column-major. */
  inverseBind: number[];
  name: string;
  /** Skin-order index of the nearest ancestor that is also a skin bone; −1 for the root. */
  parent: number;
}

export interface PedFixtureClip {
  duration: number;
  name: string;
  /** Per SKIN-ORDER bone; empty tracks mean "hold the bind pose". */
  tracks: { quats: number[]; times: number[] }[];
}

/** Seconds per raw ANP3 time unit — mirrors the prod clip builder. */
const IFP_TIME_SCALE = 1 / 60;

interface SkinBone {
  frame: RWFrame;
  frameIndex: number;
  parent: number;
}

function assemble(
  name: string,
  rw: RWClump['geometries'][number],
  skin: RWSkin,
  bones: readonly SkinBone[],
  clips: PedFixtureClip[],
  fs: ReturnType<typeof openGameDir>,
  txdName: string,
): { bin: Uint8Array; fixture: PedFixture } {
  const vertexCount = rw.positions.length / 3;

  // Index buffer grouped by material → submeshes with their texture names.
  const indices: number[] = [];
  const submeshes: PedFixture['submeshes'] = [];
  const usedTextures: string[] = [];
  groupTrianglesByMaterial(rw.triangles, rw.materials.length).forEach((tris, materialIndex) => {
    if (tris.length === 0) {
      return;
    }
    const texture = rw.materials[materialIndex]?.texture?.name.toLowerCase() ?? '';
    if (texture && !usedTextures.includes(texture)) {
      usedTextures.push(texture);
    }
    submeshes.push({ indexCount: tris.length * 3, indexOffset: indices.length, texture });
    for (const tri of tris) {
      indices.push(tri.a, tri.b, tri.c);
    }
  });

  // Decode the referenced TXD textures to plain RGBA8 (probe-grade: no mips, no arrays).
  const txdBytes = fs.get(txdName);
  const decoded = new Map<string, { height: number; rgba: Uint8Array; width: number }>();
  if (txdBytes) {
    for (const texture of parseTxd(txdBytes).textures) {
      const key = texture.name.toLowerCase();
      if (!usedTextures.includes(key)) {
        continue;
      }
      const base = texture.mipmaps[0];
      const rgba =
        texture.format === 'rgba8888'
          ? new Uint8Array(base.data)
          : decodeDxt(texture.format, base.data, base.width, base.height);
      decoded.set(key, { height: base.height, rgba, width: base.width });
    }
  }

  const align4 = (value: number): number => Math.ceil(value / 4) * 4;
  const layout = { indices: 0, joints: 0, normals: 0, positions: 0, uvs: 0, weights: 0 };
  let at = 0;
  const reserve = (bytes: number): number => {
    const offset = at;
    at = align4(at + bytes);

    return offset;
  };
  layout.positions = reserve(vertexCount * 12);
  layout.normals = reserve(vertexCount * 12);
  layout.uvs = reserve(vertexCount * 8);
  layout.joints = reserve(vertexCount * 4);
  layout.weights = reserve(vertexCount * 4);
  layout.indices = reserve(indices.length * 2);
  const textures: PedFixture['textures'] = [];
  for (const textureName of usedTextures) {
    const texture = decoded.get(textureName);
    if (!texture) {
      throw new Error(`texture '${textureName}' not found in ${txdName}`);
    }
    textures.push({
      height: texture.height,
      name: textureName,
      offset: reserve(texture.rgba.byteLength),
      width: texture.width,
    });
  }

  const bin = new Uint8Array(at);
  bin.set(new Uint8Array(rw.positions.buffer, rw.positions.byteOffset, vertexCount * 12), layout.positions);
  const normals = rw.normals ?? computeNormals(rw.positions, indices);
  bin.set(new Uint8Array(normals.buffer, normals.byteOffset, vertexCount * 12), layout.normals);
  const uvs = rw.uvLayers[0] ?? new Float32Array(vertexCount * 2);
  bin.set(new Uint8Array(uvs.buffer, uvs.byteOffset, vertexCount * 8), layout.uvs);
  bin.set(skin.boneIndices.subarray(0, vertexCount * 4), layout.joints);
  bin.set(quantizeWeights(skin.boneWeights, vertexCount), layout.weights);
  bin.set(new Uint8Array(new Uint16Array(indices).buffer), layout.indices);
  for (const texture of textures) {
    const source = decoded.get(texture.name);
    if (source) {
      bin.set(source.rgba, texture.offset);
    }
  }

  const fixture: PedFixture = {
    bones: bones.map((bone, skinIndex) => fixtureBone(bone, skin, skinIndex)),
    clips,
    indexCount: indices.length,
    layout,
    name,
    submeshes,
    textures,
    vertexCount,
  };

  return { bin, fixture };
}

/** Flat-shaded fallback normals for the rare ped geometry without stored normals. */
function computeNormals(positions: Float32Array, indices: readonly number[]): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let tri = 0; tri + 2 < indices.length; tri += 3) {
    const [a, b, c] = [indices[tri] * 3, indices[tri + 1] * 3, indices[tri + 2] * 3];
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const vertex of [a, b, c]) {
      normals[vertex] += nx;
      normals[vertex + 1] += ny;
      normals[vertex + 2] += nz;
    }
  }
  for (let vertex = 0; vertex < normals.length; vertex += 3) {
    const length = Math.hypot(normals[vertex], normals[vertex + 1], normals[vertex + 2]) || 1;
    normals[vertex] /= length;
    normals[vertex + 1] /= length;
    normals[vertex + 2] /= length;
  }

  return normals;
}

function extractClips(
  fs: ReturnType<typeof openGameDir>,
  game: string,
  clipNames: readonly string[],
  bones: readonly SkinBone[],
): PedFixtureClip[] {
  const ifpBytes = fs.get('ped.ifp') ?? readLoose(join(game, 'anim/ped.ifp'));
  if (!ifpBytes) {
    throw new Error('ped.ifp not found (looked in the archive set and anim/)');
  }
  const animations = parseIfp(ifpBytes);
  const byName = new Map(animations.map((animation) => [animation.name.toLowerCase(), animation]));

  return clipNames.map((clipName) => {
    const animation = byName.get(clipName.toLowerCase());
    if (!animation) {
      throw new Error(
        `clip '${clipName}' not in ped.ifp (have e.g. ${animations
          .slice(0, 8)
          .map((a) => a.name)
          .join(', ')} …)`,
      );
    }

    return fixtureClip(animation, bones);
  });
}

/** Local bind from the FRAME (pos + rotation→quat), inverse bind from the SKIN plugin (pad rows fixed). */
function fixtureBone(bone: SkinBone, skin: RWSkin, skinIndex: number): PedFixtureBone {
  const inverseBind = [...skin.inverseBindMatrices.slice(skinIndex * 16, skinIndex * 16 + 16)];
  inverseBind[3] = 0;
  inverseBind[7] = 0;
  inverseBind[11] = 0;
  inverseBind[15] = 1;

  return {
    bindPosition: [bone.frame.position[0], bone.frame.position[1], bone.frame.position[2]],
    bindRotation: rowMajorRotationToQuat(bone.frame.rotation),
    boneId: bone.frame.boneId ?? -1,
    inverseBind,
    name: bone.frame.name.trim(),
    parent: bone.parent,
  };
}

/** Per-bone tracks in skin order — matched by bone id first, trimmed name second (prod matched by name). */
function fixtureClip(animation: IfpAnimation, bones: readonly SkinBone[]): PedFixtureClip {
  const byBoneId = new Map(animation.bones.map((bone) => [bone.boneId, bone]));
  const byBoneName = new Map(animation.bones.map((bone) => [bone.name.trim().toLowerCase(), bone]));
  let duration = 0;
  const tracks = bones.map((bone) => {
    const track =
      (bone.frame.boneId !== undefined ? byBoneId.get(bone.frame.boneId) : undefined) ??
      byBoneName.get(bone.frame.name.trim().toLowerCase());
    if (!track || track.frames.length === 0) {
      return { quats: [], times: [] };
    }
    const times = track.frames.map((frame) => frame.time * IFP_TIME_SCALE);
    duration = Math.max(duration, times[times.length - 1]);

    return { quats: track.frames.flatMap((frame) => frame.rotation), times };
  });

  return { duration, name: animation.name, tracks };
}

function main(): void {
  const argValue = (flag: string): null | string => {
    const index = process.argv.indexOf(`--${flag}`);

    return index >= 0 ? (process.argv[index + 1] ?? null) : null;
  };
  const game = argValue('game') ?? 'game-src/non-modified';
  const out = argValue('out') ?? 'apps/engine-lab/public/ped';
  const model = (argValue('model') ?? 'male01').toLowerCase();
  const clipNames = (argValue('clips') ?? 'idle_stance,walk_civi').split(',').map((name) => name.trim());

  const fs = openGameDir(game);
  const dffBytes = fs.get(`${model}.dff`);
  if (!dffBytes) {
    throw new Error(`${model}.dff not found in ${game}`);
  }
  const clump = parseDff(dffBytes);
  const atomic = clump.atomics.find((entry) => clump.geometries[entry.geometryIndex]?.skin);
  if (!atomic) {
    throw new Error(`${model}.dff has no skinned geometry`);
  }
  const rw = clump.geometries[atomic.geometryIndex];
  const skin = rw.skin as RWSkin;

  const bones = skinOrderBones(clump, skin);
  const clips = extractClips(fs, game, clipNames, bones);
  const { bin, fixture } = assemble(model, rw, skin, bones, clips, fs, `${model}.txd`);

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'ped.json'), JSON.stringify(fixture));
  writeFileSync(join(out, 'ped.bin'), bin);
  console.log(
    `[ped-probe] ${model}: ${fixture.vertexCount} verts, ${fixture.indexCount / 3} tris, ` +
      `${bones.length} bones, clips ${fixture.clips.map((clip) => `${clip.name}(${clip.duration.toFixed(2)}s)`).join(' ')}, ` +
      `${fixture.submeshes.length} submeshes, bin ${(bin.byteLength / 1024).toFixed(0)} KB → ${out}`,
  );
}

/** unorm8 weights, renormalized so each vertex's four sum to exactly 255 (largest gets the remainder). */
function quantizeWeights(weights: Float32Array, vertexCount: number): Uint8Array {
  const out = new Uint8Array(vertexCount * 4);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const at = vertex * 4;
    const sum = weights[at] + weights[at + 1] + weights[at + 2] + weights[at + 3] || 1;
    let total = 0;
    let largest = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      out[at + slot] = Math.round((weights[at + slot] / sum) * 255);
      total += out[at + slot];
      if (out[at + slot] > out[at + largest]) {
        largest = slot;
      }
    }
    out[at + largest] += 255 - total;
  }

  return out;
}

function readLoose(path: string): ArrayBuffer | null {
  try {
    const bytes = readFileSync(path);

    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  } catch {
    return null;
  }
}

/** RW row-major 3×3 (right/up/at as rows) → column-major rotation → quaternion (x, y, z, w). */
function rowMajorRotationToQuat(rotation: readonly number[]): [number, number, number, number] {
  // Column-major m[col][row] from the transposed RW rows.
  const [r0, r1, r2, r3, r4, r5, r6, r7, r8] = rotation;
  const m00 = r0;
  const m01 = r3;
  const m02 = r6;
  const m10 = r1;
  const m11 = r4;
  const m12 = r7;
  const m20 = r2;
  const m21 = r5;
  const m22 = r8;
  const trace = m00 + m11 + m22;
  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }

  return [x, y, z, w];
}

/** Order bones per the skin's indices via the HAnim hierarchy (fallback: frame i+1), remapping parents. */
function skinOrderBones(clump: RWClump, skin: RWSkin): SkinBone[] {
  const hierarchy = clump.frames.find((frame) => frame.boneHierarchy)?.boneHierarchy;
  const frameIndexByBoneId = new Map<number, number>();
  clump.frames.forEach((frame, index) => {
    if (frame.boneId !== undefined) {
      frameIndexByBoneId.set(frame.boneId, index);
    }
  });
  const order: number[] = Array.from({ length: skin.numBones }, (_, boneIndex) =>
    hierarchy ? (frameIndexByBoneId.get(hierarchy[boneIndex]) ?? boneIndex + 1) : boneIndex + 1,
  );
  const skinIndexByFrame = new Map<number, number>();
  order.forEach((frameIndex, skinIndex) => skinIndexByFrame.set(frameIndex, skinIndex));

  return order.map((frameIndex) => {
    // Parent = the nearest ancestor frame that is itself a skin bone.
    let ancestor = clump.frames[frameIndex].parentIndex;
    while (ancestor >= 0 && !skinIndexByFrame.has(ancestor)) {
      ancestor = clump.frames[ancestor].parentIndex;
    }

    return {
      frame: clump.frames[frameIndex],
      frameIndex,
      parent: ancestor >= 0 ? (skinIndexByFrame.get(ancestor) ?? -1) : -1,
    };
  });
}

main();
