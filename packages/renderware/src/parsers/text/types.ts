/**
 * Data model for GTA San Andreas text map files (DAT / IDE / IPL).
 * These structures are renderer-agnostic — no three.js types.
 */

/** Parsed `gta.dat`: the asset folders and data files it references. */
export interface GtaDat {
  /** IDE directives (object-definition file paths). */
  ide: string[];
  /** IMG directives (asset archive/folder paths, e.g. `IMG\basicmap`). */
  img: string[];
  /** IPL directives (scene-placement file paths). */
  ipl: string[];
}

/** One object definition from an IDE `objs`/`anim`/`tobj` section. */
export interface IdeObjectDef {
  /** For `anim` (animated) objects: the IFP file (lowercased, no extension) holding the model's
   *  looping clip — e.g. `counxref` for the oil-pump `nt_noddonkbase` (plan 041). */
  anim?: string;
  drawDistance: number;
  flags: number;
  id: number;
  modelName: string;
  /** For `tobj` (time-of-day) objects: the hour window `[on, off)` it's visible in (wraps midnight). */
  time?: { off: number; on: number };
  txdName: string;
}

/** An axis-aligned box zone: `name id flags x1 y1 z1 x2 y2 z2`. */
export interface IplAudioBox extends IplAudioZoneBase {
  readonly max: readonly [number, number, number];
  readonly min: readonly [number, number, number];
  readonly shape: 'box';
}

/** A sphere zone: `name id flags x y z radius`. */
export interface IplAudioSphere extends IplAudioZoneBase {
  readonly centre: readonly [number, number, number];
  readonly radius: number;
  readonly shape: 'sphere';
}

/**
 * One audio zone from an IPL `auzo` section (203/1-03) — the shape SA picks its AMBIENCE by.
 *
 * `CAEAmbienceTrackManager` asks `CAudioZones` which zone the listener stands in and plays that zone's bed,
 * so this is the authored data behind "what this part of the city sounds like". It is placement data like
 * everything else in an IPL, and it was the one section this parser skipped on purpose until audio needed it.
 *
 * **The original's array ceilings are 158 boxes and 3 spheres, and they are not ours** — a 2004 static array
 * is a fact about that machine ([directive 2](../../../../../docs/project-goals.md)). Nothing here counts.
 */
export type IplAudioZone = IplAudioBox | IplAudioSphere;

/** The fields both zone shapes carry. */
export interface IplAudioZoneBase {
  /** Whether the zone starts ACTIVE (`flags` is 1). SA toggles it at runtime with `SwitchAudioZone`, so this
   *  is a starting state rather than a property of the place. */
  readonly active: boolean;
  /** The zone id the ambience table is keyed by (`int16` in the game). */
  readonly id: number;
  /** The zone's name. The game stores `char[8]`, so anything past 7 characters is truncated THERE and
   *  carried whole here — the truncation is the game's behaviour, not the file's meaning. */
  readonly name: string;
}

/**
 * A car generator from a binary IPL `CARS` section — SA's map-baked parked/spawned cars (the same
 * concept as the CLEO `0x014B` generators). Model and colour fields use `-1` for "pick at runtime".
 */
export interface IplCarGenerator {
  /** Alarm probability as stored (0–100). */
  alarm: number;
  /** Raw IPL heading field (Z-up). Stored in radians in stock streams; convert at the spawn site. */
  angle: number;
  /** Door-lock probability as stored (0–100). */
  doorLock: number;
  /** Force-spawn flag. */
  forceSpawn: number;
  /** Vehicle model id, or -1 for a random area-appropriate car (resolve via cargrp/popcycle). */
  id: number;
  /** World position in GTA Z-up space. */
  position: [number, number, number];
  /** Primary colour id, or -1 for random. */
  primaryColor: number;
  /** Secondary colour id, or -1 for random. */
  secondaryColor: number;
}

/** One placed instance from an IPL `inst` section. */
export interface IplInstance {
  id: number;
  interior: number;
  /**
   * Whether this instance is a **LOD stand-in** — i.e. some other instance's `lod` field points at it (resolved
   * per-area in `resolveMap`, since `lod` indexes the file's own list / the companion text IPL). This is the
   * authoritative LOD test; the `lod`-name prefix is only a heuristic (see the `lod-detection-name-vs-target`
   * memory). Absent until `resolveMap` sets it.
   */
  isLod?: boolean;
  /** Index of the LOD instance, or -1 for none. */
  lod: number;
  modelName: string;
  /** World position in GTA Z-up space. */
  position: [number, number, number];
  /** Orientation quaternion (x, y, z, w). */
  rotation: [number, number, number, number];
}

/** Resolved map: object catalog keyed by id + the instances to place. */
export interface MapDefinitions {
  /**
   * Car generators from the binary IPL `CARS` sections (SA's map-baked parked/spawned cars). Absent/empty
   * when no stream carried a CARS section. `id = -1` entries are random area cars (resolved at the spawn site).
   */
  carGenerators?: IplCarGenerator[];
  catalog: Map<number, IdeObjectDef>;
  /** IMG asset folder paths from the DAT, normalized. */
  imgDirs: string[];
  instances: IplInstance[];
  /**
   * Time-of-day (`tobj`) object definitions, kept separate from the render
   * catalog. Their instances render but carry a `time` window; a system toggles
   * their visibility by the game hour (see {@link IdeObjectDef.time}).
   */
  timedCatalog?: Map<number, IdeObjectDef>;
  /**
   * TXD parent links from `txdp` sections (lowercased `child → parent`). A child
   * TXD inherits textures it lacks from its parent (chain) — see the texture
   * resolver. Absent/empty when no `txdp` data was present.
   */
  txdParents?: Map<string, string>;
}
