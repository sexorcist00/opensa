import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { decodeDxt } from '@opensa/renderware/textures/dxt';
/**
 * Cloud-dome extraction step (plan 074/06 row 15): reads a RealSkybox-layout mod dir
 * (`realskybox/skyboxes.dat` weather map + `skyboxes.txd` panoramas) and emits per-weather RGBA8 dome
 * textures + the manifest `clouds` section. LICENSE: the source textures are permission-PENDING
 * (docs/licenses/realskybox-clouds.md) — outputs stay in user-local pak dirs, never in distributed builds.
 *
 * The engine samples these with its analytic azimuthal dome mapping in `fsSky` (measured off the mod's
 * sphere mesh: uv = 0.5 ∓ dir_horiz·k·θ, k ≈ 0.297/rad, mirrored below the horizon) — the DFF mesh and the
 * ASI are not used.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resampleToPow2 } from './alpha';

/** Manifest section: weather id (SA 0..19) → texture key; each texture = a loose RGBA file by the pak. */
export interface CloudsManifest {
  textures: Record<string, { file: string; height: number; width: number }>;
  weathers: Record<string, string>;
}

/** Downscale target — 2048² RGBA sources are 16 MB each; clouds are soft, 1024² reads identically. */
const CLOUD_SIZE = 1024;

export function convertClouds(
  datText: string,
  txdBytes: ArrayBuffer,
  outDir: string,
  log: (message: string) => void = () => undefined,
): CloudsManifest {
  const weathers: Record<string, string> = {};
  for (const line of datText.split('\n')) {
    const match = /^\s*(\d+)\s*,\s*(\w+)/.exec(line);
    if (match) {
      weathers[match[1]] = match[2].toLowerCase();
    }
  }

  const wanted = new Set(Object.values(weathers));
  wanted.delete('stars'); // our stars are procedural (074/06 row 16)
  const textures: CloudsManifest['textures'] = {};
  for (const texture of parseTxd(txdBytes).textures) {
    const name = texture.name.toLowerCase();
    if (!wanted.has(name)) {
      continue;
    }
    const base = texture.mipmaps[0];
    const rgba =
      texture.format === 'rgba8888'
        ? new Uint8Array(base.data)
        : decodeDxt(texture.format, base.data, base.width, base.height);
    // Full-overcast domes (RealSkybox 'cloudy') ship with a ZEROED alpha channel — the mod renders them
    // opaque. An all-zero alpha would make the layer invisible, so restore the opaque intent.
    let alphaMax = 0;
    for (let index = 3; index < rgba.length; index += 4) {
      alphaMax = Math.max(alphaMax, rgba[index]);
    }
    if (alphaMax === 0) {
      for (let index = 3; index < rgba.length; index += 4) {
        rgba[index] = 255;
      }
      log(`clouds: ${name} has an empty alpha channel — treating as an opaque overcast dome`);
    }
    const sized = downscale(resampleToPow2(rgba, base.width, base.height), CLOUD_SIZE);
    const file = `clouds-${name}.rgba`;
    writeFileSync(join(outDir, file), sized.rgba);
    textures[name] = { file, height: sized.height, width: sized.width };
  }

  const missing = [...wanted].filter((name) => !textures[name]);
  if (missing.length > 0) {
    log(`clouds: ${missing.length} mapped textures missing from the TXD (${missing.join(', ')})`);
  }
  log(
    `clouds: ${Object.keys(textures).length} dome textures @${CLOUD_SIZE}² → manifest weathers ${Object.keys(weathers).length}`,
  );

  return { textures, weathers };
}

/** Halve until ≤ target (box filter — soft clouds lose nothing). */
function downscale(
  source: { height: number; rgba: Uint8Array; width: number },
  target: number,
): { height: number; rgba: Uint8Array; width: number } {
  let { height, rgba, width } = source;
  while (width > target || height > target) {
    const outWidth = Math.max(1, width >> 1);
    const outHeight = Math.max(1, height >> 1);
    const out = new Uint8Array(outWidth * outHeight * 4);
    for (let y = 0; y < outHeight; y += 1) {
      for (let x = 0; x < outWidth; x += 1) {
        for (let channel = 0; channel < 4; channel += 1) {
          const a = rgba[(y * 2 * width + x * 2) * 4 + channel];
          const b = rgba[(y * 2 * width + Math.min(width - 1, x * 2 + 1)) * 4 + channel];
          const c = rgba[(Math.min(height - 1, y * 2 + 1) * width + x * 2) * 4 + channel];
          const d = rgba[(Math.min(height - 1, y * 2 + 1) * width + Math.min(width - 1, x * 2 + 1)) * 4 + channel];
          out[(y * outWidth + x) * 4 + channel] = (a + b + c + d + 2) >> 2;
        }
      }
    }
    rgba = out;
    width = outWidth;
    height = outHeight;
  }

  return { height, rgba, width };
}
