/**
 * Vehicle model builder (plan 074/08 B5 step 2) — renderer-agnostic and browser-callable, so the game can
 * build a car at SPAWN time instead of loading a pre-extracted fixture. Carries the full three-path lore
 * (`three/build-vehicle.ts`): all four wheel conventions, `_ok`/`_dam` damage twins, `_vlo` LOD meshes,
 * `extraN` alternatives, door hinges, carcols paint markers and the lamp head/tail tags.
 *
 * Two deliberate differences from the three path, both forced by the shared-geometry instancing model:
 *   - paint is a per-vertex SLOT (`meta.z`), not a baked vertex colour — one model, many colours;
 *   - `_dam` / `_vlo` are extra SUBMESHES on the same buffers (hidden via per-submesh visibility), not
 *     separate meshes toggled through a scene graph, which the own engine does not have.
 */
import type { RWClump, RWGeometry, RWMaterial } from '../parsers/binary/types';
import type { VehicleTextures } from './textures';
import type {
  VehicleBuildOptions,
  VehicleDoor,
  VehicleDummy,
  VehicleModelData,
  VehicleModelPart,
  VehicleModelSubmesh,
  VehicleWheel,
} from './types';

import { frameWorldTransform, rotationToQuat } from '../mesh/frame-transform';
import { groupTrianglesByMaterial } from '../mesh/prepare-clump';
import { LampTag, PaintSlot } from './types';

/** SA per-lamp marker colours on the `vehiclelights*` atlas: they say WHICH lamp a material is — engine
 *  metadata, NEVER rendered (else garish green/yellow lamp patches). */
const LAMP_MARKERS = new Map<string, 'head' | 'tail'>([
  ['0,255,200', 'head'], // front right
  ['185,255,0', 'tail'], // rear left
  ['255,60,0', 'tail'], // rear right
  ['255,175,0', 'head'], // front left
]);

/** Kam's/ZModeler carcols paint markers → the per-vertex paint slot. */
const PAINT_MARKERS = new Map<string, number>([
  ['0,255,255', PaintSlot.tertiary],
  ['60,255,0', PaintSlot.primary],
  ['255,0,175', PaintSlot.secondary],
  ['255,255,0', PaintSlot.quaternary],
]);

/** Wheels read a touch small from the vehicles.ide scale alone; nudge them up (prod's WHEEL_SCALE_BOOST). */
const WHEEL_SCALE_BOOST = 1.25;

const DOOR_RE = /^door_(lf|rf|lr|rr)_ok$/;
const EXTRA_RE = /^extra\d+$/;
const WHEEL_CONTAINER_RE = /^f_wheel/;
/** Per-corner wheel atomics — SA's "different front/rear wheels" convention; `m` = 3-axle trucks. */
const WHEEL_CORNER_RE = /^wheel_(lf|rf|lm|rm|lb|rb)$/;
const WHEEL_DUMMY_RE = /^wheel_(l|r)([fmb])_dummy$/;
const WHEEL_FRAME = 'wheel';

interface Scratch {
  colors: number[];
  indices: number[];
  meta: number[];
  normals: number[];
  parts: VehicleModelPart[];
  positions: number[];
  submeshes: VehicleModelSubmesh[];
  uvs: number[];
}

/** Mirrors prod's `buildVehicle(clump, textures, options)` — callers own parsing (tests pass clumps). */
export function buildVehicleModel(
  clump: RWClump,
  textures: VehicleTextures,
  options: VehicleBuildOptions = {},
): VehicleModelData {
  const scratch: Scratch = {
    colors: [],
    indices: [],
    meta: [],
    normals: [],
    parts: [],
    positions: [],
    submeshes: [],
    uvs: [],
  };
  const doors: VehicleDoor[] = [];
  const damGeometry = collectDamGeometry(clump);
  const containerFrames = collectContainerFrames(clump);
  const hiddenExtras = hiddenExtraFrames(clump, options.rng ?? Math.random);
  const wheelScale = options.wheelScale ?? [1, 1];

  let sharedWheel: null | number = null;
  const cornerWheels: { frameIndex: number; front: boolean; geometryIndex: number; right: boolean }[] = [];
  const containerWheels: number[] = [];

  for (const atomic of clump.atomics) {
    const name = frameName(clump, atomic.frameIndex);
    if (containerFrames.has(atomic.frameIndex)) {
      containerWheels.push(atomic.geometryIndex); // wheel sub-model — instanced at the dummies below
      continue;
    }
    if (name === WHEEL_FRAME) {
      sharedWheel = atomic.geometryIndex;
      continue;
    }
    const corner = WHEEL_CORNER_RE.exec(name)?.[1];
    if (corner) {
      cornerWheels.push({
        frameIndex: atomic.frameIndex,
        front: corner[1] === 'f',
        geometryIndex: atomic.geometryIndex,
        right: corner[0] === 'r',
      });
      continue;
    }
    if (name.endsWith('_dam') || hiddenExtras.has(atomic.frameIndex)) {
      continue; // `_dam` rides with its `_ok` twin; unchosen `extraN` alternatives never render
    }
    addBodyAtomic(scratch, clump, atomic.geometryIndex, name, atomic.frameIndex, textures, damGeometry, doors);
  }

  const wheels = addWheels(scratch, clump, textures, wheelScale, { containerWheels, cornerWheels, sharedWheel });

  return {
    colors: new Uint8Array(scratch.colors),
    doors,
    dummies: collectDummies(clump),
    indices: new Uint16Array(scratch.indices),
    meta: new Uint8Array(scratch.meta),
    normals: new Float32Array(scratch.normals),
    parts: scratch.parts,
    positions: new Float32Array(scratch.positions),
    submeshes: scratch.submeshes,
    texture: textures.pack(),
    uvs: new Float32Array(scratch.uvs),
    wheels,
  };
}

/** One body atomic: its part, its `body` submeshes, plus the hidden `_dam` twin and `_vlo` LOD if present. */
function addBodyAtomic(
  scratch: Scratch,
  clump: RWClump,
  geometryIndex: number,
  name: string,
  frameIndex: number,
  textures: VehicleTextures,
  damGeometry: Map<string, RWGeometry>,
  doors: VehicleDoor[],
): void {
  const lod = name.endsWith('_vlo');
  const door = DOOR_RE.exec(name);
  const part = door
    ? addDoorPart(scratch, clump, frameIndex, `door_${door[1]}`)
    : addPart(scratch, clump, frameIndex, name);
  if (door) {
    doors.push({ name: `door_${door[1]}`, part, side: door[1] });
  }
  const base = lod ? name.slice(0, -4) : name;
  appendGeometry(scratch, clump.geometries[geometryIndex], part, textures, lod ? 'lod' : 'body', null);
  if (lod) {
    return; // the `_vlo` mesh has no damage twin of its own
  }
  const damKey = name.endsWith('_ok') ? name.slice(0, -3) : base;
  const dam = damGeometry.get(damKey);
  if (dam) {
    appendGeometry(scratch, dam, part, textures, 'dam', damKey);
    // The intact submeshes of this part pair with the twin: tag them so the damage system can flip them.
    for (const submesh of scratch.submeshes) {
      if (submesh.part === part && submesh.kind === 'body') {
        submesh.damageGroup = damKey;
      }
    }
  }
}

/** A door part pivots on its HINGE frame (the parent), with the door mesh offset inside it — see rigid.ts. */
function addDoorPart(scratch: Scratch, clump: RWClump, frameIndex: number, name: string): number {
  const frame = clump.frames[frameIndex];
  const hinge = frame.parentIndex >= 0 ? frameWorldTransform(clump.frames, frame.parentIndex) : null;
  const part = scratch.parts.length;
  scratch.parts.push({
    localRotation: hinge ? rotationToQuat(hinge.rot) : [0, 0, 0, 1],
    localTranslation: hinge ? hinge.pos : [0, 0, 0],
    name,
    offset: frameMatrix(frame.rotation, frame.position),
  });

  return part;
}

function addPart(scratch: Scratch, clump: RWClump, frameIndex: number, name: string, scale?: number): number {
  const world = frameWorldTransform(clump.frames, frameIndex);
  const part = scratch.parts.length;
  scratch.parts.push({
    localRotation: world ? rotationToQuat(world.rot) : [0, 0, 0, 1],
    localTranslation: world ? world.pos : [0, 0, 0],
    name: name || `part${part}`,
    ...(scale === undefined ? {} : { scale }),
  });

  return part;
}

/**
 * Wheels, in prod's precedence: a lone corner atomic with no shared `wheel` but real dummies is a MIS-NAMED
 * shared wheel (comet and friends ship only `wheel_rf` expecting it at all four corners) → shared; genuine
 * per-corner sets (≥2) stay per-corner; then the shared atomic; then the `f_wheel_*` container sub-model.
 */
function addWheels(
  scratch: Scratch,
  clump: RWClump,
  textures: VehicleTextures,
  wheelScale: readonly [number, number],
  source: {
    containerWheels: readonly number[];
    cornerWheels: readonly { frameIndex: number; front: boolean; geometryIndex: number; right: boolean }[];
    sharedWheel: null | number;
  },
): VehicleWheel[] {
  const { containerWheels, cornerWheels, sharedWheel } = source;
  const dummies = hasWheelDummies(clump);
  if (sharedWheel === null && cornerWheels.length === 1 && dummies) {
    return instanceWheels(scratch, clump, cornerWheels[0].geometryIndex, textures, wheelScale);
  }
  if (cornerWheels.length > 0) {
    return cornerWheels.map((wheel) => {
      const scale = axleScale(wheelScale, wheel.front);
      const part = addPart(scratch, clump, wheel.frameIndex, frameName(clump, wheel.frameIndex), scale);
      appendGeometry(scratch, clump.geometries[wheel.geometryIndex], part, textures, 'body', null);

      return { front: wheel.front, part, radius: wheelRadius(clump.geometries[wheel.geometryIndex]) * scale };
    });
  }
  if (sharedWheel !== null) {
    return instanceWheels(scratch, clump, sharedWheel, textures, wheelScale);
  }
  if (containerWheels.length > 0 && dummies) {
    return instanceWheels(scratch, clump, containerWheels[0], textures, wheelScale);
  }

  return [];
}

/**
 * Weld one geometry's triangles, one submesh per material. Colours stay the MATERIAL's; carcols markers
 * become a per-vertex paint slot instead (resolved per instance), and lamp materials render white while
 * their marker becomes the head/tail tag.
 */
function appendGeometry(
  scratch: Scratch,
  rw: RWGeometry | undefined,
  part: number,
  textures: VehicleTextures,
  kind: VehicleModelSubmesh['kind'],
  damageGroup: null | string,
): void {
  if (!rw) {
    return;
  }
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
  const colorFill = new Array<number>(vertexCount * 4).fill(255);
  const metaFill = new Array<number>(vertexCount * 4).fill(0);

  groupTrianglesByMaterial(rw.triangles, rw.materials.length).forEach((tris, materialIndex) => {
    if (tris.length === 0) {
      return;
    }
    const material = rw.materials[materialIndex];
    const lamp = lampTag(material);
    const paint = lamp === null ? paintSlot(material) : PaintSlot.none;
    // Marker colours (lamp IDs and carcols slots) are METADATA and must never reach a pixel: both render
    // white and carry their meaning elsewhere (the lamp tag / the paint slot). Leaving the marker in the
    // vertex colour would paint the car marker-green the moment a slot lookup missed.
    const marker = lamp !== null || paint !== PaintSlot.none;
    const color: [number, number, number, number] = marker
      ? [255, 255, 255, material.color[3]]
      : [material.color[0], material.color[1], material.color[2], material.color[3]];
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
        metaFill[corner * 4 + 1] = nightLayer;
        metaFill[corner * 4 + 2] = paint;
        metaFill[corner * 4 + 3] = lamp === null ? LampTag.none : LampTag[lamp];
      }
    }
    scratch.submeshes.push({
      damageGroup,
      indexCount: tris.length * 3,
      indexOffset,
      kind,
      lamp,
      part,
      // Glass carries its opacity in the MATERIAL colour; body decals (scratch/crack overlays, badges) carry
      // it in the TEXTURE's texels. Both must blend — a decal drawn opaque paints its transparent (black)
      // texels straight over the door.
      translucent: color[3] < 250 || textures.hasAlpha(material),
    });
  });
  scratch.colors.push(...colorFill);
  scratch.meta.push(...metaFill);
}

/** SA scales the axles separately (vehicles.ide gives [front, rear]); the in-engine boost rides on top. */
function axleScale(wheelScale: readonly [number, number], front: boolean): number {
  return (front ? wheelScale[0] : wheelScale[1]) * WHEEL_SCALE_BOOST;
}

/** `f_wheel_<mask>` container frames (and their descendants): the wheel sub-model, not body geometry. */
function collectContainerFrames(clump: RWClump): Set<number> {
  const frames = new Set<number>();
  for (const [index, frame] of clump.frames.entries()) {
    if (WHEEL_CONTAINER_RE.test(frame.name.trim().toLowerCase())) {
      frames.add(index);
    }
  }
  if (frames.size === 0 || !hasWheelDummies(clump)) {
    return new Set();
  }
  // Descendants ride with the container.
  for (const [index, frame] of clump.frames.entries()) {
    for (let at = frame.parentIndex; at >= 0; at = clump.frames[at].parentIndex) {
      if (frames.has(at)) {
        frames.add(index);
        break;
      }
    }
  }

  return frames;
}

/** Index every `_dam` atomic's geometry by its part name (the prefix before `_dam`). */
function collectDamGeometry(clump: RWClump): Map<string, RWGeometry> {
  const damGeometry = new Map<string, RWGeometry>();
  for (const atomic of clump.atomics) {
    const name = frameName(clump, atomic.frameIndex);
    const geometry = clump.geometries[atomic.geometryIndex];
    if (geometry && name.endsWith('_dam')) {
      damGeometry.set(name.slice(0, -4), geometry);
    }
  }

  return damGeometry;
}

/** Every named frame with no atomic attached: headlights, exhaust, ped_frontseat, the wheel dummies … */
function collectDummies(clump: RWClump): VehicleDummy[] {
  const withGeometry = new Set(clump.atomics.map((atomic) => atomic.frameIndex));
  const dummies: VehicleDummy[] = [];
  for (const [frameIndex, frame] of clump.frames.entries()) {
    const name = frame.name.trim().toLowerCase();
    if (withGeometry.has(frameIndex) || name.length === 0) {
      continue;
    }
    const world = frameWorldTransform(clump.frames, frameIndex);
    dummies.push({
      name,
      position: world ? world.pos : [0, 0, 0],
      rotation: world ? rotationToQuat(world.rot) : [0, 0, 0, 1],
    });
  }

  return dummies;
}

/** RW frame rotation (column-major basis) + position → a column-major mat4. */
function frameMatrix(rotation: readonly number[], position: readonly number[]): number[] {
  const [r0, r1, r2, r3, r4, r5, r6, r7, r8] = rotation;

  return [r0, r1, r2, 0, r3, r4, r5, 0, r6, r7, r8, 0, position[0], position[1], position[2], 1];
}

function frameName(clump: RWClump, frameIndex: number): string {
  return clump.frames[frameIndex]?.name.trim().toLowerCase() ?? '';
}

function hasWheelDummies(clump: RWClump): boolean {
  return clump.frames.some((frame) => WHEEL_DUMMY_RE.test(frame.name.trim().toLowerCase()));
}

/**
 * SA shows at most ONE `extraN` component — they are mutually-exclusive alternatives modelled at the same
 * spot (the Benson's swappable ad boards). Rendering them all overlaps into a jumble.
 */
function hiddenExtraFrames(clump: RWClump, rng: () => number): Set<number> {
  const extras = clump.atomics
    .map((atomic) => atomic.frameIndex)
    .filter((frameIndex) => EXTRA_RE.test(frameName(clump, frameIndex)));
  if (extras.length === 0) {
    return new Set();
  }
  const chosen = extras[Math.min(extras.length - 1, Math.floor(rng() * extras.length))];

  return new Set(extras.filter((frameIndex) => frameIndex !== chosen));
}

/** The shared wheel atomic, instanced at every `wheel_*_dummy` (right side spun 180° — mirroring would
 *  flip the winding). */
function instanceWheels(
  scratch: Scratch,
  clump: RWClump,
  geometryIndex: number,
  textures: VehicleTextures,
  wheelScale: readonly [number, number],
): VehicleWheel[] {
  const wheels: VehicleWheel[] = [];
  const baseRadius = wheelRadius(clump.geometries[geometryIndex]);
  for (const [frameIndex, frame] of clump.frames.entries()) {
    const match = WHEEL_DUMMY_RE.exec(frame.name.trim().toLowerCase());
    if (!match) {
      continue;
    }
    const front = match[2] === 'f';
    const scale = axleScale(wheelScale, front);
    const world = frameWorldTransform(clump.frames, frameIndex);
    const right = match[1] === 'r';
    const part = scratch.parts.length;
    scratch.parts.push({
      localRotation: right ? [0, 0, 1, 0] : [0, 0, 0, 1],
      localTranslation: world ? world.pos : [0, 0, 0],
      name: frame.name.trim().toLowerCase(),
      scale,
    });
    appendGeometry(scratch, clump.geometries[geometryIndex], part, textures, 'body', null);
    wheels.push({ front, part, radius: baseRadius * scale });
  }

  return wheels;
}

function lampTag(material: RWMaterial): 'head' | 'tail' | null {
  if (!(material.texture?.name.toLowerCase() ?? '').startsWith('vehiclelights')) {
    return null;
  }

  return LAMP_MARKERS.get(`${material.color[0]},${material.color[1]},${material.color[2]}`) ?? null;
}

function paintSlot(material: RWMaterial): number {
  return PAINT_MARKERS.get(`${material.color[0]},${material.color[1]},${material.color[2]}`) ?? PaintSlot.none;
}

function wheelRadius(geometry: RWGeometry | undefined): number {
  if (!geometry) {
    return 0.35;
  }
  let max = 0;
  for (let vertex = 0; vertex < geometry.positions.length; vertex += 3) {
    max = Math.max(max, Math.hypot(geometry.positions[vertex + 1], geometry.positions[vertex + 2]));
  }

  return max;
}
