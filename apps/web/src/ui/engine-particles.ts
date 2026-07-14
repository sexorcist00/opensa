/**
 * 2dfx particles on the own engine (074/06 row 13, B6) — the `?engine=opensa` twin of canvas-host's FX
 * block. The pak carries the emitter ANCHORS (welded per cell by the converter); this module owns the
 * LIBRARY: `effects.fxp` systems and `effectsPC.txd` sprites, baked through the shared
 * `@opensa/renderware/fx/bake-fx` — the same arithmetic the three path runs, not a second copy of it.
 *
 * Both files are absent-tolerant: no library, no particles, and the map still streams.
 */
import type { CoronaSprites, Engine, ParticleUpload } from '@opensa/engine';
import type { FxBakedEmitter, FxPlacement, FxSystem } from '@opensa/renderware';
import type { AssetFileSystem } from '@opensa/renderware';

import {
  bakeFxInstances,
  bakeFxSystem,
  FX_SYSTEM_STRIDE,
  normalizeSpriteAlpha,
  parseFxp,
  writeFxSystemRecord,
} from '@opensa/renderware';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { decodeDxt } from '@opensa/renderware/textures/dxt';

/** Atlas side used only when NO sprite resolves (every emitter's texture missing) — the procedural dot. */
const FALLBACK_ATLAS_SIZE = 64;
/** Config draw distance for emitters (world units) — beyond this the vertex shader collapses the quad. */
const DRAW_DISTANCE = 300;

export interface EngineParticles {
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

  let signature = '';

  return {
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
