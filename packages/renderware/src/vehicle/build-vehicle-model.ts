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
import { groupTrianglesByMaterial, NIGHT_AMBIENT } from '../mesh/prepare-clump';
import { skyOcclusion } from './sky-occlusion';
import { LampTag, MaterialClass, PaintSlot } from './types';

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
  night: number[];
  normals: number[];
  parts: VehicleModelPart[];
  positions: number[];
  reflect: number[];
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
    night: [],
    normals: [],
    parts: [],
    positions: [],
    reflect: [],
    submeshes: [],
    uvs: [],
  };
  const doors: VehicleDoor[] = [];
  const damGeometry = collectDamGeometry(clump);
  const containerFrames = collectContainerFrames(clump);
  const hiddenExtras = hiddenExtraFrames(clump, options.rng ?? Math.random);
  const wheelScale = options.wheelScale ?? [1, 1];

  let sharedWheel: null | { frameIndex: number; geometryIndex: number } = null;
  const cornerWheels: { frameIndex: number; front: boolean; geometryIndex: number; right: boolean }[] = [];
  const containerWheels: number[] = [];

  for (const atomic of clump.atomics) {
    const name = frameName(clump, atomic.frameIndex);
    if (containerFrames.has(atomic.frameIndex)) {
      containerWheels.push(atomic.geometryIndex); // wheel sub-model — instanced at the dummies below
      continue;
    }
    if (name === WHEEL_FRAME) {
      sharedWheel = { frameIndex: atomic.frameIndex, geometryIndex: atomic.geometryIndex };
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
  // Self-occlusion rides in the NIGHT set's alpha, which the builder had been filling with a constant 255:
  // the shader already reads that stream per vertex, so a car carries its own AO with no new buffer, no
  // `.osm` version bump and no second upload. See `sky-occlusion.ts` for why it is computed here.
  const night = new Uint8Array(scratch.night);
  const occlusion = skyOcclusion(scratch.positions, scratch.normals, scratch.positions.length / 3, shownShell(scratch));
  for (let vertex = 0; vertex < occlusion.length; vertex += 1) {
    night[vertex * 4 + 3] = occlusion[vertex];
  }

  return {
    colors: new Uint8Array(scratch.colors),
    doors,
    dummies: collectDummies(clump),
    // Index width follows the model: uint16 while it fits, uint32 past the ceiling. Stock SA never comes
    // near it, but hi-poly mod cars do (the field pair was 86 511 and 82 991 verts), and this used to THROW
    // — which took the whole vehicle system down with it, because the throw landed in the fixed step.
    indices: indicesFor(scratch.positions.length / 3, scratch.indices),
    meta: new Uint8Array(scratch.meta),
    night,
    normals: new Float32Array(scratch.normals),
    parts: scratch.parts,
    positions: new Float32Array(scratch.positions),
    reflect: new Uint8Array(scratch.reflect),
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
    sharedWheel: null | { frameIndex: number; geometryIndex: number };
  },
): VehicleWheel[] {
  const { containerWheels, cornerWheels, sharedWheel } = source;
  const dummies = hasWheelDummies(clump);
  if (sharedWheel === null && cornerWheels.length === 1 && dummies) {
    const lone = cornerWheels[0];

    return instanceWheels(scratch, clump, lone.geometryIndex, textures, wheelScale, lone.frameIndex);
  }
  if (cornerWheels.length > 0) {
    // Per-corner sets reuse ONE authored mesh across the corners (petro's left and right geometries are
    // byte-identical), so the far side needs the same flip the instanced conventions get.
    const authoredRight = authoredWheelRight(clump);

    return cornerWheels.map((wheel) => {
      const authoredRadius = wheelRadius(clump.geometries[wheel.geometryIndex]);
      const scale = axleScale(wheelScale, wheel.front, authoredRadius);
      const part = addPart(scratch, clump, wheel.frameIndex, frameName(clump, wheel.frameIndex), scale);
      if (wheel.right !== authoredRight) {
        scratch.parts[part].localRotation = flipWheelSide(scratch.parts[part].localRotation);
      }
      appendGeometry(scratch, clump.geometries[wheel.geometryIndex], part, textures, 'body', null);

      return { front: wheel.front, part, radius: authoredRadius * scale };
    });
  }
  if (sharedWheel !== null) {
    return instanceWheels(scratch, clump, sharedWheel.geometryIndex, textures, wheelScale, sharedWheel.frameIndex);
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
 *
 * Vertices are emitted PER MATERIAL GROUP, not once per geometry. SA geometries do share a vertex between
 * two materials (6.9 % of the modded map's models), and with one vertex table the per-vertex attributes —
 * layer, colour, paint slot, reflection — were written by whichever material came last, so the shared corner
 * rendered with the wrong material's texture. Emitting per group also drops vertices no triangle references.
 * Measured over 2 000 real map models: +0.2 % vertices in total.
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
  groupTrianglesByMaterial(rw.triangles, rw.materials.length).forEach((tris, materialIndex) => {
    if (tris.length === 0) {
      return;
    }
    const material = rw.materials[materialIndex];
    const surface = materialSurface(material, textures, kind);
    const { color, klass, lamp, layer, nightLayer, paint, reflect } = surface;
    const indexOffset = scratch.indices.length;
    const center: [number, number, number] = [0, 0, 0];
    // This group's own copy of each vertex it touches, keyed by the source index.
    const emitted = new Map<number, number>();
    const emit = (corner: number): number => {
      const existing = emitted.get(corner);
      if (existing !== undefined) {
        return existing;
      }
      const index = scratch.positions.length / 3;
      scratch.positions.push(rw.positions[corner * 3], rw.positions[corner * 3 + 1], rw.positions[corner * 3 + 2]);
      if (rw.normals) {
        scratch.normals.push(rw.normals[corner * 3], rw.normals[corner * 3 + 1], rw.normals[corner * 3 + 2]);
      } else {
        scratch.normals.push(0, 0, 1);
      }
      const uvs = rw.uvLayers[0];
      scratch.uvs.push(uvs ? uvs[corner * 2] : 0, uvs ? uvs[corner * 2 + 1] : 0);
      // PRELIT vertex colours modulate the material's (074/... — opensa-pack 003 phase 5g). SA bakes the
      // map's lighting there and it is DARK: 2 972 of 3 000 map models carry a non-white set, mean luma
      // 88/255, so ignoring it renders a building roughly three times too bright. Vehicles are unaffected
      // by construction — not one of the game's 198 cars carries a prelit set at all.
      const day = rw.prelitColors;
      const night = rw.nightColors;
      scratch.colors.push(
        modulate(color[0], day, corner, 0),
        modulate(color[1], day, corner, 1),
        modulate(color[2], day, corner, 2),
        color[3],
      );
      // The night set replaces the day colour as `dn` goes to 1. Without an authored one, synthesize it the
      // way the welded cell path does — one night formula for the whole world, or a converted prop would
      // disagree with the cell it stands in. But ONLY for prelit geometry: an asset with no prelit set is
      // not part of the baked-lighting world (no car carries one), and darkening it here would dim every
      // vehicle at midnight on top of the world light that already does that job.
      const dayRgb = scratch.colors.slice(-4, -1);
      scratch.night.push(
        ...(night
          ? [
              modulate(color[0], night, corner, 0),
              modulate(color[1], night, corner, 1),
              modulate(color[2], night, corner, 2),
            ]
          : dayRgb.map((channel, index) => (day ? Math.round(channel * NIGHT_AMBIENT[index]) : channel))),
        255,
      );
      scratch.meta.push(layer, nightLayer, paint, (lamp === null ? LampTag.none : LampTag[lamp]) | (klass << 4));
      scratch.reflect.push(reflect[0], reflect[1], reflect[2], reflect[3]);
      emitted.set(corner, index);

      return index;
    };
    for (const tri of tris) {
      scratch.indices.push(emit(tri.a), emit(tri.b), emit(tri.c));
      for (const corner of [tri.a, tri.b, tri.c]) {
        center[0] += rw.positions[corner * 3];
        center[1] += rw.positions[corner * 3 + 1];
        center[2] += rw.positions[corner * 3 + 2];
      }
    }
    const corners = tris.length * 3;
    const centroid: [number, number, number] = [center[0] / corners, center[1] / corners, center[2] / corners];
    // Bounding radius about the centroid (074/16 sort fix): the translucent sort subtracts it, so a LARGE
    // sheet (a raked windscreen) counts as nearer than its centre — a single centroid put the wheel OVER
    // the glass overhang at down-looking angles.
    let radiusSq = 0;
    for (const tri of tris) {
      for (const corner of [tri.a, tri.b, tri.c]) {
        radiusSq = Math.max(
          radiusSq,
          (rw.positions[corner * 3] - centroid[0]) ** 2 +
            (rw.positions[corner * 3 + 1] - centroid[1]) ** 2 +
            (rw.positions[corner * 3 + 2] - centroid[2]) ** 2,
        );
      }
    }
    scratch.submeshes.push({
      center: centroid,
      damageGroup,
      indexCount: tris.length * 3,
      indexOffset,
      kind,
      lamp,
      part,
      radius: Math.sqrt(radiusSq),
      translucent: surface.translucent,
    });
  });
}

/**
 * Which side a wheel mesh was authored on — READ FROM THE MODEL, not assumed. Walking up from the frame the
 * mesh hangs on, the first corner name found gives the side: either the mesh's own `wheel_rf` (a lone corner
 * atomic instanced at every dummy) or the `wheel_rf_dummy` its shared `wheel` frame is parented to. Every
 * model measured — stock and modded, 4- and 6-wheeled — authors on the RIGHT, which is the fallback when a
 * model offers no frame to read; reading it means a left-authored model works with no code change.
 *
 * The dummies themselves carry no signal: every wheel dummy measured is identity-rotated, so their rotation
 * (which IS honoured, below) never encodes the side.
 */
function authoredWheelRight(clump: RWClump, fromFrame?: number): boolean {
  const start = fromFrame ?? clump.frames.findIndex((frame) => frame.name.trim().toLowerCase() === WHEEL_FRAME);
  for (let at = start; at >= 0; at = clump.frames[at].parentIndex) {
    const name = frameName(clump, at);
    const side = WHEEL_DUMMY_RE.exec(name)?.[1] ?? WHEEL_CORNER_RE.exec(name)?.[1][0];
    if (side) {
      return side === 'r';
    }
  }

  return true;
}

/** SA scales the axles separately (vehicles.ide gives [front, rear]); the in-engine boost rides on top. */
/**
 * Fit an authored wheel mesh to the size the data asks for. `vehicles.ide`'s wheel field (the modloader
 * `.settings.txt` line carries the same one) is the wheel DIAMETER IN METRES, not a multiplier — measured
 * against the stock meshes it names: admiral 0.68 vs a 0.700 m mesh, cheetah 0.68 vs 0.688, infernus 0.70 vs
 * 0.700, petro 1.106 vs 1.182. Ratios of 0.94–1.00, i.e. every stock mesh is already modelled at its target.
 *
 * Multiplying by it instead shrank every wheel by a third, which is what prod's 1.25 "wheels read a touch
 * small" boost was patching over (0.70 × 1.25 = 0.875 — still 12 % short, hence the wording). Fitting to the
 * diameter needs no fudge and is a no-op for a mesh authored at size, so ONE rule covers all four wheel
 * conventions instead of exempting the per-corner and container ones.
 */
function axleScale(wheelScale: readonly [number, number], front: boolean, authoredRadius: number): number {
  const diameter = authoredRadius * 2;

  return diameter > 0 ? (front ? wheelScale[0] : wheelScale[1]) / diameter : 1;
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

/**
 * Turn a wheel to the side it is MOUNTED on, given a mesh authored for the other one: `q ⊗ [0, 0, 1, 0]`, a
 * 180° spin about the hub's up axis composed after the frame's own rotation.
 *
 * Not a mirror — a negative scale would invert the triangle winding — and the spin is what resolves BOTH
 * authoring conventions found in the wild: a mesh reused verbatim on both sides (petro's left and right
 * geometries are byte-identical), and one the author already pre-mirrored about Y (comet, where the spin's
 * own Y flip cancels the author's and the surviving X flip is the true side change).
 *
 * `|| 0` normalises the negated zeros: a quaternion of `-0`s does not compare equal to its positive twin.
 */
function flipWheelSide(q: readonly [number, number, number, number]): [number, number, number, number] {
  return [q[1], -q[0] || 0, q[3], -q[2] || 0];
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

/** Narrowest index array the vertex count allows — see the call site. */
function indicesFor(vertexCount: number, indices: number[]): Uint16Array | Uint32Array {
  return vertexCount > 65536 ? new Uint32Array(indices) : new Uint16Array(indices);
}

/**
 * The shared wheel atomic, instanced at every `wheel_*_dummy`, each dummy's own orientation honoured and the
 * copies on the far side from {@link authoredWheelRight} turned by {@link flipWheelSide}.
 */
function instanceWheels(
  scratch: Scratch,
  clump: RWClump,
  geometryIndex: number,
  textures: VehicleTextures,
  wheelScale: readonly [number, number],
  sourceFrame?: number,
): VehicleWheel[] {
  const wheels: VehicleWheel[] = [];
  const baseRadius = wheelRadius(clump.geometries[geometryIndex]);
  const authoredRight = authoredWheelRight(clump, sourceFrame);
  for (const [frameIndex, frame] of clump.frames.entries()) {
    const match = WHEEL_DUMMY_RE.exec(frame.name.trim().toLowerCase());
    if (!match) {
      continue;
    }
    const front = match[2] === 'f';
    const scale = axleScale(wheelScale, front, baseRadius);
    const world = frameWorldTransform(clump.frames, frameIndex);
    const right = match[1] === 'r';
    const mounted: [number, number, number, number] = world ? rotationToQuat(world.rot) : [0, 0, 0, 1];
    const part = scratch.parts.length;
    scratch.parts.push({
      localRotation: right === authoredRight ? mounted : flipWheelSide(mounted),
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

/**
 * Material CLASS (074/16 field round 2 — see {@link MaterialClass}): which reflection model a texel gets.
 * Signals, in priority order:
 *   - `_vlo` LOD meshes, lamps, non-reflective materials (env coefficient 0 — SA's own "not reflective"
 *     marker on tyres/rubber/trim) → MATTE, excluded from reflections entirely;
 *   - translucency → GLASS (sharp mirror, no flakes; the blend pipeline);
 *   - a chrome base texture or the `vehicleenvmap*` env map (SA's chrome/glass sphere photo) → CHROME;
 *   - carcols paint slots and the `xvehicleenv*` env map (SA's painted-horizon sphere map) → PAINT.
 * Custom cars ship their OWN chrome/env textures — the texture-name check catches the common `chrome`
 * naming, and anything env-mapped that matches nothing else stays PAINT (its own sphere map still supplies
 * the pattern).
 */
/**
 * Material CLASS (074/16 rounds 2–4 — see {@link MaterialClass}): which reflection model a texel gets.
 * Priority: lod/lamps/non-reflective (env coefficient 0 — SA's "not reflective" marker on tyres/trim) →
 * MATTE; translucent → GLASS; carcols slots → PAINT; UNTEXTURED neutral-grey env-mapped → CHROME; any
 * other env-mapped material → PAINT.
 *
 * Deliberately NO texture/env NAME matching (user directive, round 4): mods combine arbitrary names, so
 * the only chrome signal is a pure DATA one — bare grey + an env map is how the surveyed ./1 mods author
 * bumpers and trim (rgb ≈ 153, no base texture). Textured chrome sheets simply stay PAINT: under the neo
 * reflection model (one LERP law for every material) the difference is only the mip and the coefficient
 * floor, and their grey texture reads metallic through the same formula — exactly how skygfx treats them.
 */
function materialClass(
  material: RWMaterial,
  flags: {
    kind: VehicleModelSubmesh['kind'];
    lamp: null | string;
    paint: number;
    reflective: boolean;
    translucent: boolean;
  },
): number {
  if (flags.kind === 'lod' || flags.lamp !== null || !flags.reflective) {
    return MaterialClass.matte;
  }
  if (flags.translucent) {
    return MaterialClass.glass;
  }
  if (flags.paint !== PaintSlot.none) {
    return MaterialClass.paint; // carcols marker is authoritative
  }
  const [r, g, b] = material.color;
  const bareMetal = material.texture === null && Math.max(r, g, b) - Math.min(r, g, b) <= 20 && (r + g + b) / 3 >= 90;

  return bareMetal ? MaterialClass.chrome : MaterialClass.paint;
}

/**
 * Everything one MATERIAL contributes to its vertices/submesh, resolved once per triangle group.
 * Marker colours (lamp IDs and carcols slots) are METADATA and must never reach a pixel: both render white
 * and carry their meaning elsewhere (the lamp tag / the paint slot). Glass carries its opacity in the
 * MATERIAL colour; body decals (scratch/crack overlays, badges) carry it in the TEXTURE's texels — both
 * must blend, or a decal's transparent black texels paint straight over the door.
 */
function materialSurface(
  material: RWMaterial,
  textures: VehicleTextures,
  kind: VehicleModelSubmesh['kind'],
): {
  color: [number, number, number, number];
  klass: number;
  lamp: 'head' | 'tail' | null;
  layer: number;
  nightLayer: number;
  paint: number;
  reflect: [number, number, number, number];
  translucent: boolean;
} {
  const lamp = lampTag(material);
  const paint = lamp === null ? paintSlot(material) : PaintSlot.none;
  const marker = lamp !== null || paint !== PaintSlot.none;
  const color: [number, number, number, number] = marker
    ? [255, 255, 255, material.color[3]]
    : [material.color[0], material.color[1], material.color[2], material.color[3]];
  const layer = textures.resolve(material);
  const nightLayer = textures.resolveNightTwin(material);
  const reflect = reflectionOf(material);
  const translucent = color[3] < 250 || textures.hasAlpha(material);

  return {
    color,
    klass: materialClass(material, { kind, lamp, paint, reflective: reflect[1] > 0, translucent }),
    lamp,
    layer,
    nightLayer,
    paint,
    reflect,
    translucent,
  };
}

/** One channel of a material colour, modulated by a prelit set when the geometry carries one. */
function modulate(channel: number, prelit: null | Uint8Array, vertex: number, offset: number): number {
  return prelit ? Math.round((channel * prelit[vertex * 4 + offset]) / 255) : channel;
}

function paintSlot(material: RWMaterial): number {
  return PAINT_MARKERS.get(`${material.color[0]},${material.color[1]},${material.color[2]}`) ?? PaintSlot.none;
}

/**
 * The material's DFF reflection settings → the per-vertex reflect slots.
 *
 * SA authors reflectivity with THREE plugins and a material may carry any subset. The env map used to gate
 * the whole thing, which rendered a common authoring shape fully MATTE: an exhaust or a bare-metal trim with
 * `reflection` + `specular` and no env map at all (the mod admiral's exhaust: intensity 0.50, specular 0.17).
 * Prod never showed it because its `enhanced` preset supplied clearcoat as a CONSTANT, so those materials
 * read as dull chrome. The env map is not what makes a surface reflective — it is only one of the inputs,
 * and it does not even supply the COLOUR here: `rigidEnv` reflects the live probe, never the DFF texture.
 *
 * A coefficient of 0 on an env map still means "not reflective" — SA's own marker on tyres and rubber — so
 * a material that carries an env map and zeroes it stays matte no matter what else it has.
 */
function reflectionOf(material: RWMaterial): [number, number, number, number] {
  const effects = material.effects;
  const env = effects?.envMap;
  const intensity = effects?.reflection?.intensity ?? 0;
  const specular = effects?.specular?.level ?? 0;
  if (env && (env.coefficient <= 0 || !env.texture)) {
    return [0, 0, 0, 0];
  }
  // Without an env map the fallback is narrowed to UNTEXTURED materials, and that is not a taste call:
  // measured on the two field mods, their exporter stamps `reflection` on every material they ship, so
  // taking the plugin alone turned 100 % of both cars reflective — carpet, leather and tyres included
  // (stock cars, authored by hand, sit at 42-60 %). A material with no base texture is the one SA uses for
  // bare metal and plastic — the exhaust, the trim, the bumper irons — and its own colour IS the surface.
  const coefficient = env ? env.coefficient : material.texture === null ? intensity : 0;
  if (coefficient <= 0) {
    return [0, 0, 0, 0];
  }
  const byte = (value: number): number => Math.max(0, Math.min(255, Math.round(value * 255)));

  // Slot 0 is SPARE. It used to carry the env texture's array layer, and nothing ever sampled it: the neo
  // pipe reflects the LIVE probe, so SA's baked env photo is not the colour source and claiming a layer for
  // it only made every car ship a 512x512 texture it never read.
  return [0, byte(coefficient), byte(intensity), byte(specular)];
}

/**
 * Which vertices belong to the shell the car SHOWS, so only that shell casts sky occlusion: the hidden
 * `_dam` twins and the `_vlo` LOD ride in the same buffers, and the LOD is a closed blob — over a
 * convertible it would roof an open cabin that has no roof.
 */
function shownShell(scratch: Scratch): Uint8Array {
  const shown = new Uint8Array(scratch.positions.length / 3);
  for (const submesh of scratch.submeshes) {
    if (submesh.kind !== 'body') {
      continue;
    }
    for (let at = 0; at < submesh.indexCount; at += 1) {
      shown[scratch.indices[submesh.indexOffset + at]] = 1;
    }
  }

  return shown;
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
