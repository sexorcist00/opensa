import type { System } from '../core/system';
import type { Config } from '../interfaces/config.interface';
import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { VehicleBand, VehicleHandle } from './vehicle-handle';

/** A live, spawned car: its render handle, live position, and how to despawn it. */
export interface SpawnedVehicle {
  /** Remove from the scene, physics and the vehicle systems (frees memory). */
  despawn: () => void;
  handle: VehicleHandle;
  /** Live world position (native Z-up); kept updated by the physics system. */
  position: Vec3;
}

/** A parked-car placement (what {@link VehicleLodSystem} respawns from). */
export interface VehiclePlacement {
  /** Optional carcols palette indices for the paint (e.g. `'34,34'`); omit for the car's default. */
  colour?: string;
  /** Snap the spawn down onto the ground (raycast) so the body doesn't penetrate terrain and get ejected — set
   *  for map car generators whose IPL positions sit in tight/clipping spots. */
  groundSnap?: boolean;
  heading: number;
  model: string;
  position: Vec3;
}

interface LodEntry {
  /** The spawned car, or null while unloaded. */
  current: null | SpawnedVehicle;
  /** Last known position (distance source — kept live while loaded, frozen when unloaded). */
  home: Vec3;
  /** A respawn is in flight (loadVehicle is async) — don't kick off another. */
  loading: boolean;
  placement: VehiclePlacement;
}

/**
 * Distance LOD + memory streaming for the parked cars. Each frame it measures a
 * car's distance from the player view and, per {@link Config.vehicle} thresholds,
 * shows the full HD body, the low-detail `_vlo`, culls it, or unloads it from
 * memory (respawning when the view returns within range). A car within enter/drive
 * range is always in the HD band, so the player's own car never degrades or unloads.
 */
export class VehicleLodSystem implements System {
  readonly name = 'vehicle-lod';

  private readonly config: Readonly<Config>;
  private readonly entries: LodEntry[] = [];
  private readonly spawn: (placement: VehiclePlacement) => Promise<SpawnedVehicle>;
  private readonly viewOf: () => Vec3;

  constructor(
    viewOf: () => Vec3,
    config: Readonly<Config>,
    spawn: (placement: VehiclePlacement) => Promise<SpawnedVehicle>,
  ) {
    this.viewOf = viewOf;
    this.config = config;
    this.spawn = spawn;
  }

  /** Register an already-spawned car against the placement it can be respawned from. */
  add(placement: VehiclePlacement, current: SpawnedVehicle): void {
    this.entries.push({ current, home: [...current.position], loading: false, placement });
  }

  /**
   * Register a placement to be spawned **lazily** by distance — no upfront spawn. The stream loop materialises
   * it once the view comes within `lodDistance` and unloads it again past `unloadDistance`. Used for the many
   * map car generators (binary IPL CARS), where pre-spawning every one across the map would spike load.
   */
  register(placement: VehiclePlacement): void {
    this.entries.push({ current: null, home: [...placement.position], loading: false, placement });
  }

  update(): void {
    const [vx, vy, vz] = this.viewOf();
    const { hdDistance, lodDistance, unloadDistance } = this.config.vehicle;
    for (const entry of this.entries) {
      if (entry.current) {
        [entry.home[0], entry.home[1], entry.home[2]] = entry.current.position; // track last known
      }
      const dx = entry.home[0] - vx;
      const dy = entry.home[1] - vy;
      const dz = entry.home[2] - vz;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      this.stream(entry, distance, lodDistance, unloadDistance);
      if (entry.current) {
        entry.current.handle.setLodBand(bandFor(distance, hdDistance, lodDistance, entry.current.handle.hasLod));
      }
    }
  }

  /** Unload past `unloadDistance`; respawn once back within `lodDistance` (hysteresis between). */
  private stream(entry: LodEntry, distance: number, lodDistance: number, unloadDistance: number): void {
    if (distance >= unloadDistance) {
      entry.current?.despawn();
      entry.current = null;

      return;
    }
    if (!entry.current && !entry.loading && distance < lodDistance) {
      entry.loading = true;
      this.spawn(entry.placement)
        .then((spawned) => (entry.current = spawned))
        .catch(() => undefined)
        .finally(() => (entry.loading = false));
    }
  }
}

/** The band for a distance; falls back to HD when the model has no `_vlo` (`hasLod` false). */
function bandFor(distance: number, hdDistance: number, lodDistance: number, hasLod: boolean): VehicleBand {
  if (distance < hdDistance) {
    return 'hd';
  }
  if (distance < lodDistance) {
    return hasLod ? 'vlo' : 'hd';
  }

  return 'culled';
}
