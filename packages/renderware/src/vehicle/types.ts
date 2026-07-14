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
/** Per-vertex lamp tag (`meta.w`): the shader needs to know a lamp texel from a body texel. */
export const LampTag = {
  head: 1,
  none: 0,
  tail: 2,
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
  indexCount: number;
  layout: { colors: number; indices: number; meta: number; normals: number; positions: number; uvs: number };
  name: string;
  parts: VehicleModelPart[];
  submeshes: VehicleModelSubmesh[];
  textures: { height: number; names: string[]; offset: number; width: number };
  vertexCount: number;
  wheels: VehicleWheel[];
}

export interface VehicleModelData {
  colors: Uint8Array;
  doors: readonly VehicleDoor[];
  /** Every non-geometry frame, verbatim (headlights/taillights/exhaust/seats/…). */
  dummies: readonly VehicleDummy[];
  indices: Uint16Array;
  /** Per-vertex slots: x = texture layer, y = lamps-on twin layer (0 = none), z = {@link PaintSlot},
   *  w = {@link LampTag}. */
  meta: Uint8Array;
  normals: Float32Array;
  parts: readonly VehicleModelPart[];
  positions: Float32Array;
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
