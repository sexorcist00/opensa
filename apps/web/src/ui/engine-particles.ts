/**
 * 2dfx particles on the own engine (074/06 row 13, B6) — the `?engine=opensa` twin of canvas-host's FX
 * block. The pak carries the emitter ANCHORS (welded per cell by the converter); this module owns the
 * LIBRARY: `effects.fxp` systems and `effectsPC.txd` sprites, baked through the shared
 * `@opensa/renderware/fx/bake-fx` — the same arithmetic the three path runs, not a second copy of it.
 *
 * Both files are absent-tolerant: no library, no particles, and the map still streams.
 */
import type { CoronaSprites, DynamicParticleLibrary, Engine, ParticleUpload } from '@opensa/engine';
import type { FxBakedEmitter, FxPlacement, FxSystem } from '@opensa/renderware';
import type { AssetFileSystem } from '@opensa/renderware';

import {
  bakeFxInstances,
  bakeFxSystem,
  FX_SYSTEM_STRIDE,
  normalizeSpriteAlpha,
  parseFxp,
  sampleFxParticle,
  writeFxSystemRecord,
} from '@opensa/renderware';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { decodeDxt } from '@opensa/renderware/textures/dxt';

/** Atlas side used only when NO sprite resolves (every emitter's texture missing) — the procedural dot. */
const FALLBACK_ATLAS_SIZE = 64;
/** Config draw distance for emitters (world units) — beyond this the vertex shader collapses the quad. */
const DRAW_DISTANCE = 300;

/**
 * Systems preloaded into the DYNAMIC one-shot lane (089/01) — lowercased, as `parseFxp` keys them. The
 * lane's atlas and system records are built ONCE at boot, so an effect must be listed here before a
 * runtime emitter can spawn it. Extend as effects ship: tyre smoke (089/02), impact smoke (089/04).
 */
const DYNAMIC_SYSTEMS = ['prt_collisionsmoke', 'prt_smokeii_3_expand'];

/** A runtime spawner over one preloaded system: park it somewhere, burst it or stream it, step it. */
export interface DynamicFxEmitter {
  /** Per-spawn opacity multiplier over the authored alpha envelope (089/02 round 2): SA's envelopes assume
   *  its own sparse spawns, and per-step bursts stack — callers scale the look with how hard the event is. */
  alphaScale: number;
  /** Spawn `count` particles NOW from every layer — the shape SA's code-triggered `prt_*` systems use
   *  (no authored rate; the caller decides per call, e.g. per fixed step from slip). */
  burst(count: number): void;
  /** Multiplier over the authored particle life for the NEXT spawns — a gentle slide's smoke wisps away,
   *  a burnout's lingers (089/02). The per-particle life field is the one free per-spawn look knob. */
  lifeScale: number;
  /** World position (engine space) the next spawns come from — mutate freely, particles keep flying. */
  readonly position: [number, number, number];
  /** Multiplier over the authored emission rate; 0 stops the stream (live particles finish their life).
   *  Layers with NO authored rate (code-triggered) ignore this and respond to `burst` only. */
  rate: number;
  /** Advance on the FIXED step: accumulates rate × dt and spawns whole particles into the engine pool. */
  update(dt: number): void;
}

export interface EngineParticles {
  /** A dynamic emitter for one preloaded system (089/01) — null when this profile does not ship it. */
  createEmitter(name: string): DynamicFxEmitter | null;
  /** Rebuild the GPU buffers from the currently STREAMED cells. Cheap and rare — call on a cell-set change. */
  rebuild(): void;
}

interface Sprite {
  height: number;
  rgba: Uint8Array;
  width: number;
}

/**
 * The SA corona billboards from `particle.txd` (B6): `coronastar` for lamps and headlights, `coronamoon` for
 * the moon. Layers are packed at the LARGEST of the two sizes — nothing here is pinned to 64², so dropping in
 * a higher-resolution moon just works. Returns undefined when the profile ships no particle.txd; the engine
 * then falls back to its procedural glow.
 */
export function loadCoronaSprites(fs: AssetFileSystem): CoronaSprites | undefined {
  const bytes = fs.get('models/particle.txd');
  if (!bytes) {
    return undefined;
  }
  const sprites = decodeSprites(bytes);
  const star = sprites.get('coronastar');
  const moon = sprites.get('coronamoon');
  if (!star || !moon) {
    return undefined;
  }
  const width = Math.max(star.width, moon.width);
  const height = Math.max(star.height, moon.height);
  const rgba = new Uint8Array(width * height * 4 * 2);
  rgba.set(resampleTo(star, width, height), 0);
  rgba.set(resampleTo(moon, width, height), width * height * 4);

  return { height, layers: 2, rgba, width };
}

export function setupEngineParticles(engine: Engine, fs: AssetFileSystem): EngineParticles | null {
  const fxpText = fs.getText('models/effects.fxp');
  const txdBytes = fs.get('models/effectspc.txd') ?? fs.get('models/effectsPC.txd');
  if (!fxpText || !txdBytes) {
    return null; // no library shipped with this profile — the map simply renders without particles
  }
  const systems = parseFxp(fxpText);
  const sprites = decodeSprites(txdBytes);
  const dynamic = buildDynamicLibrary(systems, sprites);
  engine.initDynamicParticles(dynamic.library);

  let signature = '';

  return {
    createEmitter(name: string): DynamicFxEmitter | null {
      const entries = dynamic.index.get(name.toLowerCase());
      if (!entries) {
        return null;
      }
      const accumulators = new Float64Array(entries.length);
      const scratch = new Float32Array(4); // vx, vy, vz, life — reused, no allocation per particle
      const spawnOne = (entry: (typeof entries)[number], position: readonly [number, number, number]): void => {
        sampleFxParticle(entry.baked, Math.random, scratch, 0);
        engine.spawnParticle(
          entry.systemIndex,
          position[0],
          position[1],
          position[2],
          scratch[0],
          scratch[1],
          scratch[2],
          scratch[3] * emitter.lifeScale,
          emitter.alphaScale,
        );
      };
      const emitter: DynamicFxEmitter = {
        alphaScale: 1,
        burst(count: number): void {
          for (const entry of entries) {
            for (let index = 0; index < count; index += 1) {
              spawnOne(entry, emitter.position);
            }
          }
        },
        lifeScale: 1,
        position: [0, 0, 0],
        rate: 1,
        update(dt: number): void {
          entries.forEach((entry, at) => {
            accumulators[at] += entry.baked.rate * emitter.rate * dt;
            while (accumulators[at] >= 1) {
              accumulators[at] -= 1;
              spawnOne(entry, emitter.position);
            }
          });
        },
      };

      return emitter;
    },
    rebuild(): void {
      // The cell set changes only when streaming crosses a ring, so a signature check keeps this off the
      // per-frame path entirely.
      const cells = [...engine.cells.all()].filter((cell) => cell.particles.length > 0);
      const next = cells.map((cell) => cell.key).join('|');
      if (next === signature) {
        return;
      }
      signature = next;

      const placements = new Map<string, FxPlacement[]>();
      for (const cell of cells) {
        for (const particle of cell.particles) {
          const list = placements.get(particle.effectName) ?? [];
          list.push({ effectName: particle.effectName, position: [particle.x, particle.y, particle.z] });
          placements.set(particle.effectName, list);
        }
      }
      engine.setParticles(buildUpload(systems, sprites, placements));
    },
  };
}

/**
 * The FX tracks are authored in GTA space (Z up); the engine works in Y up. The converter already puts the
 * emitter POSITIONS through that basis change — the direction and the force must follow, or a fountain
 * sprays sideways and smoke crawls along the ground. e = (x, z, -y), the same change the cell vertices take.
 */
export function toEngineSpace(emitter: FxBakedEmitter): FxBakedEmitter {
  const swap = (v: readonly [number, number, number]): [number, number, number] => [v[0], v[2], -v[1]];

  return {
    ...emitter,
    cone: { angle: emitter.cone.angle, direction: swap(emitter.cone.direction) },
    force: swap(emitter.force),
  };
}

/**
 * Bake the DYNAMIC lane's library (089/01): system records + atlas for the preloaded systems, plus a
 * name → baked-emitters index runtime emitters spawn through. Built once at boot — the lane's atlas
 * cannot grow later, which is why `DYNAMIC_SYSTEMS` is a boot-time list.
 */
function buildDynamicLibrary(
  systems: Map<string, FxSystem>,
  sprites: Map<string, Sprite>,
): { index: Map<string, { baked: FxBakedEmitter; systemIndex: number }[]>; library: DynamicParticleLibrary } {
  const baked: FxBakedEmitter[] = [];
  const index = new Map<string, { baked: FxBakedEmitter; systemIndex: number }[]>();
  for (const name of DYNAMIC_SYSTEMS) {
    const system = systems.get(name);
    if (!system) {
      continue; // this profile does not ship the system — createEmitter(name) then returns null
    }
    const entries: { baked: FxBakedEmitter; systemIndex: number }[] = [];
    // includeTriggered: the prt_* family carries NO emrate track — the runtime caller owns the count.
    for (const emitter of bakeFxSystem(system, { includeTriggered: true })) {
      const engineEmitter = toEngineSpace(emitter);
      entries.push({ baked: engineEmitter, systemIndex: baked.length });
      baked.push(engineEmitter);
    }
    if (entries.length > 0) {
      index.set(name, entries);
    }
  }

  const additive: boolean[] = [];
  const layers: string[] = [];
  const records = new Float32Array(baked.length * FX_SYSTEM_STRIDE);
  baked.forEach((emitter, at) => {
    let layer = layers.indexOf(emitter.texture);
    if (layer < 0) {
      layers.push(emitter.texture);
      layer = layers.length - 1;
    }
    writeFxSystemRecord(records, at, emitter, layer, DRAW_DISTANCE);
    additive.push(emitter.additive);
  });

  return { index, library: { additive, atlas: packAtlas(layers, sprites), systems: records } };
}

/** Assemble the systems, the instances and the sprite array actually used by the loaded cells. */
function buildUpload(
  systems: Map<string, FxSystem>,
  sprites: Map<string, Sprite>,
  placements: Map<string, FxPlacement[]>,
): ParticleUpload {
  const baked: { emitter: FxBakedEmitter; placed: FxPlacement[] }[] = [];
  for (const [name, placed] of placements) {
    const system = systems.get(name);
    if (!system) {
      continue; // an emitter naming a system this profile does not ship
    }
    for (const emitter of bakeFxSystem(system)) {
      baked.push({ emitter: toEngineSpace(emitter), placed });
    }
  }

  const layers: string[] = [];
  const records = new Float32Array(baked.length * FX_SYSTEM_STRIDE);
  const add: Float32Array[] = [];
  const blend: Float32Array[] = [];
  baked.forEach(({ emitter, placed }, index) => {
    let layer = layers.indexOf(emitter.texture);
    if (layer < 0) {
      layers.push(emitter.texture);
      layer = layers.length - 1;
    }
    writeFxSystemRecord(records, index, emitter, layer, DRAW_DISTANCE);
    const instances = bakeFxInstances(emitter, placed, index);
    (emitter.additive ? add : blend).push(instances);
  });

  return {
    atlas: packAtlas(layers, sprites),
    instancesAdd: concat(add),
    instancesBlend: concat(blend),
    systems: records,
  };
}

function concat(chunks: readonly Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }

  return out;
}

function decodeSprites(bytes: ArrayBuffer): Map<string, Sprite> {
  const sprites = new Map<string, Sprite>();
  for (const texture of parseTxd(bytes).textures) {
    const base = texture.mipmaps[0];
    const rgba =
      texture.format === 'rgba8888'
        ? new Uint8Array(base.data)
        : decodeDxt(texture.format, base.data, base.width, base.height);
    normalizeSpriteAlpha(rgba);
    sprites.set(texture.name.toLowerCase(), { height: base.height, rgba, width: base.width });
  }

  return sprites;
}

/**
 * One texture array over every sprite the loaded emitters use; missing sprites become a soft white dot.
 *
 * A WebGPU texture array forces ONE size on every layer, so the size is the LARGEST source sprite rather than
 * a constant: swapping in higher-resolution FX sprites is picked up, and the stock 128 px ones stop being
 * needlessly downsampled to 64. Nothing here is pinned to a resolution.
 */
function packAtlas(layers: readonly string[], sprites: Map<string, Sprite>): ParticleUpload['atlas'] {
  const used = layers.map((name) => sprites.get(name.toLowerCase())).filter((sprite): sprite is Sprite => !!sprite);
  const width = Math.max(FALLBACK_ATLAS_SIZE, ...used.map((sprite) => sprite.width));
  const height = Math.max(FALLBACK_ATLAS_SIZE, ...used.map((sprite) => sprite.height));
  const count = Math.max(1, layers.length);
  const stride = width * height * 4;
  const rgba = new Uint8Array(count * stride);
  layers.forEach((name, layer) => {
    const sprite = sprites.get(name.toLowerCase());
    rgba.set(sprite ? resampleTo(sprite, width, height) : softDot(width, height), layer * stride);
  });
  if (layers.length === 0) {
    rgba.set(softDot(width, height), 0);
  }

  return { height, layers: count, rgba, width };
}

function resampleTo(sprite: Sprite, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(sprite.height - 1, Math.floor((y / height) * sprite.height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(sprite.width - 1, Math.floor((x / width) * sprite.width));
      const from = (sy * sprite.width + sx) * 4;
      const to = (y * width + x) * 4;
      out[to] = sprite.rgba[from];
      out[to + 1] = sprite.rgba[from + 1];
      out[to + 2] = sprite.rgba[from + 2];
      out[to + 3] = sprite.rgba[from + 3];
    }
  }

  return out;
}

/** Fallback sprite: a soft round dot, so an emitter with a missing texture still reads as a puff. */
function softDot(width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const centreX = (width - 1) / 2;
  const centreY = (height - 1) / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const r = Math.hypot((x - centreX) / centreX, (y - centreY) / centreY);
      const alpha = Math.max(0, 1 - r) ** 2;
      const at = (y * width + x) * 4;
      out[at] = 255;
      out[at + 1] = 255;
      out[at + 2] = 255;
      out[at + 3] = Math.round(alpha * 255);
    }
  }

  return out;
}
