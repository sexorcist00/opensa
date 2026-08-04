import { describe, expect, it } from 'vitest';

import { probeWebGpuSupport } from './webgpu-gate';

/** Minimal GPU stand-in returning the given adapter (or throwing when `fail` is set). */
function fakeGpu(adapter: null | { features: Set<string> }, fail = false): Parameters<typeof probeWebGpuSupport>[0] {
  return {
    requestAdapter: (): Promise<GPUAdapter | null> => {
      if (fail) {
        return Promise.reject(new Error('adapter request failed'));
      }

      return Promise.resolve(adapter as GPUAdapter | null);
    },
  };
}

describe('probeWebGpuSupport', () => {
  describe('negative cases', () => {
    it('reports unsupported when navigator.gpu is absent', async () => {
      expect(await probeWebGpuSupport(undefined)).toBe(false);
      expect(await probeWebGpuSupport(null)).toBe(false);
    });

    it('reports unsupported when the adapter request returns null', async () => {
      expect(await probeWebGpuSupport(fakeGpu(null))).toBe(false);
    });

    it('reports unsupported when the adapter request throws', async () => {
      expect(await probeWebGpuSupport(fakeGpu(null, true))).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('reports supported for an adapter with BC texture compression', async () => {
      expect(await probeWebGpuSupport(fakeGpu({ features: new Set(['texture-compression-bc']) }))).toBe(true);
    });

    // The gate answers about the DEVICE only. A mobile adapter carries ASTC/ETC2 and no BC, and its browser
    // runs WebGPU fine — whether the world it is about to load is displayable is the manifest's question.
    it('reports supported for a mobile adapter without BC', async () => {
      expect(await probeWebGpuSupport(fakeGpu({ features: new Set(['texture-compression-astc']) }))).toBe(true);
    });
  });
});
