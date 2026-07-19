/**
 * `.ostex` bytes → a GPU `texture_2d_array`, uploaded VERBATIM (opensa-pack 003 phase 3).
 *
 * The format IS the GPU layout (074/02): BC1/BC3 payloads are written compressed and STAY compressed in
 * video memory — nothing decodes them, on the CPU or otherwise. That is the whole point of the per-model
 * `.ostex`, so this path must never grow an "expand to RGBA8" branch.
 *
 * Extracted from the world's `TextureArrays.load` when per-MODEL dictionaries (vehicles, then peds and map
 * objects) started arriving as `.ostex` too — world arrays and model arrays differ only in the bind group
 * built on top, which is why that stays with each caller.
 */
import { decodeOstex, OstexFormat, type OstexFormatId, ostexMipLayout } from '@opensa/engine-formats';

import type { Resources } from './resources';

const GPU_FORMAT: Record<OstexFormatId, GPUTextureFormat> = {
  [OstexFormat.BC1]: 'bc1-rgba-unorm-srgb',
  [OstexFormat.BC2]: 'bc2-rgba-unorm-srgb',
  [OstexFormat.BC3]: 'bc3-rgba-unorm-srgb',
  [OstexFormat.BC7]: 'bc7-rgba-unorm-srgb',
  [OstexFormat.RGBA8]: 'rgba8unorm-srgb',
};

export interface OstexUpload {
  /** Payload size — what the texture costs, tracked by the resource budget. */
  byteEstimate: number;
  layers: number;
  texture: GPUTexture;
}

/** Decode `bytes` and upload every (layer, mip) as-is. The caller owns the bind group. */
export function uploadOstexTexture(
  device: GPUDevice,
  resources: Resources,
  bytes: Uint8Array,
  label: string,
): OstexUpload {
  const tex = decodeOstex(bytes);
  const byteEstimate = tex.payload.byteLength;
  const texture = resources.createTexture(
    'texture',
    {
      dimension: '2d',
      format: GPU_FORMAT[tex.format],
      label,
      mipLevelCount: tex.mipCount,
      size: { depthOrArrayLayers: tex.layers.length, height: tex.height, width: tex.width },
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    },
    byteEstimate,
  );

  let offset = 0;
  for (let layer = 0; layer < tex.layers.length; layer += 1) {
    for (let level = 0; level < tex.mipCount; level += 1) {
      const layout = ostexMipLayout(tex.format, tex.width, tex.height, level);
      device.queue.writeTexture(
        { mipLevel: level, origin: { x: 0, y: 0, z: layer }, texture },
        tex.payload.subarray(offset, offset + layout.totalBytes),
        { bytesPerRow: layout.bytesPerRow, rowsPerImage: layout.rows },
        { depthOrArrayLayers: 1, height: layout.mipHeight, width: layout.mipWidth },
      );
      offset += layout.totalBytes;
    }
  }

  return { byteEstimate, layers: tex.layers.length, texture };
}
