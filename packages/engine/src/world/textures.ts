/**
 * Texture-array store (plan 074/01 world module): one `.ostex` blob → one `texture_2d_array` + its material
 * bind group. The upload itself lives in `core/ostex-upload` (per-model dictionaries share it); this class
 * owns the world's ref keying, material bind group and residency.
 * The CPU payload is released after upload (JS holds handles — the 073 memory lesson).
 */
import type { Resources } from '../core/resources';

import { uploadOstexTexture } from '../core/ostex-upload';

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
    const { byteEstimate, layers, texture } = uploadOstexTexture(this.device, this.resources, bytes, `array-${ref}`);
    const bindGroup = this.device.createBindGroup({
      entries: [
        { binding: 0, resource: texture.createView({ dimension: '2d-array' }) },
        { binding: 1, resource: this.sampler },
      ],
      label: `material-${ref}`,
      layout: this.materialLayout,
    });
    const handle: TextureArrayHandle = { bindGroup, byteEstimate, layers, texture };
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
