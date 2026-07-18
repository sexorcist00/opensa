import type { parsePedDefs } from '@opensa/renderware';

// game/adapters/** (and game/mods/**) are the only places allowed to import renderware.
import { Matrix4 } from '@opensa/math';
import {
  type AssetFileSystem,
  breakableInstanceKey,
  breakableKeyHash,
  breakableModelsOf,
  buildCellColliders,
  buildCollisionIndex,
  buildTimecyc,
  buildVehicleModel,
  buildWorldGrid,
  type CarGroup,
  cellModelNames,
  convertTo24h,
  getBreakable,
  groupRulesBySurface,
  type HandlingEntry,
  hasClump,
  hasPreparedAtomics,
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
  parseSurfaceNames,
  parseTimecyc,
  parseVehicleDefs,
  placementMatrix,
  type PopcycleZone,
  primeClump,
  primePreparedAtomics,
  type ProcObjBatch,
  type ProcObjCategoryName,
  procObjColliders,
  procObjLotteryCap,
  type ProcObjRule,
  type RegionColliders,
  type RenderPart,
  resolveMap,
  scatterProcObjects,
  setTxdParents,
  type Timecyc,
  type VehicleColours,
  type VehicleDef,
  type VehicleDummy,
  type VehicleModelData,
  VehicleTextures,
  type WorldGrid,
} from '@opensa/renderware';

import type { ModelColliders } from '../interfaces/collider.interface';
import type { CellRequest, VehicleHandling, WorldAdapter } from '../interfaces/world-adapter.interface';
import type { WorldMod } from '../mods/mod.interface';
import type { CellCoord } from '../streaming/grid';
import type { VehiclePlacement } from '../vehicle/vehicle-lod.system';
import type { City } from '../zones/city';

import { carGeneratorPlacements } from './car-generators';
import { createDffParser, type DffParser } from './dff-parser';
import { randomCarPlacements } from './popcycle-cars';
import { createVehicleModelBuilder, type VehicleModelBuilder } from './vehicle-model-builder';

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
  model: VehicleModelData;
  /** Carcols colours as 0..1 (the engine's `setPaint` space). */
  paint: { primary: Rgb; quaternary: Rgb; secondary: Rgb; tertiary: Rgb };
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
  /** Off-thread DFF parse+prepare for cell builds (plan 060 Phase 5). Defaults to the real parse
   *  worker where Workers exist; null falls back to synchronous in-generator parsing (node tests). */
  dffParser?: DffParser | null;
  /** Standalone script-gated binary IPL groups to load (plan 042) — the world-state choice
   *  vanilla makes via mission-script LOAD_IPL/REMOVE_IPL (e.g. `truthsfarm`, `barriers1`). */
  extraIpl?: readonly string[];
  /** The asset source (plan 050) — all models/textures/data are read from here, not fetched. */
  fs: AssetFileSystem;
  /** Installed game mods (plan 039) — their `decoratePart` hooks run during cell builds. */
  mods?: readonly WorldMod[];
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
  /** Composed mod build-hook (undefined when no mods) — see {@link GtaSaWorldConfig.mods}. */
  private readonly decoratePart?: (def: IdeObjectDef, part: RenderPart) => void;
  /** Catalog defs by lowercased model name — resolves procobj clutter models to their TXDs. */
  private defByName: Map<string, IdeObjectDef> | null = null;
  private defs: MapDefinitions | null = null;
  /** Off-thread parse client (plan 060 Phase 5); null = synchronous fallback. */
  private readonly dffParser: DffParser | null;
  private readonly fs: AssetFileSystem;
  private grid: null | WorldGrid = null;
  /** Parsed `handling.cfg`, kept for the later vehicle-physics phase. */
  private handling: Map<string, HandlingEntry> | null = null;
  /** Parsed `object.dat` collision-damage tuning by lowercased model (plan 045); null when absent. */
  private objectDat: Map<string, ObjectDatEntry> | null = null;
  /** Models the parse worker is currently parsing — concurrent cells await instead of re-sending. */
  private readonly parseInFlight = new Map<string, Promise<void>>();
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
  private vehicleColours: null | VehicleColours = null;
  private vehicleDefs: Map<string, VehicleDef> | null = null;
  private readonly vehicleModelBuilder: null | VehicleModelBuilder;

  constructor(config: GtaSaWorldConfig) {
    this.config = config;
    this.fs = config.fs;
    this.cellSize = config.cellSize;
    this.dffParser = config.dffParser === undefined ? createDffParser() : config.dffParser;
    this.vehicleModelBuilder =
      config.vehicleModelBuilder === undefined ? createVehicleModelBuilder() : config.vehicleModelBuilder;
    const mods = config.mods ?? [];
    this.decoratePart =
      mods.length === 0
        ? undefined
        : (def, part): void => {
            for (const mod of mods) {
              mod.decoratePart?.(def, part);
            }
          };
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
   * The renderer-agnostic vehicle load (074/08 B5 step 4): the same definition/collision/handling/paint work
   * as {@link loadVehicle}, but the renderable is a {@link VehicleModelData} the OWN ENGINE uploads as a
   * model (one per car type — instances share it). The three path keeps its `Object3D` tree.
   */
  async loadVehicleData(modelName: string, colour?: string): Promise<EngineVehicleData> {
    const { def, dffBuffer, paint, ...common } = await this.vehicleCommon(modelName, colour);
    const txds = [`${def.txd.toLowerCase()}.txd`, 'models/generic/vehicle.txd']
      .map((txdName) => this.fs.get(txdName))
      .filter((bytes): bytes is ArrayBuffer => bytes !== null && bytes !== undefined);
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
    const seat = model.dummies.find((dummy: VehicleDummy) => dummy.name === 'ped_frontseat') ?? null;

    return {
      colliders: common.colliders,
      halfExtents: common.halfExtents,
      handling: common.handling,
      model,
      // The engine takes 0..1 colours; carcols is bytes. Same values the builder writes into the non-marker
      // vertex colours, so a painted panel and a plain one sit in the same colour space.
      paint: {
        primary: scale255(paint.primary),
        quaternary: scale255(paint.quaternary ?? paint.secondary),
        secondary: scale255(paint.secondary),
        tertiary: scale255(paint.tertiary ?? paint.primary),
      },
      seat: seat ? seat.position : null,
      wheels: model.wheels.map((wheel, index) => ({
        connection: [...model.parts[wheel.part].localTranslation] as [number, number, number],
        front: wheel.front,
        index,
        radius: wheel.radius,
      })),
    };
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
    setTxdParents(this.defs.txdParents ?? new Map<string, string>()); // wire txdp: area TXDs inherit *_gene parents
    this.grid = buildWorldGrid(this.defs, this.cellSize);
    this.defByName = new Map([...this.defs.catalog.values()].map((def) => [def.modelName.toLowerCase(), def]));
    // Procedural ground clutter (plan 042): both data files present → cells scatter; else skipped.
    const procObjText = this.fs.getText('data/procobj.dat');
    const surfInfoText = this.fs.getText('data/surfinfo.dat');
    if (procObjText !== null && surfInfoText !== null) {
      this.procObjRules = groupRulesBySurface(parseProcObj(procObjText));
      this.surfaceNames = parseSurfaceNames(surfInfoText);
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

  /** The model's TXD name — the own engine needs it to texture a smashed prop's shards (074/08 B7·a). */
  txdOf(modelName: string): string | undefined {
    return this.defByName?.get(modelName.toLowerCase())?.txdName;
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

  /**
   * Parse + geometry-prepare a cell's uncached models in the parse worker, priming the renderware caches
   * (plan 060 Phase 5). Models another cell already sent are awaited, not re-sent. No-op without a worker
   * (node tests, unsupported environments) — the sliced build then parses synchronously as before.
   */
  private async preparseCellModels(request: CellRequest): Promise<void> {
    if (!this.dffParser || !this.defs || !this.grid) {
      return;
    }
    const names = cellModelNames(this.defs, this.grid, request.cx, request.cy, request.lod);
    const inFlight = names
      .map((name) => this.parseInFlight.get(name.toLowerCase()))
      .filter((batch): batch is Promise<void> => batch !== undefined);
    const fresh = names.filter((name) => {
      const key = name.toLowerCase();

      return !this.parseInFlight.has(key) && !(hasClump(name) && hasPreparedAtomics(name));
    });
    if (fresh.length > 0) {
      const models = fresh
        .map((name) => ({ buffer: this.fs.get(`${name.toLowerCase()}.dff`), name }))
        .filter((model): model is { buffer: ArrayBuffer; name: string } => model.buffer !== null);
      const batch = this.dffParser
        .parse(models)
        .then((parsed) => {
          parsed.forEach(({ clump, name, prepared }) => {
            primeClump(name, clump);
            primePreparedAtomics(name, prepared);
          });
        })
        .finally(() => {
          fresh.forEach((name) => this.parseInFlight.delete(name.toLowerCase()));
        });
      fresh.forEach((name) => this.parseInFlight.set(name.toLowerCase(), batch));
      inFlight.push(batch);
    }
    await Promise.all(inFlight);
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

  /** Everything both vehicle load paths need: the IDE def, the DFF bytes, its collision and its paint. */
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

  /** Driving feel for a handling id (handling.cfg columns), with sane fallbacks. */
  private vehicleHandling(handlingId: string): VehicleHandling {
    const fields = this.handling?.get(handlingId)?.fields;
    const num = (index: number, fallback: number): number => {
      const value = Number(fields?.[index]);

      return Number.isFinite(value) ? value : fallback;
    };

    return {
      brakeDecel: num(16, 8.5),
      engineAccel: num(12, 22),
      mass: num(0, 1500),
      maxVelocity: num(11, 160),
      steeringLock: num(19, 30),
    };
  }
}

/** Convert renderware collision (COL model + placements) to the engine's generic shape. */
export function toModelColliders({ col, name, transforms }: RegionColliders): ModelColliders {
  const indices = new Uint32Array(col.faces.length * 3);
  col.faces.forEach((face, i) => {
    indices[i * 3] = face.a;
    indices[i * 3 + 1] = face.b;
    indices[i * 3 + 2] = face.c;
  });

  return {
    name,
    shape: {
      boxes: col.boxes.map((box) => ({ max: box.max, min: box.min })),
      indices,
      spheres: col.spheres.map((sphere) => ({ center: sphere.center, radius: sphere.radius })),
      vertices: col.vertices,
    },
    transforms,
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

/** Tag a model's collider placements with breakable instance keys (plan 045); a pass-through for
 *  non-breakable models. The key matches the render registry's (model + cm-rounded translation). */
function tagBreakable(model: ModelColliders, isBreakable: boolean): ModelColliders {
  if (!isBreakable) {
    return model;
  }
  const instanceKeys = model.transforms.map((matrix) =>
    breakableInstanceKey(model.name, [matrix.elements[12], matrix.elements[13], matrix.elements[14]]),
  );

  return { ...model, instanceKeys };
}
