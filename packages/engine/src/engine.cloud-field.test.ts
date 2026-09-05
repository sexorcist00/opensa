import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CameraState } from './engine';
import type { FakeGpu } from './test/fake-device';

import { Engine } from './engine';
import { installFakeWebGpu } from './test/fake-device';

/**
 * The cumulus bake runs when the field has MOVED, not when a frame happens (201/9-06).
 *
 * The ablation sweep priced this pass at 1.8 ms of a 23.4 ms frame on the 2/03 phone
 * ([the row](../../../docs/benchmarks/opensa-engine/2026-09-05-mobile-map-ablation-sweep.json)) — for a
 * 256² field that scrolls one texel every ~4.7 s. What is asserted here is the rule rather than a rate: a
 * run of frames bakes ONCE, and a weather change invalidates however recent the last bake was.
 */

let harness: ReturnType<typeof installFakeWebGpu>;
let gpu: FakeGpu;

const camera = (): CameraState => ({
  aspect: 16 / 9,
  eye: [0, 0, 30],
  far: 1500,
  fovYRad: Math.PI / 3,
  near: 0.3,
  target: [100, 0, 30],
  up: [0, 0, 1],
});

/** How many `cloud-field` passes the recorder has seen since it was installed. */
function bakes(): number {
  return gpu.passes.filter((pass) => pass.label === 'cloud-field').length;
}

beforeEach(() => {
  harness = installFakeWebGpu();
  gpu = harness.gpu;
});

afterEach(() => {
  harness.restore();
});

describe('the cumulus field bake', () => {
  describe('negative cases', () => {
    it('does not re-bake a field that has not moved a texel — a run of frames is ONE bake', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      for (let frame = 0; frame < 30; frame += 1) {
        engine.frame(camera());
      }

      expect(bakes()).toBe(1);
    });
  });

  describe('positive cases', () => {
    it('bakes on the first frame, because there is nothing in the texture yet', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      engine.frame(camera());

      expect(bakes()).toBe(1);
    });

    it('re-bakes when the weather changes the clump scale, however recent the last bake was', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      engine.frame(camera());
      const before = bakes();
      engine.environment.cloudScale *= 1.5;
      engine.frame(camera());

      expect(bakes()).toBe(before + 1);
    });
  });
});
