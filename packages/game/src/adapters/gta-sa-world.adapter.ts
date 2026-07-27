import type { parsePedDefs } from '@opensa/renderware';

// game/adapters/** (and game/mods/**) are the only places allowed to import renderware.
import { Matrix4 } from '@opensa/math';
import { isModdedAsset } from '@opensa/modloader';
import {
  type AssetFileSystem,
  breakableKeyHash,
  breakableModelsOf,
  buildCellColliders,
  buildCollisionIndex,
  buildTimecyc,
  buildVehicleModel,
  buildWorldGrid,
  type CarGroup,
  convertTo24h,
  groupRulesBySurface,
  type HandlingEntry,
  type IdeObjectDef,
  type MapDefinitions,
  type ObjectDatEntry,
  parseCarcols,
  parseCarGroups,
  parseDff,
  parseDffCollision,
  parseHandling,
  parseObjectDat,
  parsePopcycle,
  parseProcObj,
  parseSurfaceAdhesion,
  parseSurfaceInfo,
  parseSurfaceNames,
  parseTimecyc,
  parseVehicleDefs,
  placementMatrix,
  type PopcycleZone,
  type ProcObjBatch,
  type ProcObjCategoryName,
  procObjColliders,
  procObjLotteryCap,
  type ProcObjRule,
  type RegionColliders,
  resolveMap,
  scatterProcObjects,
  type SurfaceInfo,
  type Timecyc,
  type VehicleColours,
  type VehicleDef,
  type VehicleDummy,
  VehicleTextures,
  type WorldGrid,
} from '@opensa/renderware';
import { getTxdChain, setTxdParents } from '@opensa/renderware/archive/asset-cache';
import { breakableInstanceKey } from '@opensa/renderware/breakable/key';
import { getBreakable } from '@opensa/renderware/breakable/mesh';

import type { ModelColliders } from '../interfaces/collider.interface';
import type {
  AxleSetup,
  AxleType,
  SurfaceRecord,
  VehicleHandling,
  WorldAdapter,
} from '../interfaces/world-adapter.interface';
import type { WorldMod } from '../mods/mod.interface';
import type { CellCoord } from '../streaming/grid';
import type { VehiclePlacement } from '../vehicle/vehicle-lod.system';
import type { City } from '../zones/city';
import type { VehicleRigData } from './engine-vehicle-handle';

import { carGeneratorPlacements } from './car-generators';
import { randomCarPlacements } from './popcycle-cars';
import { createVehicleModelBuilder, type VehicleModelBuilder } from './vehicle-model-builder';
import { type RigidModelInit, toRigidModelInit } from './vehicle-model-init';
import { readVehicleOsm, SEAT_DUMMY_NAME } from './vehicle-osm';

/** Sea level (Z) + a large background plane half-size so the ocean reaches the horizon. */

/** B1 (plan 059) — a representative `popcycle.dat` zone-type per map.zon city, for resolving random map cars.
 *  Countryside/desert map 1:1; the three cities use a generic residential mix (coarse but data-driven). */
const CITY_POPCYCLE_ZONE: Record<City, string> = {
  COUNTRYSIDE: 'COUNTRYSIDE',
  DESERT: 'DESERT',
  LA: 'RESIDENTIAL_AVERAGE',
  SF: 'RESIDENTIAL_AVERAGE',
  VEGAS: 'RESIDENTIAL_AVERAGE',
};

/** One placed animated map object (074/08 B7·b) — native GTA coords and the IPL quaternion, verbatim. */
export interface AnimatedPlacement {
  /** The IFP file holding the model's clip (the clip inside is named after the MODEL). */
  anim: string;
  modelName: string;
  position: [number, number, number];
  rotation: [number, number, number, number];
  txdName: string;
}

/** One clutter model's instances in a cell (074/19), for the own-engine host to render instanced. */
export interface CellClutterRender {
  /** Per-instance breakable key hash (074/20), aligned with `matrices` — present only for breakable clutter
   *  models (cactus/rubble/rock), so a hit can resolve to the instance to degenerate. */
  keyHashes?: Uint32Array;
  /** 16 floats per instance, GTA-space column-major (model→GTA world); the host applies the axis change. */
  matrices: Float32Array;
  modelName: string;
  txdName: string;
}

/**
 * The own engine's vehicle load product (074/08 B5 step 4): renderer-agnostic geometry + the same collision,
 * handling and paint the three path gets. The host uploads `model` ONCE per car type and spawns instances.
 */
export interface EngineVehicleData {
  colliders: ModelColliders | null;
  halfExtents: [number, number, number];
  handling: VehicleHandling;
  /** Engine-ready upload shape — BOTH paths converge here, so the host cannot tell them apart. */
  model: RigidModelInit;
  /** Carcols colours as 0..1 (the engine's `setPaint` space). */
  paint: { primary: Rgb; quaternary: Rgb; secondary: Rgb; tertiary: Rgb };
  /** The articulation the handle animates (doors, wheels, damage submeshes). */
  rig: VehicleRigData;
  /** `ped_frontseat` dummy in vehicle space, or null. */
  seat: [number, number, number] | null;
  wheels: { connection: [number, number, number]; front: boolean; index: number; radius: number }[];
}

export interface GtaSaWorldConfig {
  cellSize: number;
  /**
   * Give the procedural clutter (grass, rocks, cacti) COLLIDERS at all.
   *
   * A renderer that does not DRAW the clutter must not collide it either — that is this file's own rule
   * ("no invisible obstacles"). And the price is not theoretical: with none of the knobs below set, the
   * countryside handed Rapier **9 803 static bodies**, which measured **17 ms per step** and drove the
   * fixed-step loop into a catch-up spiral (12 fps, standing still, on an empty screen). Default: on.
   */
  clutterColliders?: boolean;
  /** Standalone script-gated binary IPL groups to load (plan 042) — the world-state choice
   *  vanilla makes via mission-script LOAD_IPL/REMOVE_IPL (e.g. `truthsfarm`, `barriers1`). */
  extraIpl?: readonly string[];
  /** The asset source (plan 050) — all models/textures/data are read from here, not fetched. */
  fs: AssetFileSystem;
  /** **Currently INERT.** The build hook mods rode (`decoratePart`) died with the three cell builder in
   *  074/13; the engine welds cells offline, so nothing reads this yet. Kept as the declared extension
   *  point — passing mods here has no effect until one is re-wired. */
  mods?: readonly WorldMod[];
  /** Asset-resolution warnings (opensa-pack 003): a mod that cannot be honoured, a name nothing answers.
   *  Already de-duplicated per message here, because these fire on a SPAWN path. Omit to stay silent —
   *  this package routes diagnostics out rather than printing (nothing in it touches `console`). */
  onAssetWarning?: (message: string) => void;
  /** Effective clutter density per category (0 when disabled) — keeps clutter COLLISION in sync
   *  with the rendered set. On a knob change, call {@link GtaSaWorldAdapter.invalidateColliderCache}
   *  and re-stream physics. Default: vanilla density 1 for every category. */
  procObjDensityOf?: (category: ProcObjCategoryName) => number;
  /** Hard cap on clutter instances per cell — over the limit, the highest-lottery placements
   *  are simply not RENDERED and therefore not collided either (one budget drives both; lowest
   *  lotteries win). The vanilla CProcObjectMan pools at ~300 for the same perf reason.
   *  Default: unlimited. */
  procObjLimit?: number;
  /** Off-thread vehicle model builds for {@link GtaSaWorldAdapter.loadVehicleData} (074/21 field fix):
   *  parse + TXD decode + weld is ~100–200 ms per car TYPE and froze the frame whenever a new type first
   *  streamed in. Defaults to the real build worker where Workers exist; null = synchronous (node tests). */
  vehicleModelBuilder?: null | VehicleModelBuilder;
}

type Rgb = [number, number, number];

/** Resolved carcol paint (RGB per slot); 3rd/4th present only for 4-colour cars. */
interface VehiclePaint {
  primary: [number, number, number];
  quaternary?: [number, number, number];
  secondary: [number, number, number];
  tertiary?: [number, number, number];
}

/**
 * Bridges the generic engine to GTA SA / renderware. Downloads the WIMG archive
 * and resolves the map, then builds instanced regions and reports picked objects.
 * The −90°X (GTA Z-up → three Y-up) lives here, not in the engine.
 */
/** Per-slice main-thread budget for the cooperative cell build (plan 060 Phase 3). */

export class GtaSaWorldAdapter implements WorldAdapter {
  readonly cellSize: number;

  /** Lowercased model names that "smash" per object.dat but carry no RW Breakable atomic (plan 045) —
   *  their shatter mesh is synthesized from the render geometry. Built in {@link prepare}. */
  private readonly breakableModels = new Set<string>();
  /** `cargrp.dat` groups for random map-car resolution (plan 059); null when absent. */
  private carGroups: CarGroup[] | null = null;
  private readonly colliderCache = new Map<string, ModelColliders[]>();
  private readonly config: GtaSaWorldConfig;
  /** Catalog defs by lowercased model name — resolves procobj clutter models to their TXDs. */
  private defByName: Map<string, IdeObjectDef> | null = null;
  private defs: MapDefinitions | null = null;
  private readonly fs: AssetFileSystem;
  private grid: null | WorldGrid = null;
  /** Parsed `handling.cfg`, kept for the later vehicle-physics phase. */
  private handling: Map<string, HandlingEntry> | null = null;
  /** Parsed `object.dat` collision-damage tuning by lowercased model (plan 045); null when absent. */
  private objectDat: Map<string, ObjectDatEntry> | null = null;
  /** Parsed `peds.ide` defs by lowercased model name (TEMP: resolves the env-picked main character). */
  private peds: null | ReturnType<typeof parsePedDefs> = null;
  /** `popcycle.dat` zone-types for random map-car resolution (plan 059); null when absent. */
  private popcycle: Map<string, PopcycleZone> | null = null;
  /** Whether {@link ensurePopulationData} has run (popcycle/cargrp may legitimately be absent → null). */
  private populationLoaded = false;
  /** Memoized scatter per cell (074/19): the render (engine clutter) AND collider paths share it, so ONE
   *  scatter drives both — the render/collision divergence that cost 17 ms/step cannot recur. */
  private readonly procObjBatchCache = new Map<string, null | readonly ProcObjBatch[]>();
  /** procobj.dat rules by surface name; null when the data files are absent (no scatter). */
  private procObjRules: Map<string, ProcObjRule[]> | null = null;
  /** Surface-name table from surfinfo.dat (index = COL material id); pairs with procObjRules. */
  private surfaceNames: null | string[] = null;
  private surfaceTable: null | SurfaceInfo[] = null;
  private tyreAdhesionTable: null | { perMaterial: Float32Array; road: number } = null;
  private vehicleColours: null | VehicleColours = null;
  private vehicleDefs: Map<string, VehicleDef> | null = null;
  private readonly vehicleModelBuilder: null | VehicleModelBuilder;
  /** Asset warnings already emitted — see {@link GtaSaWorldAdapter.warnAsset}. */
  private readonly warnedAssets = new Set<string>();

  constructor(config: GtaSaWorldConfig) {
    this.config = config;
    this.fs = config.fs;
    this.cellSize = config.cellSize;
    this.vehicleModelBuilder =
      config.vehicleModelBuilder === undefined ? createVehicleModelBuilder() : config.vehicleModelBuilder;
  }

  /**
   * Every ANIMATED map object placed on the map (074/08 B7·b): garage doors, windmills, the spinning signs.
   * There are only ~64 of them map-wide, so the host holds the whole list and spawns the ones in range —
   * no per-cell streaming machinery for a set this small.
   */
  animatedPlacements(): AnimatedPlacement[] {
    if (!this.defs) {
      return [];
    }
    const placed: AnimatedPlacement[] = [];
    for (const instance of this.defs.instances) {
      const def = this.defs.catalog.get(instance.id);
      if (def?.anim === undefined) {
        continue;
      }
      placed.push({
        anim: def.anim,
        modelName: def.modelName,
        position: [...instance.position],
        rotation: [...instance.rotation],
        txdName: def.txdName,
      });
    }

    return placed;
  }

  /** `object.dat` collision-damage tuning for a model (plan 045), or undefined when absent. The
   *  break system gates on RW Breakable mesh data; this only tunes the impact threshold + marks
   *  indestructible (huge-mass) props. */
  breakableInfo(modelName: string): ObjectDatEntry | undefined {
    return this.objectDat?.get(modelName.toLowerCase());
  }

  /**
   * Renderer-agnostic procedural clutter for a cell (074/19 B7·d), for the own-engine host to render INSTANCED.
   * Uses the SAME memoized scatter and the SAME per-category density × `procObjLimit` cap as the colliders, so
   * what the engine draws is exactly what physics collides — one budget, no divergence. GTA-space matrices (the
   * host applies the axis change); empty before the map is ready or where nothing scatters.
   */
  cellClutter(cx: number, cy: number): CellClutterRender[] {
    const batches = this.cellProcObjBatches(cx, cy);
    if (!batches || batches.length === 0 || !this.defByName) {
      return [];
    }
    const cap = procObjLotteryCap(batches, this.config.procObjLimit);
    const out: CellClutterRender[] = [];
    const matrix = new Matrix4();
    for (const batch of batches) {
      const def = this.defByName.get(batch.model);
      if (!def) {
        continue;
      }
      const cutoff = Math.min(this.config.procObjDensityOf?.(batch.category) ?? 1, cap);
      const breakable = this.isClutterBreakable(def.modelName);
      const floats: number[] = [];
      const hashes: number[] = [];
      for (const placement of batch.placements) {
        if (placement.lottery >= cutoff) {
          break; // placements are sorted by lottery ascending — the rest are all excluded
        }
        const elements = placementMatrix(placement, matrix).elements;
        floats.push(...elements);
        if (breakable) {
          // 074/20: the SAME key the collider carries (tagBreakable also reads the matrix translation).
          hashes.push(
            breakableKeyHash(breakableInstanceKey(def.modelName, [elements[12], elements[13], elements[14]])),
          );
        }
      }
      if (floats.length > 0) {
        out.push({
          ...(breakable ? { keyHashes: new Uint32Array(hashes) } : {}),
          matrices: new Float32Array(floats),
          modelName: def.modelName,
          txdName: def.txdName,
        });
      }
    }

    return out;
  }

  /** Drop the cached per-cell colliders (clutter knobs changed) — the collision streaming system
   *  then re-streams physics via {@link loadCellColliders}, rebuilding with the new density. */
  invalidateColliderCache(): void {
    this.colliderCache.clear();
    this.procObjBatchCache.clear();
  }

  listCells(): CellCoord[] {
    if (!this.grid) {
      return [];
    }

    return [...this.grid.values()].map((cell): CellCoord => [cell.cx, cell.cy]);
  }

  /**
   * Load the timecyc (per-weather, per-hour colour/lighting table), always as 24h.
   * Uses the optional `timecyc_24h.dat` as-is when present, else converts the
   * mandatory vanilla `timecyc.dat` (8 keyframes/weather) to 24h.
   */
  async loadTimecyc(): Promise<Timecyc> {
    await Promise.resolve(); // VFS reads are synchronous; the WorldAdapter API is async
    const text24 = this.fs.getText('data/timecyc_24h.dat');
    if (text24 !== null) {
      return buildTimecyc(parseTimecyc(text24));
    }

    return buildTimecyc(convertTo24h(parseTimecyc(requireText(this.fs, 'data/timecyc.dat'))));
  }

  /**
   * The renderer-agnostic vehicle load (074/08 B5 step 4): geometry the OWN ENGINE uploads as a model (one
   * per car type — instances share it), plus collision, handling and paint.
   *
   * Two paths converge here (opensa-pack 003): the OPTIMIZED `.osm`/`.ostex` read, and the UNOPTIMIZED
   * DFF/TXD parse below it. The caller cannot tell which ran, and must not need to.
   */
  async loadVehicleData(modelName: string, colour?: string): Promise<EngineVehicleData> {
    const optimized = await this.loadOptimizedVehicle(modelName, colour);
    if (optimized) {
      return optimized;
    }
    const { def, dffBuffer, paint, ...common } = await this.vehicleCommon(modelName, colour);
    // The car's own dictionary AND its `txdp` ancestors, then the shared generic set — highest priority
    // first, which is exactly how `VehicleTextures` merges.
    const generic = this.fs.get('models/generic/vehicle.txd');
    const txds = [...getTxdChain(this.fs, def.txd), ...(generic ? [generic] : [])];
    // Off-thread build when the worker exists (074/21 field fix — a new car type froze the frame ~170 ms):
    // buffers are COPIED before the transfer so the VFS keeps its originals.
    const model = this.vehicleModelBuilder
      ? await this.vehicleModelBuilder.build(
          dffBuffer.slice(0),
          txds.map((bytes) => bytes.slice(0)),
          def.wheelScale,
        )
      : buildVehicleModel(parseDff(dffBuffer), new VehicleTextures(txds), {
          wheelScale: def.wheelScale,
        });
    const seat = model.dummies.find((dummy: VehicleDummy) => dummy.name === SEAT_DUMMY_NAME) ?? null;

    return {
      colliders: common.colliders,
      halfExtents: common.halfExtents,
      handling: common.handling,
      model: toRigidModelInit(model),
      paint: enginePaint(paint),
      rig: model,
      seat: seat ? seat.position : null,
      wheels: model.wheels.map((wheel, index) => ({
        connection: [...model.parts[wheel.part].localTranslation] as [number, number, number],
        front: wheel.front,
        index,
        radius: wheel.radius,
      })),
    };
  }

  // eslint-disable-next-line
  async loadCellColliders(cx: number, cy: number): Promise<ModelColliders[]> {
    if (!this.defs || !this.grid) {
      throw new Error('GtaSaWorldAdapter.loadCellColliders called before prepare()');
    }
    const key = `${cx},${cy}`;
    let colliders = this.colliderCache.get(key);
    if (!colliders) {
      const index = buildCollisionIndex(this.fs);
      const archive = this.fs;
      const breakableModels = this.breakableModels;
      colliders = buildCellColliders(index, this.defs, this.grid, cx, cy).map((region) =>
        // Tag breakable-prop placements with their instance keys (plan 045) so a smashed prop's one
        // static body can be dropped — keyed the same way the render registry keys the prop. Matches
        // the render gate: a RW Breakable atomic OR an object.dat smash effect (render-geometry shatter).
        tagBreakable(
          toModelColliders(region),
          getBreakable(archive, region.name) !== undefined || breakableModels.has(region.name),
        ),
      );
      // Clutter collision (plan 042): models that ship a COL collide (rocks/cacti/trees);
      // grass and flower patches have none, so they stay walk-through — like vanilla. The
      // collidable subset follows the live per-category density (no invisible obstacles) — and a renderer
      // that draws no clutter at all asks for none of it.
      const batches = this.config.clutterColliders === false ? null : this.cellProcObjBatches(cx, cy);
      if (batches) {
        const clutter = procObjColliders(index, batches, {
          densityOf: this.config.procObjDensityOf,
          lotteryCap: procObjLotteryCap(batches, this.config.procObjLimit),
        });
        // Breakable clutter (074/20): 6 of 56 procobj models shatter (cactus/rubble/rock) — tag their colliders
        // with the SAME per-instance key the render carries, so a hit resolves to the instance to degenerate.
        colliders.push(
          ...clutter.map((region) => tagBreakable(toModelColliders(region), this.isClutterBreakable(region.name))),
        );
      }
      this.colliderCache.set(key, colliders);
    }

    return colliders;
  }

  /**
   * The map's specific-model car generators (binary IPL `CARS` sections in gta3.img) as parked-car placements
   * for the vehicle LOD system. `id → model` is resolved from `vehicles.ide`; random (`id = -1`) generators are
   * skipped (cargrp/popcycle resolution is a later phase — plan 059). Empty until {@link prepare} resolved the map.
   */
  async mapCarGenerators(options: {
    cityAt: (x: number, y: number) => City;
    hour: number;
  }): Promise<VehiclePlacement[]> {
    await this.ensureVehicleData();
    await this.ensurePopulationData();
    const generators = this.defs?.carGenerators ?? [];
    const modelById = new Map<number, string>();
    for (const def of this.vehicleDefs?.values() ?? []) {
      modelById.set(def.id, def.model.toLowerCase());
    }
    const specific = carGeneratorPlacements(generators, modelById);
    if (this.popcycle === null || this.carGroups === null) {
      return specific; // no popcycle/cargrp shipped → only the specific-model generators
    }
    // Random (id = -1) generators: resolve via the zone-type popcycle weights → a cargrp model (B1, plan 059).
    const popcycle = this.popcycle;
    const random = randomCarPlacements(generators, {
      accept: (model) => this.vehicleDefs?.has(model) ?? false,
      cargrp: this.carGroups,
      hour: options.hour,
      popcycleFor: (position) => popcycle.get(CITY_POPCYCLE_ZONE[options.cityAt(position[0], position[1])]) ?? null,
    });

    return [...specific, ...random];
  }

  async prepare(onProgress?: (fraction: number) => void): Promise<void> {
    await Promise.resolve(); // VFS reads are synchronous; the WorldAdapter API is async
    if (this.defs) {
      onProgress?.(1); // already prepared (e.g. a debug reload) — skip the heavy work

      return;
    }
    this.defs = resolveMap(this.fs, { extraIpl: this.config.extraIpl });
    // The IDE `txdp` links, handed to the asset cache so runtime-parsed TXDs inherit from their parents
    // (opensa-pack 003). Anything opensa-pack converted had its chain flattened offline; this serves the
    // unoptimized path, where a modded TXD with a parent would otherwise lose the inherited textures.
    setTxdParents(this.defs.txdParents);
    this.grid = buildWorldGrid(this.defs, this.cellSize);
    this.defByName = new Map([...this.defs.catalog.values()].map((def) => [def.modelName.toLowerCase(), def]));
    // Procedural ground clutter (plan 042): both data files present → cells scatter; else skipped.
    const procObjText = this.fs.getText('data/procobj.dat');
    const surfInfoText = this.fs.getText('data/surfinfo.dat');
    if (procObjText !== null && surfInfoText !== null) {
      this.procObjRules = groupRulesBySurface(parseProcObj(procObjText));
      this.surfaceNames = parseSurfaceNames(surfInfoText);
    }
    // The full table is read whenever the file is there, procobj or not: what a WHEEL stands on has nothing
    // to do with whether ground clutter scatters (plan 081/10).
    if (surfInfoText !== null) {
      this.surfaceTable = parseSurfaceInfo(surfInfoText);
      this.tyreAdhesionTable = tyreAdhesionPerMaterial(this.surfaceTable, this.fs.getText('data/surface.dat'));
    }
    // Breakable-prop tuning (plan 045) — absent-tolerant: no file, props still break at the default
    // threshold (the break gate is the RW Breakable mesh, not this table).
    const objectDatText = this.fs.getText('data/object.dat');
    if (objectDatText !== null) {
      this.objectDat = parseObjectDat(objectDatText);
      // The SAME gate the converter records smashable ranges with — one definition, or the two disagree.
      for (const name of breakableModelsOf(this.objectDat)) {
        this.breakableModels.add(name);
      }
    }
    onProgress?.(1);
  }

  /** The `surfinfo.dat` table, indexed by collision material id (plan 081/10) — null before `prepare`, or
   *  when the world ships no such file. The parsed rows already ARE the engine-side shape. */
  surfaces(): null | readonly SurfaceRecord[] {
    return this.surfaceTable;
  }

  /** The model's TXD name — the own engine needs it to texture a smashed prop's shards (074/08 B7·a). */
  txdOf(modelName: string): string | undefined {
    return this.defByName?.get(modelName.toLowerCase())?.txdName;
  }

  /** What a TYRE grips on each collision material (plan 081/10): `surface.dat`'s rubber row resolved through
   *  each surface's adhesion group, indexed by material id. Null when either data file is missing — and then
   *  the physics keeps its road-only constant rather than guessing. */
  tyreAdhesion(): null | { perMaterial: Float32Array; road: number } {
    return this.tyreAdhesionTable;
  }

  /** Every carcol paint combo for a model (palette-index tuples) — 2-colour entries then 4-colour;
   *  empty if the car has none. Lets callers cycle paint on repeated spawns (each combo is its OWN car's). */
  async vehicleColourCombos(modelName: string): Promise<number[][]> {
    await this.ensureVehicleData();
    const name = modelName.toLowerCase();
    const colours = this.vehicleColours;

    return [...(colours?.cars.get(name) ?? []), ...(colours?.cars4.get(name) ?? [])].map((combo) => [...combo]);
  }

  /** The shared generic `vehicle.txd` texture map, parsed once. */
  /**
   * Resolve JUST a car's carcols paint (074/08 B5) — the own engine shares ONE uploaded model across every
   * car of a type and paints each instance, so a spawn needs the colours without re-parsing the DFF.
   */
  async vehiclePaint(modelName: string, colour?: string): Promise<EngineVehicleData['paint']> {
    await this.ensureVehicleData();
    const indices = colour
      ? colour
          .split(',')
          .map((cell) => Number(cell.trim()))
          .filter((value) => Number.isFinite(value))
      : undefined;
    const paint = this.resolveVehicleColours(modelName.toLowerCase(), indices);

    return {
      primary: scale255(paint.primary),
      quaternary: scale255(paint.quaternary ?? paint.secondary),
      secondary: scale255(paint.secondary),
      tertiary: scale255(paint.tertiary ?? paint.primary),
    };
  }

  /** Deterministic clutter batches for one cell (plan 042), or null when the procobj data files
   *  were absent. Shared by the render path (loadCell) and the collider path (loadCellColliders) —
   *  same inputs give byte-identical batches, so visuals and collision always agree. */
  private cellProcObjBatches(cx: number, cy: number): null | readonly ProcObjBatch[] {
    if (!this.defs || !this.grid || !this.procObjRules || !this.surfaceNames) {
      return null;
    }
    const key = `${cx},${cy}`;
    const cached = this.procObjBatchCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const colliders = buildCellColliders(buildCollisionIndex(this.fs), this.defs, this.grid, cx, cy);
    const batches = scatterProcObjects(colliders, this.procObjRules, this.surfaceNames, cx, cy);
    this.procObjBatchCache.set(key, batches);

    return batches;
  }

  /** Lazily load popcycle.dat + cargrp.dat for random map-car resolution (plan 059) — absent-tolerant: either
   *  missing leaves its field null, so a game without them simply spawns no random map cars. */
  private async ensurePopulationData(): Promise<void> {
    await Promise.resolve(); // VFS reads are synchronous; the WorldAdapter API is async
    if (this.populationLoaded) {
      return;
    }
    this.populationLoaded = true;
    const popcycle = this.fs.getText('data/popcycle.dat');
    const cargrp = this.fs.getText('data/cargrp.dat');
    this.popcycle = popcycle === null ? null : parsePopcycle(popcycle);
    this.carGroups = cargrp === null ? null : parseCarGroups(cargrp);
  }

  /** Lazily fetch + parse vehicles.ide, carcols.dat and handling.cfg (cached). */
  private async ensureVehicleData(): Promise<void> {
    await Promise.resolve(); // VFS reads are synchronous; the WorldAdapter API is async
    if (this.vehicleDefs && this.vehicleColours && this.handling) {
      return;
    }
    const ide = requireText(this.fs, 'data/vehicles.ide');
    const carcols = requireText(this.fs, 'data/carcols.dat');
    const handling = requireText(this.fs, 'data/handling.cfg');
    this.vehicleDefs = parseVehicleDefs(ide);
    this.vehicleColours = parseCarcols(carcols);
    this.handling = parseHandling(handling); // stored for the later vehicle-physics phase
  }

  /** A clutter model that shatters (074/20): a DFF Breakable shatter mesh or an object.dat smash effect —
   *  the SAME gate the static breakable props use. */
  private isClutterBreakable(name: string): boolean {
    return getBreakable(this.fs, name) !== undefined || this.breakableModels.has(name);
  }

  /** Everything both vehicle load paths need: the IDE def, the DFF bytes, its collision and its paint. */
  /**
   * The OPTIMIZED spawn (opensa-pack 003 phase 3): `<model>.osm` + `<model>.ostex`, no RW parser entered.
   * Returns null when this car is not converted, and the caller falls through to the unoptimized path.
   *
   * **Resolution order** — the plan's rule, implemented by asking for the `.dff` FIRST. That looks
   * backwards until you see what conversion does: opensa-pack DELETES `<model>.dff` from the archives, so
   * after a convert the only thing that can still answer with one is a `modloader/` override. Hence a
   * present `.dff` means either "a mod is overriding this car" or "this build was never converted", and
   * both must take the unoptimized path. There is no way to ask the VFS *where* a name came from, so this
   * ordering IS the modloader-wins rule rather than an approximation of it.
   */
  private async loadOptimizedVehicle(modelName: string, colour?: string): Promise<EngineVehicleData | null> {
    await this.ensureVehicleData();
    const name = modelName.toLowerCase();
    const def = this.vehicleDefs?.get(name);
    if (!def) {
      throw new Error(`No vehicle definition for '${modelName}' in vehicles.ide`);
    }
    if (this.fs.get(`${name}.dff`)) {
      return null; // a modloader override, or an unconverted build
    }
    const osm = this.fs.get(`${name}.osm`);
    if (!osm) {
      return null; // nothing at all — the unoptimized path raises the "asset not found" error
    }
    // The mixing rule (user decision 2026-07-18): a mod that ships only the TXD of a converted car cannot
    // be honoured — our `.osm` carries its own baked atlas, indexed by layer rather than by texture name —
    // so the optimized model wins and the ignored file is named. Retexture-only car mods do nothing.
    //
    // It must ask the MODLOADER OVERLAY, not the merged VFS (field check, 2026-07-19): a converted build
    // legitimately keeps the stock TXDs that unconverted models still need, and asking `fs.get` called
    // every one of those a mod — the warning fired for cars nobody had touched.
    if (isModdedAsset(this.fs, `${def.txd.toLowerCase()}.txd`)) {
      this.warnAsset(`ignoring modded ${def.txd.toLowerCase()}.txd — '${name}' is an optimized model`);
    }

    const vehicle = readVehicleOsm(name, new Uint8Array(osm));

    return {
      colliders: vehicle.colliders,
      halfExtents: vehicle.halfExtents,
      handling: this.vehicleHandling(def.handlingId),
      model: vehicle.model,
      paint: enginePaint(this.resolveVehicleColours(name, colourIndices(colour))),
      rig: vehicle.rig,
      seat: vehicle.seat,
      wheels: vehicle.wheels,
    };
  }

  /** First carcol combo for a model → primary/secondary RGB (falls back to white).
   *  Missing 3rd/4th colours default to palette index 0 (black), like SA does for 2-colour cars. */
  private resolveVehicleColours(name: string, indices?: number[]): VehiclePaint {
    const colours = this.vehicleColours;
    const white: [number, number, number] = [255, 255, 255];
    const rgb = (index: number): [number, number, number] => colours?.palette[index] ?? white;
    const paint = (combo: readonly number[]): VehiclePaint => ({
      primary: rgb(combo[0]),
      quaternary: rgb(combo[3] ?? 0),
      secondary: rgb(combo[1] ?? combo[0]),
      tertiary: rgb(combo[2] ?? 0),
    });

    // Explicit carcols indices (e.g. '37,37' / '0,6,3,0') win.
    if (indices && indices.length > 0) {
      return paint(indices);
    }
    const combo = colours?.cars.get(name)?.[0];
    if (combo) {
      return paint(combo);
    }
    const combo4 = colours?.cars4.get(name)?.[0];
    if (combo4) {
      return paint(combo4);
    }

    return { primary: white, secondary: white };
  }

  private async vehicleCommon(
    modelName: string,
    colour?: string,
  ): Promise<{
    colliders: ModelColliders | null;
    def: VehicleDef;
    dffBuffer: ArrayBuffer;
    halfExtents: [number, number, number];
    handling: VehicleHandling;
    paint: VehiclePaint;
  }> {
    await this.ensureVehicleData();
    const name = modelName.toLowerCase();
    const def = this.vehicleDefs?.get(name);
    if (!def) {
      throw new Error(`No vehicle definition for '${modelName}' in vehicles.ide`);
    }
    // Bare archive names — straight from gta3.img (or shadowed by a modloader override). No loose `vehicles/`
    // folder: the roster comes from vehicles.ide, so models live under their plain `<model>.dff` key.
    const dffBuffer = requireBuffer(this.fs, `${def.model.toLowerCase()}.dff`);
    const indices = colour
      ? colour
          .split(',')
          .map((cell) => Number(cell.trim()))
          .filter((value) => Number.isFinite(value))
      : undefined;
    const col = parseDffCollision(dffBuffer);

    return {
      colliders: col ? toModelColliders({ col, name: col.name, transforms: [] }) : null,
      def,
      dffBuffer,
      // Half-extents from the collision bounds — robust to stray vertices in modded DFFs
      // (a mesh bbox can blow up); the COL is authored clean.
      halfExtents: col
        ? [
            Math.max(Math.abs(col.bounds.min[0]), Math.abs(col.bounds.max[0])),
            Math.max(Math.abs(col.bounds.min[1]), Math.abs(col.bounds.max[1])),
            Math.max(Math.abs(col.bounds.min[2]), Math.abs(col.bounds.max[2])),
          ]
        : [1.2, 2.5, 0.7],
      handling: this.vehicleHandling(def.handlingId),
      paint: this.resolveVehicleColours(name, indices),
    };
  }

  /**
   * Driving feel for a handling id — the WHOLE row, typed (plan 081/02).
   *
   * Indices are the game's own column order, pinned by tests against real rows rather than by the file's
   * legend (which lists a "(not used)" column the shipped data does not carry). Values pass through as
   * authored: what a number becomes — a force, a spring rate, a top speed — is the consuming plan's
   * decision, made with its own evidence.
   *
   * The fallback row is a mid-range sedan, used when a car has no handling entry at all. It is deliberately
   * bland: a missing row should drive dully, never surprisingly.
   */
  private vehicleHandling(handlingId: string): VehicleHandling {
    const fields = this.handling?.get(handlingId)?.fields;
    const num = (index: number, fallback: number): number => {
      const value = Number(fields?.[index]);

      return Number.isFinite(value) ? value : fallback;
    };
    const text = (index: number): string => (fields?.[index] ?? '').toUpperCase();
    const drive = text(14);
    const engine = text(15);

    // `modelFlags` is HEX (the file's legend says so in capitals) and its 5th/6th digits are the two axles.
    const modelFlags = Number.parseInt(text(30), 16);

    return {
      abs: num(18, 0) !== 0,
      axleFront: axleSetup(modelFlags, 16),
      axleRear: axleSetup(modelFlags, 20),
      brakeBias: num(17, 0.5),
      brakeDecel: num(16, 8.5),
      centreOfMass: [num(3, 0), num(4, 0), num(5, 0)],
      collisionDamageMult: num(28, 1),
      dragMult: num(2, 2),
      drive: drive === 'F' || drive === 'R' ? drive : '4',
      engineAccel: num(12, 22),
      engineInertia: num(13, 20),
      engineType: engine === 'D' || engine === 'E' ? engine : 'P',
      gears: num(10, 5),
      mass: num(0, 1500),
      maxVelocity: num(11, 160),
      steeringLock: num(19, 30),
      suspAntiDive: num(26, 0),
      suspBias: num(25, 0.5),
      suspDamping: num(21, 0.1),
      suspForce: num(20, 0.9),
      suspHighSpeedDamp: num(22, 0),
      suspLower: num(24, -0.15),
      suspUpper: num(23, 0.3),
      tractionBias: num(9, 0.5),
      tractionLoss: num(8, 0.85),
      tractionMult: num(7, 0.75),
      turnMass: num(1, 3000),
    };
  }

  /** One line per distinct message — an asset warning fires on a spawn path, so it must never spam. */
  private warnAsset(message: string): void {
    if (this.warnedAssets.has(message)) {
      return;
    }
    this.warnedAssets.add(message);
    this.config.onAssetWarning?.(message);
  }
}

export function toModelColliders({ col, name, transforms }: RegionColliders): ModelColliders {
  const indices = new Uint32Array(col.faces.length * 3);
  // One surface byte per TRIANGLE, in the same order as the indices — this is what makes a wheel able to
  // ask what it is standing on (plan 081/10). A byte per triangle beside twelve per vertex is free.
  const materials = new Uint8Array(col.faces.length);
  col.faces.forEach((face, i) => {
    indices[i * 3] = face.a;
    indices[i * 3 + 1] = face.b;
    indices[i * 3 + 2] = face.c;
    materials[i] = face.material;
  });

  return {
    name,
    shape: {
      boxes: col.boxes.map((box) => ({ material: box.surface.material, max: box.max, min: box.min })),
      indices,
      materials,
      spheres: col.spheres.map((sphere) => ({
        center: sphere.center,
        material: sphere.surface.material,
        radius: sphere.radius,
      })),
      vertices: col.vertices,
    },
    transforms,
  };
}

/** Tag a model's collider placements with breakable instance keys (plan 045); a pass-through for
 *  non-breakable models. The key matches the render registry's (model + cm-rounded translation). */
/**
 * The tyre-adhesion lookup the physics uses (081/10): one absolute number per collision material — SA's
 * `surface.dat` rubber row (road 4.5 · hard 3.6 · loose 3.2 · sand 3.0 · wet 2.8) resolved through each
 * surface's adhesion group. Built ONCE here, where both files are already parsed, so the per-step path is a
 * single array index with no strings and no map.
 *
 * Null when `surface.dat` is absent: a world that ships no matrix must not be handed a made-up one.
 */
export function tyreAdhesionPerMaterial(
  surfaces: readonly SurfaceInfo[],
  surfaceDat: null | string,
): null | { perMaterial: Float32Array; road: number } {
  if (surfaceDat === null) {
    return null;
  }
  const matrix = parseSurfaceAdhesion(surfaceDat);
  const road = matrix.get('rubber', 'road');
  if (road === null) {
    return null;
  }
  const perMaterial = new Float32Array(surfaces.length);
  surfaces.forEach((surface, material) => {
    // An unknown group falls back to ROAD — the surface a car normally drives on, so an unmapped material
    // behaves exactly as it does today rather than becoming mysteriously slippery.
    perMaterial[material] = matrix.get('rubber', surface.adhesionGroup) ?? road;
  });

  return { perMaterial, road };
}

/**
 * One axle's build out of the `modelFlags` nibble at `shift` (16 = front, 20 = rear) — see {@link AxleSetup}.
 *
 * A row that authors two types at once (none of the 210 stock ones do) is read in the order the game lists
 * them, and an unreadable column reads as `independent`: a missing flag must never invent an axle.
 */
function axleSetup(modelFlags: number, shift: number): AxleSetup {
  const nibble = Number.isFinite(modelFlags) ? (modelFlags >>> shift) & 0xf : 0;
  const type: AxleType = nibble & 0x1 ? 'notilt' : nibble & 0x2 ? 'solid' : nibble & 0x4 ? 'mcpherson' : 'independent';

  return { reverse: (nibble & 0x8) !== 0, type };
}

/** Convert renderware collision (COL model + placements) to the engine's generic shape. */
/** A `colour` override string (`"1,2"`) as carcols palette indices, or undefined for the model's default. */
function colourIndices(colour?: string): number[] | undefined {
  return colour
    ? colour
        .split(',')
        .map((cell) => Number(cell.trim()))
        .filter((value) => Number.isFinite(value))
    : undefined;
}

/**
 * Carcols bytes → the engine's 0..1 `setPaint` space. The same values the builder writes into the
 * non-marker vertex colours, so a painted panel and a plain one sit in the same colour space.
 */
function enginePaint(paint: VehiclePaint): EngineVehicleData['paint'] {
  return {
    primary: scale255(paint.primary),
    quaternary: scale255(paint.quaternary ?? paint.secondary),
    secondary: scale255(paint.secondary),
    tertiary: scale255(paint.tertiary ?? paint.primary),
  };
}

function requireBuffer(fs: AssetFileSystem, name: string): ArrayBuffer {
  const buffer = fs.get(name);
  if (!buffer) {
    throw new Error(`asset not found: ${name}`);
  }

  return buffer;
}

/** Read a required text asset from the file system (throws if absent). */
function requireText(fs: AssetFileSystem, name: string): string {
  const text = fs.getText(name);
  if (text === null) {
    throw new Error(`asset not found: ${name}`);
  }

  return text;
}

/** Read a required binary asset from the file system (throws if absent). */
/** carcols bytes → the engine's 0..1 colour space. */
function scale255(rgb: readonly [number, number, number]): Rgb {
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
}

function tagBreakable(model: ModelColliders, isBreakable: boolean): ModelColliders {
  if (!isBreakable) {
    return model;
  }
  const instanceKeys = model.transforms.map((matrix) =>
    breakableInstanceKey(model.name, [matrix.elements[12], matrix.elements[13], matrix.elements[14]]),
  );

  return { ...model, instanceKeys };
}
