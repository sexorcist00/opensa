import type { RWClump, RWMaterial } from '@opensa/renderware';

import { parseDff } from '@opensa/renderware';
import { groupTrianglesByMaterial } from '@opensa/renderware/mesh/prepare-clump';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { decodeDxt } from '@opensa/renderware/textures/dxt';
/**
 * Vehicle fixture extractor (plan 074/08 B2a).
 *
 *   npx tsx tools/opensa-pack/src/vehicle-probe.ts --game game-src/non-modified --out apps/engine-lab/public/vehicle
 *     [--model landstal] [--primary r,g,b] [--secondary r,g,b] [--tertiary r,g,b] [--quaternary r,g,b]
 *
 * One SA vehicle DFF → a rigid-part probe fixture (`vehicle.json` + `vehicle.bin`): parts from the `_ok`
 * atomics (frame-chain locals relative to the vehicle root), the shared `wheel` atomic instanced at every
 * `wheel_*_dummy` (right side turned 180° instead of mirrored — keeps winding), carcols-style paint markers
 * replaced at the MATERIAL level and baked into per-vertex colours, textures resolved from the model's TXD
 * with `vehicle.txd` fallback into one common-size RGBA8 array. `_dam` / `_vlo` states and door hinges are
 * later dynamics work — the probe freezes the transform-buffer/part-draw architecture only.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resampleToPow2 } from './alpha';
import { openGameDir } from './game-fs';
import { frameWorldTransform } from './weld';

/** Four-colour carcols paint (3rd falls back to primary, 4th to secondary — prod semantics). */
export interface Paint {
  primary: [number, number, number];
  quaternary: [number, number, number];
  secondary: [number, number, number];
  tertiary: [number, number, number];
}

export interface VehicleFixture {
  /** EVERY non-geometry frame as a named anchor (headlights/taillights/exhaust/seats/…): the dummy list is
   *  deliberately carried VERBATIM and in full — downstream consumers grow without re-extracting. */
  dummies: { name: string; position: [number, number, number]; rotation: [number, number, number, number] }[];
  indexCount: number;
  layout: { colors: number; indices: number; meta: number; normals: number; positions: number; uvs: number };
  name: string;
  parts: VehicleFixturePart[];
  submeshes: {
    indexCount: number;
    indexOffset: number;
    lamp: 'head' | 'tail' | null;
    part: number;
    translucent: boolean;
  }[];
  /** All layers share one size (smaller sources are bilinearly upscaled). */
  textures: { height: number; names: string[]; offset: number; width: number };
  vertexCount: number;
  wheels: { front: boolean; part: number; radius: number }[];
}

export interface VehicleFixturePart {
  /** Local rotation quaternion (x, y, z, w) relative to the vehicle root. */
  localRotation: [number, number, number, number];
  localTranslation: [number, number, number];
  name: string;
}

/** SA per-lamp "magic" marker colours on the `vehiclelights*` atlas (prod build-vehicle lore): they say
 *  WHICH lamp a material is — engine metadata, NEVER rendered (else garish green/yellow lamp patches). */
const LAMP_MARKERS = new Map<string, 'head' | 'tail'>([
  ['0,255,200', 'head'], // front right
  ['185,255,0', 'tail'], // rear left
  ['255,60,0', 'tail'], // rear right
  ['255,175,0', 'head'], // front left
]);

const PRIMARY_MARKER = '60,255,0';
const SECONDARY_MARKER = '255,0,175';
const TERTIARY_MARKER = '0,255,255';
const QUATERNARY_MARKER = '255,255,0';
const WHEEL_DUMMY_RE = /^wheel_(l|r)([fmb])_dummy$/;

interface Scratch {
  colors: number[];
  indices: number[];
  meta: number[];
  normals: number[];
  positions: number[];
  submeshes: VehicleFixture['submeshes'];
  uvs: number[];
}

/** Vehicle textures: model TXD first, `vehicle.txd` fallback; all layers upscaled to one common size. */
class TextureSet {
  private readonly decoded = new Map<string, { height: number; rgba: Uint8Array; width: number }>();
  private readonly layers: string[] = [];
  private readonly sources = new Map<string, { height: number; rgba: Uint8Array; width: number }>();

  constructor(fs: ReturnType<typeof openGameDir>, model: string) {
    // `vehicle.txd` (the shared generic set) is a LOOSE file — game-fs keys loose entries by relative path.
    for (const txdName of [`${model}.txd`, 'vehicle.txd', 'models/generic/vehicle.txd']) {
      const bytes = fs.get(txdName);
      if (!bytes) {
        continue;
      }
      for (const texture of parseTxd(bytes).textures) {
        const key = texture.name.toLowerCase();
        if (this.sources.has(key)) {
          continue;
        }
        const base = texture.mipmaps[0];
        const rgba =
          texture.format === 'rgba8888'
            ? new Uint8Array(base.data)
            : decodeDxt(texture.format, base.data, base.width, base.height);
        this.sources.set(key, { height: base.height, rgba, width: base.width });
      }
    }
  }

  pack(): { bytes: Uint8Array; height: number; names: string[]; width: number } {
    let width = 4;
    let height = 4;
    for (const name of this.layers) {
      const source = this.decoded.get(name);
      if (source) {
        width = Math.max(width, source.width);
        height = Math.max(height, source.height);
      }
    }
    const bytes = new Uint8Array(Math.max(1, this.layers.length) * width * height * 4);
    this.layers.forEach((name, layer) => {
      const source = this.decoded.get(name);
      const scaled = source ? scaleTo(source, width, height) : whiteTexel(width, height);
      bytes.set(scaled, layer * width * height * 4);
    });
    if (this.layers.length === 0) {
      bytes.set(whiteTexel(width, height), 0);
      this.layers.push('white');
    }

    return { bytes, height, names: [...this.layers], width };
  }

  /** Layer index for a material (0-layer white for untextured — paint carries the colour). */
  resolve(material: RWMaterial): number {
    return this.ensureLayer(material.texture?.name.toLowerCase() ?? 'white');
  }

  /** Lamp textures have a lamps-on TWIN (`vehiclelights128` → `vehiclelightson128` — SA swaps the lamp
   *  texture at night); returns its layer, or 0 when the material has no twin (0 never IS a twin: layer 0
   *  is claimed by the first body material, so the shader can use 0 as "no night state"). */
  resolveNightTwin(material: RWMaterial): number {
    const name = material.texture?.name.toLowerCase() ?? '';
    if (!name.includes('lights') || name.includes('lightson')) {
      return 0;
    }
    const twin = name.replace('lights', 'lightson');
    if (!this.sources.has(twin)) {
      return 0;
    }

    return this.ensureLayer(twin);
  }

  private ensureLayer(name: string): number {
    const existing = this.layers.indexOf(name);
    if (existing >= 0) {
      return existing;
    }
    const source = name === 'white' ? null : (this.sources.get(name) ?? null);
    this.decoded.set(name, source ?? { height: 4, rgba: whiteTexel(4, 4), width: 4 });
    this.layers.push(name);

    return this.layers.length - 1;
  }
}

/** Weld one geometry's triangles into the scratch, one submesh per material (marker paint applied). */
function appendGeometry(
  scratch: Scratch,
  clump: RWClump,
  geometryIndex: number,
  part: number,
  paint: Paint,
  textures: TextureSet,
): void {
  const rw = clump.geometries[geometryIndex];
  const baseVertex = scratch.positions.length / 3;
  const vertexCount = rw.positions.length / 3;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    scratch.positions.push(rw.positions[vertex * 3], rw.positions[vertex * 3 + 1], rw.positions[vertex * 3 + 2]);
    if (rw.normals) {
      scratch.normals.push(rw.normals[vertex * 3], rw.normals[vertex * 3 + 1], rw.normals[vertex * 3 + 2]);
    } else {
      scratch.normals.push(0, 0, 1);
    }
    const uvs = rw.uvLayers[0];
    scratch.uvs.push(uvs ? uvs[vertex * 2] : 0, uvs ? uvs[vertex * 2 + 1] : 0);
  }
  // Colors/meta are PER MATERIAL — filled while walking submeshes below (same vertex may repeat across
  // materials in RW; SA vehicle splits keep them disjoint, so a per-vertex fill per submesh is safe).
  const colorFill = new Array<number>(vertexCount * 4).fill(255);
  const metaFill = new Array<number>(vertexCount * 4).fill(0);

  groupTrianglesByMaterial(rw.triangles, rw.materials.length).forEach((tris, materialIndex) => {
    if (tris.length === 0) {
      return;
    }
    const material = rw.materials[materialIndex];
    // Lamp materials (`vehiclelights*`): the colour is a per-lamp ID for the ENGINE — render the texture
    // untinted (white) and carry the tag (head/tail) for lamp state (brake lights, night glow).
    const isLamp = (material.texture?.name.toLowerCase() ?? '').startsWith('vehiclelights');
    const lamp = isLamp
      ? (LAMP_MARKERS.get(`${material.color[0]},${material.color[1]},${material.color[2]}`) ?? null)
      : null;
    const color = isLamp
      ? ([255, 255, 255, material.color[3]] as [number, number, number, number])
      : paintedColor(material, paint);
    const layer = textures.resolve(material);
    const nightLayer = textures.resolveNightTwin(material);
    const indexOffset = scratch.indices.length;
    for (const tri of tris) {
      scratch.indices.push(baseVertex + tri.a, baseVertex + tri.b, baseVertex + tri.c);
      for (const corner of [tri.a, tri.b, tri.c]) {
        colorFill[corner * 4] = color[0];
        colorFill[corner * 4 + 1] = color[1];
        colorFill[corner * 4 + 2] = color[2];
        colorFill[corner * 4 + 3] = color[3];
        metaFill[corner * 4] = layer;
        metaFill[corner * 4 + 1] = nightLayer; // slots.y — the lamps-on twin (0 = none)
      }
    }
    scratch.submeshes.push({
      indexCount: tris.length * 3,
      indexOffset,
      lamp,
      part,
      translucent: color[3] < 250,
    });
  });
  scratch.colors.push(...colorFill);
  scratch.meta.push(...metaFill);
}

/** Anchor dummies: every named frame no atomic is attached to (headlights, exhaust, ped_frontseat, …). */
function collectDummies(clump: RWClump): VehicleFixture['dummies'] {
  const framesWithGeometry = new Set(clump.atomics.map((atomic) => atomic.frameIndex));
  const dummies: VehicleFixture['dummies'] = [];
  for (const [frameIndex, frame] of clump.frames.entries()) {
    const dummyName = frame.name.trim().toLowerCase();
    if (framesWithGeometry.has(frameIndex) || dummyName.length === 0) {
      continue;
    }
    const world = frameWorldTransform(clump.frames, frameIndex);
    dummies.push({
      name: dummyName,
      position: world ? world.pos : [0, 0, 0],
      rotation: world ? rotationToQuat(world.rot) : [0, 0, 0, 1],
    });
  }

  return dummies;
}

/** Shared wheel instanced at the dummies (right side spun 180° about up — mirroring flips winding). */
function instanceWheels(
  scratch: Scratch,
  clump: RWClump,
  wheelGeometry: number,
  parts: VehicleFixturePart[],
  wheels: VehicleFixture['wheels'],
  paint: Paint,
  textures: TextureSet,
): void {
  for (const [frameIndex, frame] of clump.frames.entries()) {
    const match = WHEEL_DUMMY_RE.exec(frame.name.trim().toLowerCase());
    if (!match) {
      continue;
    }
    const world = frameWorldTransform(clump.frames, frameIndex);
    const right = match[1] === 'r';
    const part = parts.length;
    parts.push({
      localRotation: right ? [0, 0, 1, 0] : [0, 0, 0, 1],
      localTranslation: world ? world.pos : [0, 0, 0],
      name: frame.name.trim().toLowerCase(),
    });
    appendGeometry(scratch, clump, wheelGeometry, part, paint, textures);
    wheels.push({
      front: match[2] === 'f',
      part,
      radius: wheelRadius(clump, wheelGeometry),
    });
  }
}

function main(): void {
  const argValue = (flag: string): null | string => {
    const index = process.argv.indexOf(`--${flag}`);

    return index >= 0 ? (process.argv[index + 1] ?? null) : null;
  };
  const game = argValue('game') ?? 'game-src/non-modified';
  const out = argValue('out') ?? 'apps/engine-lab/public/vehicle';
  const model = (argValue('model') ?? 'landstal').toLowerCase();
  // Full SA carcols scheme: four editable material colours; 3rd falls back to primary, 4th to secondary
  // (the prod build-vehicle semantics).
  const primary = parseColor(argValue('primary') ?? '64,110,180');
  const secondary = parseColor(argValue('secondary') ?? '200,200,200');
  const paint: Paint = {
    primary,
    quaternary: argValue('quaternary') ? parseColor(argValue('quaternary') ?? '') : secondary,
    secondary,
    tertiary: argValue('tertiary') ? parseColor(argValue('tertiary') ?? '') : primary,
  };

  const fs = openGameDir(game);
  const dffBytes = fs.get(`${model}.dff`);
  if (!dffBytes) {
    throw new Error(`${model}.dff not found in ${game}`);
  }
  const clump = parseDff(dffBytes);

  // Texture planner: every material texture referenced by the used atomics, model TXD first.
  const textures = new TextureSet(fs, model);
  const scratch: Scratch = { colors: [], indices: [], meta: [], normals: [], positions: [], submeshes: [], uvs: [] };
  const parts: VehicleFixturePart[] = [];
  const wheels: VehicleFixture['wheels'] = [];

  const wheelAtomic = clump.atomics.find(
    (atomic) => clump.frames[atomic.frameIndex]?.name.trim().toLowerCase() === 'wheel',
  );

  for (const atomic of clump.atomics) {
    const frameName = clump.frames[atomic.frameIndex]?.name.trim().toLowerCase() ?? '';
    if (frameName === 'wheel' || frameName.endsWith('_dam') || frameName.endsWith('_vlo')) {
      continue;
    }
    const world = frameWorldTransform(clump.frames, atomic.frameIndex);
    const part = parts.length;
    parts.push({
      localRotation: world ? rotationToQuat(world.rot) : [0, 0, 0, 1],
      localTranslation: world ? world.pos : [0, 0, 0],
      name: frameName || `part${part}`,
    });
    appendGeometry(scratch, clump, atomic.geometryIndex, part, paint, textures);
  }

  if (wheelAtomic) {
    instanceWheels(scratch, clump, wheelAtomic.geometryIndex, parts, wheels, paint, textures);
  }

  const { bin, fixture } = pack(model, scratch, parts, wheels, collectDummies(clump), textures);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'vehicle.json'), JSON.stringify(fixture));
  writeFileSync(join(out, 'vehicle.bin'), bin);
  console.log(
    `[vehicle-probe] ${model}: ${fixture.vertexCount} verts, ${fixture.indexCount / 3} tris, ` +
      `${parts.length} parts (${wheels.length} wheels), ${fixture.dummies.length} dummies, ${fixture.submeshes.length} submeshes, ` +
      `${fixture.textures.names.length} texture layers @${fixture.textures.width}², ` +
      `bin ${(bin.byteLength / 1024).toFixed(0)} KB → ${out}`,
  );
}

function pack(
  name: string,
  scratch: Scratch,
  parts: VehicleFixturePart[],
  wheels: VehicleFixture['wheels'],
  dummies: VehicleFixture['dummies'],
  textures: TextureSet,
): { bin: Uint8Array; fixture: VehicleFixture } {
  const vertexCount = scratch.positions.length / 3;
  const align4 = (value: number): number => Math.ceil(value / 4) * 4;
  let at = 0;
  const reserve = (bytes: number): number => {
    const offset = at;
    at = align4(at + bytes);

    return offset;
  };
  const layout = {
    colors: 0,
    indices: 0,
    meta: 0,
    normals: 0,
    positions: 0,
    uvs: 0,
  };
  layout.positions = reserve(vertexCount * 12);
  layout.normals = reserve(vertexCount * 12);
  layout.uvs = reserve(vertexCount * 8);
  layout.colors = reserve(vertexCount * 4);
  layout.meta = reserve(vertexCount * 4);
  layout.indices = reserve(scratch.indices.length * 2);
  const packed = textures.pack();
  const textureOffset = reserve(packed.bytes.byteLength);

  const bin = new Uint8Array(at);
  bin.set(new Uint8Array(new Float32Array(scratch.positions).buffer), layout.positions);
  bin.set(new Uint8Array(new Float32Array(scratch.normals).buffer), layout.normals);
  bin.set(new Uint8Array(new Float32Array(scratch.uvs).buffer), layout.uvs);
  bin.set(new Uint8Array(scratch.colors), layout.colors);
  bin.set(new Uint8Array(scratch.meta), layout.meta);
  bin.set(new Uint8Array(new Uint16Array(scratch.indices).buffer), layout.indices);
  bin.set(packed.bytes, textureOffset);

  return {
    bin,
    fixture: {
      dummies,
      indexCount: scratch.indices.length,
      layout,
      name,
      parts,
      submeshes: scratch.submeshes,
      textures: { height: packed.height, names: packed.names, offset: textureOffset, width: packed.width },
      vertexCount,
      wheels,
    },
  };
}

/** Marker colours → paint (the Kam's/ZModeler magic colours; lamp atlas colours are NOT markers). */
function paintedColor(material: RWMaterial, paint: Paint): [number, number, number, number] {
  const key = `${material.color[0]},${material.color[1]},${material.color[2]}`;
  if (key === PRIMARY_MARKER) {
    return [...paint.primary, material.color[3]];
  }
  if (key === SECONDARY_MARKER) {
    return [...paint.secondary, material.color[3]];
  }
  if (key === TERTIARY_MARKER) {
    return [...paint.tertiary, material.color[3]];
  }
  if (key === QUATERNARY_MARKER) {
    return [...paint.quaternary, material.color[3]];
  }

  return [material.color[0], material.color[1], material.color[2], material.color[3]];
}

function parseColor(raw: string): [number, number, number] {
  const parts = raw.split(',').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`bad colour '${raw}' (want r,g,b)`);
  }

  return [parts[0], parts[1], parts[2]];
}

/** Row-major RW rotation (already transposed by frameWorldTransform) → quaternion. */
function rotationToQuat(m: readonly number[]): [number, number, number, number] {
  // frameWorldTransform returns ROW-major m[row*3+col]; convert to quat directly.
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);

    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);

    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);

    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);

  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

function scaleTo(
  source: { height: number; rgba: Uint8Array; width: number },
  width: number,
  height: number,
): Uint8Array {
  const pow2 = resampleToPow2(source.rgba, source.width, source.height);
  if (pow2.width === width && pow2.height === height) {
    return pow2.rgba;
  }
  // Nearest-step bilinear chain would be nicer; a single bilinear resample is fine for the probe.
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(pow2.width - 1, Math.round((x / (width - 1)) * (pow2.width - 1)));
      const sy = Math.min(pow2.height - 1, Math.round((y / (height - 1)) * (pow2.height - 1)));
      for (let channel = 0; channel < 4; channel += 1) {
        out[(y * width + x) * 4 + channel] = pow2.rgba[(sy * pow2.width + sx) * 4 + channel];
      }
    }
  }

  return out;
}

function wheelRadius(clump: RWClump, geometryIndex: number): number {
  const positions = clump.geometries[geometryIndex].positions;
  let max = 0;
  for (let vertex = 0; vertex < positions.length; vertex += 3) {
    max = Math.max(max, Math.hypot(positions[vertex + 1], positions[vertex + 2]));
  }

  return max;
}

function whiteTexel(width: number, height: number): Uint8Array {
  return new Uint8Array(width * height * 4).fill(255);
}

main();
