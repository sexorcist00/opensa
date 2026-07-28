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
  VehiclePopUpLights,
  VehicleWheel,
} from './types';

import { frameWorldTransform, rotationToQuat } from '../mesh/frame-transform';
import { groupTrianglesByMaterial, NIGHT_AMBIENT } from '../mesh/prepare-clump';
import { cabinVertices } from './cabin';
import { skyOcclusion } from './sky-occlusion';
import { LampTag, MaterialClass, PaintSlot } from './types';
import { tyreMaterials } from './wheel-tyre';

/** SA per-lamp marker colours on the `vehiclelights*` atlas: they say WHICH lamp a material is — engine
 *  metadata, NEVER rendered (else garish green/yellow lamp patches). */
const LAMP_MARKERS = new Map<string, 'head' | 'tail'>([
  ['0,255,200', 'head'], // front right
  ['185,255,0', 'tail'], // rear left
  ['255,60,0', 'tail'], // rear right
  ['255,175,0', 'head'], // front left
]);

/**
 * The two license-plate faces, named by the placeholder texture their material carries (plan 082/02):
 * `carplate` is the small text strip, `carpback` the city-background quad it is inset into. They are
 * separate quads in every plated DFF, and the reversed `CCustomCarPlateMgr` keys on exactly these names —
 * after conversion the name is gone, so the tag has to be taken here.
 */
const PLATE_TEXTURES = new Map<string, 'back' | 'face'>([
  ['carpback', 'back'],
  ['carplate', 'face'],
]);

/** Kam's/ZModeler carcols paint markers → the per-vertex paint slot. */
const PAINT_MARKERS = new Map<string, number>([
  ['0,255,255', PaintSlot.tertiary],
  ['60,255,0', PaintSlot.primary],
  ['255,0,175', PaintSlot.secondary],
  ['255,255,0', PaintSlot.quaternary],
]);

const DOOR_RE = /^door_(lf|rf|lr|rr)_ok$/;
/** A damage twin: `<component>_ok` / `<component>_dam` — see {@link componentFrame}. */
const COMPONENT_RE = /^(.+)_(?:ok|dam)$/;
/** SA's generic moving components. One of them is a pop-up headlight pod — see {@link popUpLights}. */
const MISC_RE = /^misc_[a-h]$/;
/** A pop-up pod is parked FACING DOWN and swings up; these bound the pitch that counts as "parked". Below
 *  the floor is a lamp that already looks where it lights (a light bar), above the ceiling is not a lamp. */
const POPUP_MIN_ANGLE = Math.PI / 36; // 5°
const POPUP_MAX_ANGLE = (Math.PI * 5) / 9; // 100°
const EXTRA_RE = /^extra\d+$/;
const WHEEL_CONTAINER_RE = /^f_wheel/;
/** Per-corner wheel atomics — SA's "different front/rear wheels" convention; `m` = 3-axle trucks. */
const WHEEL_CORNER_RE = /^wheel_(lf|rf|lm|rm|lb|rb)$/;
const WHEEL_DUMMY_RE = /^wheel_(l|r)([fmb])_dummy$/;
const WHEEL_FRAME = 'wheel';

/** Body geometry has no tyre in it — only the wheel paths pass a real set. */
const NO_TYRES: ReadonlySet<number> = new Set();

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
    if (name.endsWith('_dam')) {
      continue; // `_dam` rides with its `_ok` twin
    }
    const before = scratch.submeshes.length;
    addBodyAtomic(scratch, clump, atomic.geometryIndex, name, atomic.frameIndex, textures, damGeometry, doors);
    // Every `extraN` alternative ships, tagged with its frame. SA shows at most one and the pick is per
    // SPAWN — a build-time choice would freeze one optional part into the pak for every car in the world.
    if (EXTRA_RE.test(name)) {
      for (let at = before; at < scratch.submeshes.length; at += 1) {
        scratch.submeshes[at].extra = name;
      }
    }
  }

  const wheels = addWheels(scratch, clump, textures, wheelScale, { containerWheels, cornerWheels, sharedWheel });
  // Self-occlusion rides in the NIGHT set's alpha, which the builder had been filling with a constant 255:
  // the shader already reads that stream per vertex, so a car carries its own AO with no new buffer, no
  // `.osm` version bump and no second upload. See `sky-occlusion.ts` for why it is computed here.
  const night = new Uint8Array(scratch.night);
  const placed = restPose(scratch);
  const occlusion = skyOcclusion(
    placed.positions,
    placed.normals,
    scratch.positions.length / 3,
    shownShell(scratch),
    scratch.indices,
  );
  for (let vertex = 0; vertex < occlusion.length; vertex += 1) {
    night[vertex * 4 + 3] = occlusion[vertex];
  }
  // The cabin is tagged AFTER the materials are classified and the occlusion is known, because it is a
  // property of where a vertex SITS rather than of the material it wears (plan 090/02). A vertex that
  // already carries a real lamp tag keeps it — a lamp inside the cabin is still a lamp.
  const meta = new Uint8Array(scratch.meta);
  const cabin = cabinVertices(
    placed.positions,
    occlusion,
    glassVertices(scratch),
    hubHeight(scratch, wheels),
    notCabin(scratch, wheels),
  );
  for (let vertex = 0; vertex < cabin.length; vertex += 1) {
    if (cabin[vertex] === 1 && (meta[vertex * 4 + 3] & 0xf) === LampTag.none) {
      meta[vertex * 4 + 3] |= LampTag.cabin;
    }
  }

  const popUp = popUpLights(scratch, options.popUpLights === true);

  return {
    colors: new Uint8Array(scratch.colors),
    doors,
    dummies: collectDummies(clump),
    // Index width follows the model: uint16 while it fits, uint32 past the ceiling. Stock SA never comes
    // near it, but hi-poly mod cars do (the field pair was 86 511 and 82 991 verts), and this used to THROW
    // — which took the whole vehicle system down with it, because the throw landed in the fixed step.
    indices: indicesFor(scratch.positions.length / 3, scratch.indices),
    meta,
    night,
    normals: new Float32Array(scratch.normals),
    parts: scratch.parts,
    ...(popUp ? { popUpLights: popUp } : {}),
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
  const placement = componentFrame(clump, frameIndex, name);
  const part = addPart(scratch, clump, placement, door ? `door_${door[1]}` : name);
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
      appendGeometry(
        scratch,
        clump.geometries[wheel.geometryIndex],
        part,
        textures,
        'body',
        null,
        tyreMaterials(clump.geometries[wheel.geometryIndex]),
      );

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
  tyres: ReadonlySet<number> = NO_TYRES,
): void {
  if (!rw) {
    return;
  }
  groupTrianglesByMaterial(rw.triangles, rw.materials.length).forEach((tris, materialIndex) => {
    if (tris.length === 0) {
      return;
    }
    const material = rw.materials[materialIndex];
    // NOT on the `_vlo` LOD mesh: it only shows past the vehicle LOD swap, where the plate quad is a
    // fraction of a pixel, and tagging it would buy a per-instance texture binding for something nobody
    // can read. The builder already de-features LOD the same way — `materialClass` forces it MATTE.
    // 5 of the 143 plated models author a plate face on their `_vlo` at all; they keep the stock look.
    const plate = kind === 'lod' ? null : plateFace(material);
    const tyre = tyres.has(materialIndex);
    const surface = materialSurface(material, textures, kind, tyre, plate);
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
      ...(plate ? { plate } : {}),
      ...(tyre ? { tyre: true } : {}),
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

/** A column-major mat4 applied to a point (the door offset — rotation and translation only). */
function applyMat4(m: ArrayLike<number>, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
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
 * Where a DAMAGEABLE component's mesh actually hangs: on the component's `*_dummy` frame, never on the
 * `_ok`/`_dam` frame the exporter wrapped it in.
 *
 * This is the original's own rule, not a convenience. `CVehicleModelInfo::PreprocessHierarchy` runs
 * `RwFrameForAllChildren(frame, CollapseFramesCB, frame)` over every damageable component, and
 * `CollapseFramesCB` reparents each child's atomics onto that frame (`MoveObjectsCB` → `RpAtomicSetFrame`)
 * and then **destroys the child frame** — its position and rotation with it. A door therefore pivots on
 * `door_lf_dummy` and carries no offset inside it.
 *
 * Stock SA never showed the difference: measured over the whole stock archive, 160 models carry door
 * components (756 `_ok`/`_dam` frames) and only 62 of those frames hold a non-identity transform, the
 * largest being **6 mm / 2.6°** — exporter rounding. A MOD can put anything there, and the 1995 Diablo puts
 * **1.518 m** on both doors: honouring it hung the closed door below the nose and threw it clear of the car
 * on opening (field 2026-07-28). Its scissor hinge lives where SA reads it — in the ROTATED frame ABOVE the
 * dummy, which our swing (a rotation about the pivot's local Z) already follows.
 *
 * Falls back to the atomic's own frame when no matching `*_dummy` ancestor exists — an unknown layout must
 * not silently relocate a mesh.
 */
function componentFrame(clump: RWClump, frameIndex: number, name: string): number {
  const base = COMPONENT_RE.exec(name)?.[1];
  if (!base) {
    return frameIndex;
  }
  const dummy = `${base}_dummy`;
  let at = clump.frames[frameIndex]?.parentIndex ?? -1;
  for (let hops = 0; at >= 0 && at < clump.frames.length && hops <= clump.frames.length; hops += 1) {
    if (frameName(clump, at) === dummy) {
      return at;
    }
    if (clump.frames[at].parentIndex === at) {
      break;
    }
    at = clump.frames[at].parentIndex;
  }

  return frameIndex;
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

function frameName(clump: RWClump, frameIndex: number): string {
  return clump.frames[frameIndex]?.name.trim().toLowerCase() ?? '';
}

/** Which vertices wear a GLASS material — the greenhouse the cabin is found inside (plan 090/02). */
function glassVertices(scratch: Scratch): Uint8Array {
  const glass = new Uint8Array(scratch.positions.length / 3);
  for (let vertex = 0; vertex < glass.length; vertex += 1) {
    glass[vertex] = scratch.meta[vertex * 4 + 3] >> 4 === MaterialClass.glass ? 1 : 0;
  }

  return glass;
}

function hasWheelDummies(clump: RWClump): boolean {
  return clump.frames.some((frame) => WHEEL_DUMMY_RE.test(frame.name.trim().toLowerCase()));
}

/**
 * SA shows at most ONE `extraN` component — they are mutually-exclusive alternatives modelled at the same
 * spot (the Benson's swappable ad boards). Rendering them all overlaps into a jumble.
 */

/** The wheel hubs' model-space height — the cabin's floor, below which a car is underbody and wheel well.
 *  Zero (the model origin) for something with no wheels at all, which then has no floor to speak of. */
function hubHeight(scratch: Scratch, wheels: readonly VehicleWheel[]): number {
  const heights = wheels.map((wheel) => scratch.parts[wheel.part]?.localTranslation[2] ?? 0);

  return heights.length === 0 ? 0 : heights.reduce((sum, height) => sum + height, 0) / heights.length;
}

/** Narrowest index array the vertex count allows: uint16 holds indices 0..65535, so up to 65536 vertices
 *  (max index 65535) still fit; only > 65536 needs uint32 (same boundary as prepare-clump.ts). */
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
  const tyres = tyreMaterials(clump.geometries[geometryIndex]);
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
    appendGeometry(scratch, clump.geometries[geometryIndex], part, textures, 'body', null, tyres);
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
    plate: 'back' | 'face' | null;
    reflective: boolean;
    translucent: boolean;
  },
): number {
  // A plate face wins over every other signal: the class is what redirects its texture sample, and it
  // shades matte anyway (the reflection switch tests `paint`/`chrome` by value).
  if (flags.plate) {
    return flags.plate === 'face' ? MaterialClass.plateFace : MaterialClass.plateBack;
  }
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
  tyre = false,
  plate: 'back' | 'face' | null = null,
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
  // RUBBER DOES NOT REFLECT. SA marks its own tyres with a zeroed env map; mods do not, so the geometry
  // says it instead (`wheel-tyre.ts`) and the tyre loses reflection AND specular here. The rim beside it is
  // untouched — that one is supposed to shine.
  const reflect = tyre ? ([0, 0, 0, 0] as [number, number, number, number]) : reflectionOf(material);
  const translucent = color[3] < 250 || textures.hasAlpha(material);

  return {
    color,
    klass: materialClass(material, { kind, lamp, paint, plate, reflective: reflect[1] > 0, translucent }),
    lamp,
    layer,
    nightLayer,
    paint,
    reflect,
    translucent,
  };
}

/** Mean vertex normal over a part's SHOWN faces, or only its head-lamp ones. Null when it has none. */
function meanNormal(scratch: Scratch, part: number, headOnly: boolean): [number, number, number] | null {
  const sum: [number, number, number] = [0, 0, 0];
  let count = 0;
  for (const submesh of scratch.submeshes) {
    if (submesh.part !== part || submesh.kind !== 'body') {
      continue;
    }
    for (let at = 0; at < submesh.indexCount; at += 1) {
      const vertex = scratch.indices[submesh.indexOffset + at];
      if (headOnly && (scratch.meta[vertex * 4 + 3] & 0xf) !== LampTag.head) {
        continue;
      }
      sum[0] += scratch.normals[vertex * 3];
      sum[1] += scratch.normals[vertex * 3 + 1];
      sum[2] += scratch.normals[vertex * 3 + 2];
      count += 1;
    }
  }
  const length = Math.hypot(sum[0], sum[1], sum[2]);

  return count === 0 || length === 0 ? null : [sum[0] / length, sum[1] / length, sum[2] / length];
}

/** One channel of a material colour, modulated by a prelit set when the geometry carries one. */
function modulate(channel: number, prelit: null | Uint8Array, vertex: number, offset: number): number {
  return prelit ? Math.round((channel * prelit[vertex * 4 + offset]) / 255) : channel;
}

/** Vertices no cabin test may claim: the WHEELS (their top half stands above the hub line, inside the
 *  greenhouse footprint and enclosed by its own arch) and the `_vlo` LOD, which is a closed blob. */
function notCabin(scratch: Scratch, wheels: readonly VehicleWheel[]): Uint8Array {
  const blocked = new Uint8Array(scratch.positions.length / 3);
  const wheelParts = new Set(wheels.map((wheel) => wheel.part));
  for (const submesh of scratch.submeshes) {
    if (submesh.kind !== 'lod' && !wheelParts.has(submesh.part)) {
      continue;
    }
    for (let at = 0; at < submesh.indexCount; at += 1) {
      blocked[scratch.indices[submesh.indexOffset + at]] = 1;
    }
  }

  return blocked;
}

function paintSlot(material: RWMaterial): number {
  return PAINT_MARKERS.get(`${material.color[0]},${material.color[1]},${material.color[2]}`) ?? PaintSlot.none;
}

/** Which plate face a material paints, or null for ordinary body geometry. See {@link PLATE_TEXTURES}. */
function plateFace(material: RWMaterial): 'back' | 'face' | null {
  return PLATE_TEXTURES.get(material.texture?.name.toLowerCase() ?? '') ?? null;
}

/**
 * The retractable-headlight component, READ OFF THE MODEL — no per-car list anywhere.
 *
 * A pop-up pod is a `misc_*` component (SA's generic moving-component slot) that holds HEAD-LAMP faces, and
 * it is authored PARKED: those faces look forward and DOWN into the nose. That pitch is the whole feature —
 * the angle the pod must swing UP for its lamps to face where they light. So the open angle is
 * `atan2(-n.z, n.y)` of the mean lamp normal, per model, derived. Measured: the stock ZR-350 comes out at
 * 40°, the 1986 Starion mod at 53°, and every other stock `misc_*` (dozer blade, forklift mast, tow crane,
 * lowrider hydraulics — 41 models carry one) holds no lamp face at all.
 *
 * The angle band is the guard against a false positive: a lamp that already looks where it lights is a light
 * BAR, not a pod, and anything past {@link POPUP_MAX_ANGLE} is not a headlight assembly.
 *
 * `forced` is the build-time `features.txt` → `UP/DOWN_LIGHTS` declaration, for a mod whose pod carries no
 * marker (its own texture instead of `vehiclelights`): the pod is then measured by its whole face set rather
 * than by its lamps. Nothing about this reaches the runtime modloader path — it is resolved at build time.
 */
function popUpLights(scratch: Scratch, forced: boolean): null | VehiclePopUpLights {
  for (const [part, definition] of scratch.parts.entries()) {
    if (!MISC_RE.test(definition.name)) {
      continue;
    }
    const normal = meanNormal(scratch, part, true) ?? (forced ? meanNormal(scratch, part, false) : null);
    if (!normal) {
      continue;
    }
    const angle = Math.atan2(-normal[2], normal[1]);
    if (angle > POPUP_MIN_ANGLE && angle < POPUP_MAX_ANGLE) {
      return { angle, part };
    }
  }

  return null;
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
 * Every vertex where it actually SITS on the parked car — the model-space rest pose.
 *
 * The buffers do not hold that: a wheel's vertices are wheel-local (a 0.35 m blob about the origin) and a
 * door's are hinge-local, because the part matrix places them at draw time. Anything that reasons about the
 * car's SHAPE — the sky occlusion below — has to place them first, or it sees four wheels stacked inside the
 * cabin. Mirrors `RigidEntity.flatten`: T(t) x R(q) x S x offset.
 */
function restPose(scratch: Scratch): { normals: number[]; positions: number[] } {
  const positions = [...scratch.positions];
  const normals = [...scratch.normals];
  const partOf = new Int32Array(positions.length / 3).fill(-1);
  for (const submesh of scratch.submeshes) {
    for (let at = 0; at < submesh.indexCount; at += 1) {
      partOf[scratch.indices[submesh.indexOffset + at]] = submesh.part;
    }
  }
  for (let vertex = 0; vertex < partOf.length; vertex += 1) {
    const part = scratch.parts[partOf[vertex]];
    if (!part) {
      continue;
    }
    const at = vertex * 3;
    const scale = part.scale ?? 1;
    const inside = part.offset
      ? applyMat4(part.offset, positions[at], positions[at + 1], positions[at + 2])
      : ([positions[at], positions[at + 1], positions[at + 2]] as [number, number, number]);
    const turned = rotateByQuat(part.localRotation, inside[0] * scale, inside[1] * scale, inside[2] * scale);
    positions[at] = turned[0] + part.localTranslation[0];
    positions[at + 1] = turned[1] + part.localTranslation[1];
    positions[at + 2] = turned[2] + part.localTranslation[2];
    const spun = rotateByQuat(part.localRotation, normals[at], normals[at + 1], normals[at + 2]);
    normals[at] = spun[0];
    normals[at + 1] = spun[1];
    normals[at + 2] = spun[2];
  }

  return { normals, positions };
}

/** v turned by the quaternion q — the shortest form, t = 2 (q_xyz x v). */
function rotateByQuat(q: readonly number[], x: number, y: number, z: number): [number, number, number] {
  const tx = 2 * (q[1] * z - q[2] * y);
  const ty = 2 * (q[2] * x - q[0] * z);
  const tz = 2 * (q[0] * y - q[1] * x);

  return [
    x + q[3] * tx + (q[1] * tz - q[2] * ty),
    y + q[3] * ty + (q[2] * tx - q[0] * tz),
    z + q[3] * tz + (q[0] * ty - q[1] * tx),
  ];
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
