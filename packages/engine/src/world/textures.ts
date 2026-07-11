/**
 * Texture-array store (plan 074/01 world module): one `.ostex` blob → one `texture_2d_array` + its material
 * bind group. Upload is verbatim `writeTexture` per (layer, mip) — the format IS the GPU layout (074/02).
 * The CPU payload is released after upload (JS holds handles — the 073 memory lesson).
 */
import { decodeOstex, OstexFormat, type OstexFormatId, ostexMipLayout } from '@opensa/engine-formats';

import type { Resources } from '../core/resources';

const GPU_FORMAT: Record<OstexFormatId, GPUTextureFormat> = {
  [OstexFormat.BC1]: 'bc1-rgba-unorm-srgb',
  [OstexFormat.BC2]: 'bc2-rgba-unorm-srgb',
  [OstexFormat.BC3]: 'bc3-rgba-unorm-srgb',
  [OstexFormat.BC7]: 'bc7-rgba-unorm-srgb',
  [OstexFormat.RGBA8]: 'rgba8unorm-srgb',
};

export interface TextureArrayHandle {
  bindGroup: GPUBindGroup;
  byteEstimate: number;
  layers: number;
  texture: GPUTexture;
}

export class TextureArrays {
  private readonly arrays = new Map<number, TextureArrayHandle>();
  private readonly device: GPUDevice;
  private readonly materialLayout: GPUBindGroupLayout;
  private readonly resources: Resources;
  private readonly sampler: GPUSampler;

  constructor(device: GPUDevice, resources: Resources, materialLayout: GPUBindGroupLayout) {
    this.device = device;
    this.resources = resources;
    this.materialLayout = materialLayout;
    this.sampler = device.createSampler({
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    });
  }

  get(ref: number): TextureArrayHandle {
    const handle = this.arrays.get(ref);
    if (!handle) {
      throw new Error(`texture array ${ref} not loaded (cells must load after their arrays)`);
    }

    return handle;
  }

  has(ref: number): boolean {
    return this.arrays.has(ref);
  }

  /** Decode + upload one `.ostex`; idempotent per ref. Returns the handle. */
  load(ref: number, bytes: Uint8Array): TextureArrayHandle {
    const existing = this.arrays.get(ref);
    if (existing) {
      return existing;
    }
    const tex = decodeOstex(bytes);
    const byteEstimate = tex.payload.byteLength;
    const texture = this.resources.createTexture(
      'texture',
      {
        dimension: '2d',
        format: GPU_FORMAT[tex.format],
        label: `array-${ref}`,
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
        this.device.queue.writeTexture(
          { mipLevel: level, origin: { x: 0, y: 0, z: layer }, texture },
          tex.payload.subarray(offset, offset + layout.totalBytes),
          { bytesPerRow: layout.bytesPerRow, rowsPerImage: layout.rows },
          { depthOrArrayLayers: 1, height: layout.mipHeight, width: layout.mipWidth },
        );
        offset += layout.totalBytes;
      }
    }
    const bindGroup = this.device.createBindGroup({
      entries: [
        { binding: 0, resource: texture.createView({ dimension: '2d-array' }) },
        { binding: 1, resource: this.sampler },
      ],
      label: `material-${ref}`,
      layout: this.materialLayout,
    });
    const handle: TextureArrayHandle = { bindGroup, byteEstimate, layers: tex.layers.length, texture };
    this.arrays.set(ref, handle);

    return handle;
  }

  unload(ref: number): void {
    const handle = this.arrays.get(ref);
    if (!handle) {
      return;
    }
    this.arrays.delete(ref);
    this.resources.destroyTexture('texture', handle.texture, handle.byteEstimate);
  }
}
