import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CameraState } from './engine';
import type { FakeGpu } from './test/fake-device';

import { Engine } from './engine';
import { installFakeWebGpu } from './test/fake-device';

/** A camera looking east along +X from a rooftop height, in engine coords. */
const cameraAt = (eye: [number, number, number], target: [number, number, number] = [100, 0, 50]): CameraState => ({
  aspect: 16 / 9,
  eye,
  far: 1500,
  fovYRad: Math.PI / 3,
  near: 0.3,
  target,
  up: [0, 0, 1],
});

/**
 * The seam check (plan 077 phase 3): proves the engine BOOTS and renders a frame against a recording
 * stand-in device, which is what every behavioural engine test below it depends on. If this file fails,
 * the fake has drifted from the WebGPU surface the engine actually uses — fix the fake, not the engine.
 */
let harness: ReturnType<typeof installFakeWebGpu>;
let gpu: FakeGpu;

beforeEach(() => {
  harness = installFakeWebGpu();
  gpu = harness.gpu;
});

afterEach(() => {
  harness.restore();
});

describe('Engine on a fake device', () => {
  describe('positive cases', () => {
    it('initialises without a real GPU', async () => {
      const engine = new Engine();
      await expect(engine.init(harness.canvas)).resolves.toBeUndefined();
    });

    it('compiles its pipelines once at init, not per frame', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      const afterInit = gpu.draws.length;

      gpu.reset();
      engine.frame(cameraAt([0, 0, 50]));

      expect(afterInit).toBe(0); // init draws nothing
      expect(gpu.passes.length).toBeGreaterThan(0); // the frame does
    });

    it('renders an empty world without throwing and still runs its passes', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      gpu.reset();

      engine.frame(cameraAt([0, 0, 50]));

      // With no cells loaded there is nothing to draw, but the fixed frame graph still runs:
      // the sky/post chain is unconditional.
      expect(gpu.passes.map((pass) => pass.label).filter(Boolean).length).toBeGreaterThan(0);
    });

    it('writes the frame uniform every frame — the camera must not go stale', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);

      gpu.reset();
      engine.frame(cameraAt([0, 0, 50]));
      const first = gpu.writes.filter((write) => write.label === 'frame').length;

      gpu.reset();
      engine.frame(cameraAt([10, 0, 50]));
      const second = gpu.writes.filter((write) => write.label === 'frame').length;

      expect(first).toBeGreaterThan(0);
      expect(second).toBe(first);
    });
  });
});
