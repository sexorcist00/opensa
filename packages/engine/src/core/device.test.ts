import { afterEach, describe, expect, it } from 'vitest';

import { installFakeWebGpu } from '../test/fake-device';
import { configureCanvas, describeDevice, initDevice } from './device';

/**
 * The no-BC emulation gate (plan 200/1-03).
 *
 * A phone was unbootable until 2026-08-04 because `initDevice` listed `texture-compression-bc`
 * unconditionally, and `requestDevice` REJECTS a required feature the adapter does not carry. Nothing caught
 * that: the desktop it was written on has BC, so every test passed and every mobile GPU threw. The fake
 * adapter now rejects exactly the way a browser does, so reinstating the demand fails here instead of on
 * someone's phone.
 */

let installed: null | ReturnType<typeof installFakeWebGpu> = null;

function install(options: Parameters<typeof installFakeWebGpu>[0]): ReturnType<typeof installFakeWebGpu> {
  installed = installFakeWebGpu(options);

  return installed;
}

afterEach(() => {
  installed?.restore();
  installed = null;
});

describe('initDevice', () => {
  describe('negative cases', () => {
    it('boots on a MOBILE adapter, and never asks it for BC', async () => {
      const fake = install({ adapterFeatures: ['texture-compression-astc', 'texture-compression-etc2'] });

      const device = await initDevice();

      expect(fake.requestedFeatures).not.toContain('texture-compression-bc');
      expect(device.hasBc).toBe(false);
    });

    it('drops timestamp-query too when the adapter lacks it (the Mali row has no GPU timers)', async () => {
      const fake = install({ adapterFeatures: [], timestamps: false });

      const device = await initDevice();

      expect(fake.requestedFeatures).toEqual([]);
      expect(device.hasTimestamps).toBe(false);
    });

    it('fails with a specific message when the browser has no WebGPU at all', async () => {
      const fake = install({});
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {}, writable: true });

      await expect(initDevice()).rejects.toThrow(/WebGPU is not available/);
      expect(fake.requestedFeatures).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('takes BC and timestamps when the adapter offers them', async () => {
      const fake = install({});

      const device = await initDevice();

      expect(fake.requestedFeatures.sort()).toEqual(['texture-compression-bc', 'timestamp-query']);
      expect(device.hasBc).toBe(true);
      expect(device.hasTimestamps).toBe(true);
    });

    it('hands back a device carrying only what was granted', async () => {
      // Not a tautology: anything downstream that asks `device.features` (the `.ostex` upload rule does)
      // would otherwise be answered by the adapter's capability rather than the device's grant.
      install({ adapterFeatures: ['texture-compression-astc'], timestamps: false });

      const device = await initDevice();

      expect(device.device.features.has('texture-compression-bc')).toBe(false);
    });

    it('renders through the sRGB view of the swapchain format', async () => {
      install({});

      const device = await initDevice();

      expect(device.presentationFormat).toBe('bgra8unorm');
      expect(device.colorFormat).toBe('bgra8unorm-srgb');
    });
  });
});

/**
 * The host's pinned drawing buffer, which init used to overwrite (201/9-04).
 *
 * SILENT and expensive: the console pins `?surface=WxH` so an A/B's arms are the same number of pixels, and
 * `configureCanvas` re-derived both edges from the CSS box at init. The observer that maintains the buffer
 * only fires when the CSS box changes, so nothing ever put it back — the run measured the viewport's size
 * while its report said `pinned: true`, which is the un-subtractable circuit the pin exists to prevent.
 */
describe('configureCanvas', () => {
  describe('negative cases', () => {
    it('does NOT overwrite a drawing buffer the host pinned', async () => {
      const fake = install({});
      const engineDevice = await initDevice();
      fake.canvas.width = 720;
      fake.canvas.height = 640;

      configureCanvas(fake.canvas, engineDevice, 2, { height: 640, width: 720 });

      expect([fake.canvas.width, fake.canvas.height]).toEqual([720, 640]);
    });
  });

  describe('positive cases', () => {
    it('derives the buffer from the CSS box when the host pinned nothing', async () => {
      const fake = install({});
      const engineDevice = await initDevice();

      configureCanvas(fake.canvas, engineDevice, 2, null);

      expect([fake.canvas.width, fake.canvas.height]).toEqual([1440, 900]);
    });
  });
});

describe('describeDevice', () => {
  describe('negative cases', () => {
    it('names what a MOBILE adapter lacks, which is what decides the row schema', async () => {
      install({ adapterFeatures: ['texture-compression-astc', 'texture-compression-etc2'], timestamps: false });
      const engineDevice = await initDevice();

      const report = describeDevice(engineDevice, { clientHeight: 800, clientWidth: 360 }, 2);

      expect(report.missing).toEqual(['texture-compression-bc', 'timestamp-query']);
      expect(report.featureLevel).toBe('compatibility');
      expect(report.css).toBe('360x800');
      expect(report.dpr).toBe(2);
    });
  });

  describe('positive cases', () => {
    it('reports a core adapter with nothing missing', async () => {
      install({
        adapterFeatures: [
          'core-features-and-limits',
          'texture-compression-astc',
          'texture-compression-bc',
          'texture-compression-etc2',
        ],
      });
      const engineDevice = await initDevice();

      const report = describeDevice(engineDevice, { clientHeight: 900, clientWidth: 1440 }, 2);

      expect(report.missing).toEqual([]);
      expect(report.featureLevel).toBe('core');
      expect(report.features).toContain('timestamp-query');
    });
  });
});
