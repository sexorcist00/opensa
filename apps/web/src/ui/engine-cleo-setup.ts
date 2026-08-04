/**
 * Production wiring for CLEO (plan 097/04): the real `CleoHostDeps` over engine + VFS + world
 * adapter, boot discovery of `cleo/*.cs`, and the census line. Model loading is the engine-props
 * path — `.osm` first, DFF/TXD fallback — built ON-THREAD (decision 1: measure first, copy the
 * worker only if spawn hitches show; numbers go to the ledger).
 */
import type { Engine, VehicleInstance, VehicleModelId } from '@opensa/engine';
import type { GtaSaWorldAdapter } from '@opensa/game/adapters/gta-sa-world.adapter';
import type { Config } from '@opensa/game/interfaces/config.interface';
import type { AssetFileSystem } from '@opensa/renderware';

import { ScriptRunner } from '@opensa/cleo';
import { toRigidModelInit } from '@opensa/game/adapters/vehicle-model-init';
import { readModelOsm } from '@opensa/game/adapters/vehicle-osm';
import { getClump, getTxdChain } from '@opensa/renderware/archive/asset-cache';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';

import type { CleoObjectInstance } from './engine-cleo';

import { CleoRunnerSystem, createCleoEngineHost, discoverAndSpawn } from './engine-cleo';

export interface EngineCleoArgs {
  readonly adapter: GtaSaWorldAdapter;
  /** Camera eye in GTA space — the LOD swaps and 0EBE read it. */
  readonly cameraGta: () => readonly [number, number, number];
  readonly config: Config;
  readonly engine: Engine;
  readonly fs: AssetFileSystem;
  readonly hour: () => number;
  readonly playerGta: () => readonly [number, number, number];
  readonly ridingCar: () => boolean;
}

interface BuiltModel {
  readonly id: VehicleModelId;
  readonly submeshCount: number;
}

/** Null when the VFS carries no `cleo/*.cs` — and then the frame loop pays nothing at all. */
export function setupEngineCleo(args: EngineCleoArgs): CleoRunnerSystem | null {
  const { adapter, config, engine, fs } = args;
  const models = new Map<string, BuiltModel | null>();

  const ensureModel = (modelName: string, txdName?: string): boolean => {
    const key = modelName.toLowerCase();
    const cached = models.get(key);
    if (cached !== undefined) {
      return cached !== null;
    }
    let built: BuiltModel | null = null;
    try {
      // OPTIMIZED first (the engine-props template — the phase-0 spike proved this exact path).
      const osm = fs.get(`${key}.osm`);
      if (osm) {
        const read = readModelOsm(modelName, new Uint8Array(osm));
        built = { id: engine.createVehicleModel(read.model), submeshCount: read.fixture.submeshes.length };
      } else {
        const clump = getClump(fs, modelName);
        const txds = txdName ? getTxdChain(fs, txdName) : [];
        const model = buildVehicleModel(clump, new VehicleTextures(txds));
        built = { id: engine.createVehicleModel(toRigidModelInit(model)), submeshCount: model.submeshes.length };
      }
    } catch (error) {
      built = null; // scripts poll HAS_MODEL_LOADED — an unbuildable model reads as never-loaded…
      // …but never SILENTLY (the anim-objects lesson: an invisible model without a name in the log
      // is undiagnosable in the field).
      // eslint-disable-next-line no-console
      console.warn(`[cleo] model '${modelName}' failed to build:`, error);
    }
    models.set(key, built);

    return built !== null;
  };

  const spawn = (modelName: string): CleoObjectInstance | null => {
    const built = models.get(modelName.toLowerCase());
    if (!built) {
      return null;
    }
    const instance: VehicleInstance = engine.createVehicle(built.id);

    return {
      destroy: (): void => engine.destroyVehicle(instance),
      setRoot: (root): void => instance.entity.setRoot(root),
      setVisible: (visible): void => {
        for (let submesh = 0; submesh < built.submeshCount; submesh += 1) {
          instance.setSubmeshVisible(submesh, visible);
        }
      },
    };
  };

  const host = createCleoEngineHost({
    cameraGta: args.cameraGta,
    ensureModel,
    flush: (): void => engine.updateVehicles(),
    hour: args.hour,
    playerGta: args.playerGta,
    print: showToast,
    resolveById: (id) => adapter.cleoModelById(id),
    resolveByName: (name) => adapter.cleoModelIdByName(name),
    ridingCar: args.ridingCar,
    spawn,
  });

  const runner = new ScriptRunner({ host });
  const readScript = (name: string): null | Uint8Array => {
    const bytes = fs.get(name);

    return bytes ? new Uint8Array(bytes) : null;
  };
  const spawned = discoverAndSpawn(fs.names, readScript, runner, config.cleo.maxScripts);
  if (spawned.length === 0) {
    return null;
  }
  // The boot census (the populations restriction): say what is about to run, before it runs.
  // eslint-disable-next-line no-console
  console.log(`[cleo] ${spawned.length} script(s): ${spawned.map((name) => name.slice('cleo/'.length)).join(', ')}`);

  return new CleoRunnerSystem(config, runner, host);
}

/** PRINT_STRING_NOW's surface: the HUD has no message lane yet, so this is a minimal DOM toast —
 *  recorded in the plan 04 ledger; a real HUD text lane can replace it without touching the host. */
function showToast(text: string, ms: number): void {
  let toast = document.getElementById('cleo-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'cleo-toast';
    toast.style.cssText =
      'position:fixed;left:50%;bottom:12%;transform:translateX(-50%);padding:6px 14px;' +
      'background:rgba(0,0,0,0.65);color:#f5eec9;font:16px monospace;border-radius:4px;' +
      'pointer-events:none;z-index:30;white-space:pre;';
    document.body.append(toast);
  }
  toast.textContent = text;
  toast.style.display = 'block';
  const shown = toast;
  window.clearTimeout(Number(shown.dataset.timer ?? 0));
  shown.dataset.timer = String(window.setTimeout(() => (shown.style.display = 'none'), Math.max(500, ms)));
}
