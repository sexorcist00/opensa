/**
 * Renderer-agnostic vehicle model (plan 074/08 B5 step 2). The three path builds an `Object3D` tree
 * (`three/build-vehicle.ts`); the own engine needs the SAME lore as flat buffers + part transforms. This is
 * the shared product both renderers' hosts consume.
 */

/**
 * Per-vertex paint slot, carried in `meta.z`. The engine resolves it to the INSTANCE's colour at draw time,
 * so one uploaded model serves a street of differently-painted cars. (The B2 probe baked carcols straight
 * into vertex colours — with geometry now shared across instances that would force one geometry copy per
 * colour combination, and every parked car on a block would come out the same colour.)
 */
/** Per-vertex lamp tag (`meta.w` LOW nibble): the shader needs to know a lamp texel from a body texel. */
export const LampTag = {
  head: 1,
  none: 0,
  tail: 2,
} as const;

/**
 * Per-vertex material CLASS (`meta.w` HIGH nibble — 074/16 field round 2): paint, chrome and glass are not
 * the same surface and must reflect differently. Classified from the DFF material at build time:
 * carcols paint slots / the `xvehicleenv*` env map → paint (clearcoat + flakes); a chrome texture or the
 * `vehicleenvmap*` env map → chrome (near-mirror, the material's OWN sphere map supplies the authentic SA
 * tint); translucent → glass (sharp, no flakes); `_vlo` LOD meshes, lamps and coefficient-0 materials
 * (tyres, rubber, trim) → matte — excluded from reflections entirely.
 */
export const MaterialClass = {
  chrome: 2,
  glass: 3,
  matte: 0,
  paint: 1,
} as const;

export const PaintSlot = {
  none: 0,
  primary: 1,
  quaternary: 4,
  secondary: 2,
  tertiary: 3,
} as const;

export interface VehicleBuildOptions {
  /** Deterministic chooser among mutually-exclusive `extraN` frames (default `Math.random`). */
  rng?: () => number;
  /** `vehicles.ide` wheelScale as [front, rear] — SA scales the axles separately. Absent = [1, 1]. */
  wheelScale?: readonly [number, number];
}

export interface VehicleDoor {
  /** `door_lf` … — the hinge part's name. */
  name: string;
  part: number;
  side: string;
}

export interface VehicleDummy {
  name: string;
  position: [number, number, number];
  rotation: [number, number, number, number];
}

/**
 * The SERIALIZED model — a JSON header over one binary blob (`vehicle.json` + `vehicle.bin`). The lab reads
 * this instead of carrying a DFF parser and a game VFS; the game builds the model in-process and never
 * touches it. Same fields as {@link VehicleModelData}, with the typed arrays replaced by blob offsets.
 */
export interface VehicleFixture {
  doors: VehicleDoor[];
  dummies: VehicleDummy[];
  /** False when the index payload is uint32 — a model past 65 536 vertices. Absent on fixtures written
   *  before the width existed, when uint16 was the only shape the builder emitted. */
  index16?: boolean;
  indexCount: number;
  layout: {
    colors: number;
    indices: number;
    meta: number;
    /** Absent on fixtures built before the night set existed — the reader falls back to the day colours. */
    night?: number;
    normals: number;
    positions: number;
    reflect: number;
    uvs: number;
  };
  name: string;
  parts: VehicleModelPart[];
  submeshes: VehicleModelSubmesh[];
  textures: { height: number; names: string[]; offset: number; width: number };
  /** `'world'` = the submeshes' `array` fields are refs into the SHARED world plan and the file carries no
   *  `TEXS`; absent = a private dictionary rides along, which is what every by-name class ships. */
  textureSource?: 'world';
  vertexCount: number;
  wheels: VehicleWheel[];
}

export interface VehicleModelData {
  colors: Uint8Array;
  doors: readonly VehicleDoor[];
  /** Every non-geometry frame, verbatim (headlights/taillights/exhaust/seats/…). */
  dummies: readonly VehicleDummy[];
  /**
   * Triangle indices, uint16 while the model fits and uint32 past 65 536 vertices (hi-poly mod cars do —
   * the field pair was 86 511 and 82 991). Consumers must bind by `BYTES_PER_ELEMENT`, never assume u16.
   */
  indices: Uint16Array | Uint32Array;
  /** Per-vertex slots: x = texture layer, y = lamps-on twin layer (0 = none), z = {@link PaintSlot},
   *  w = {@link LampTag} (low nibble) | {@link MaterialClass} << 4 (high nibble). */
  meta: Uint8Array;
  /**
   * The NIGHT vertex colours — the same RGBA layout as `colors`, replacing them as the day/night factor
   * goes to 1. Authored where the geometry carries SA's extra-vertex-colour set, and otherwise synthesized
   * as day × {@link NIGHT_AMBIENT}, which is exactly what the welded cell path does.
   */
  night: Uint8Array;
  normals: Float32Array;
  parts: readonly VehicleModelPart[];
  positions: Float32Array;
  /**
   * Per-vertex REFLECTION slots (B5r), straight from the DFF's material-effect plugins:
   *   x = env-map layer in the texture array (0 = the material is not reflective),
   *   y = env-map coefficient × 255 (RpMatFX strength),
   *   z = SA reflection-plugin intensity × 255,
   *   w = SA specular-plugin level × 255.
   * SA's own env textures are BAKED DAYTIME images (a painted horizon for paint, a sunset photo for glass) —
   * the engine keeps their PATTERN and their settings but takes the reflection's COLOUR from the live sky, so
   * a car does not reflect a sunset at midnight.
   */
  reflect: Uint8Array;
  submeshes: readonly VehicleModelSubmesh[];
  texture: VehicleTextureArray;
  uvs: Float32Array;
  wheels: readonly VehicleWheel[];
}

export interface VehicleModelPart {
  localRotation: [number, number, number, number];
  localTranslation: [number, number, number];
  name: string;
  /** Column-major mat4 — the mesh relative to the pivot. Doors only (the pivot is their hinge frame). */
  offset?: number[];
  scale?: number;
}

export interface VehicleModelSubmesh {
  /** Which texture ARRAY this submesh samples (opensa-pack 003 phase 5g). Absent means 0 — the single-array
   *  case every runtime build is; only the offline converter, planning from raw TXDs, ever sets it. */
  array?: number;
  /** Model-space centroid of the submesh's triangles (074/16 round 6) — the engine sorts TRANSLUCENT
   *  submeshes back-to-front by this each frame, or the steering wheel draws over the windscreen. */
  center: [number, number, number];
  /** Pairing key for the `_ok`/`_dam` twins (`door_lf`, `bonnet`, …); null when the part cannot deform. */
  damageGroup: null | string;
  indexCount: number;
  indexOffset: number;
  /**
   * Visibility group. `body` = the intact mesh (shown); `dam` = its damaged twin (hidden until an impact);
   * `lod` = the `_vlo` low-detail mesh (hidden until the LOD band swaps). All three are one primitive on the
   * engine side — per-submesh visibility — because prod expresses all three as three's `.visible`.
   */
  kind: 'body' | 'dam' | 'lod';
  /** Head/tail lamp tag from the SA marker colours — lamp materials render WHITE and carry this instead. */
  lamp: 'head' | 'tail' | null;
  part: number;
  /** Bounding radius about `center` (074/16 sort fix) — the translucent sort subtracts it so a raked
   *  windscreen counts by its NEAREST extent, not its centre (the wheel drew over the glass overhang).
   *  Optional: old fixtures sort by the centre alone. */
  radius?: number;
  translucent: boolean;
}

export interface VehicleTextureArray {
  height: number;
  layers: number;
  names: string[];
  /** RGBA8 layers, all one size, packed sequentially. */
  rgba: Uint8Array;
  width: number;
}

export interface VehicleWheel {
  front: boolean;
  part: number;
  radius: number;
}
