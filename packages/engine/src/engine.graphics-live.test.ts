import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CameraState } from './engine';
import type { FakeGpu } from './test/fake-device';

import { Engine } from './engine';
import { DEFAULT_RENDER_BUDGET } from './render/budget';
import { installFakeWebGpu } from './test/fake-device';

/**
 * The graphics rung an OPERATOR picks reaches the frame while the console is running (201/9-05).
 *
 * **The risk this file is against is the one this chain has already paid for twice.** A control can be
 * wired end to end, typecheck, round-trip through storage, appear in the report — and change nothing, because
 * something downstream is keyed on a narrower question than the change. That is how instancing shipped inert,
 * and it is exactly what `ensureTargets` did here until this step: its key was the target SIZE alone, so a
 * budget field could move and the frame would go on drawing into targets built from the old one.
 *
 * So both levers are asserted at the passes the frame actually encoded, not at the budget object.
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

/** Every bloom pass this frame encoded — the prefilter, the downs and the ups. */
function bloomPasses(): string[] {
  return gpu.passes.map((pass) => pass.label ?? '').filter((label) => label.startsWith('bloom-'));
}

beforeEach(() => {
  harness = installFakeWebGpu();
  gpu = harness.gpu;
});

afterEach(() => {
  harness.restore();
});

describe('the graphics rung, applied live', () => {
  describe('negative cases', () => {
    it('draws no bloom pass at all once the intensity is taken to zero', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      engine.frame(camera());
      expect(bloomPasses().length).toBeGreaterThan(0);

      engine.environment.bloomIntensity = 0;
      gpu.passes.length = 0;
      engine.frame(camera());

      expect(bloomPasses()).toEqual([]);
    });

    it('does not leave the chain off once the intensity comes back — the rung is reversible', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      engine.environment.bloomIntensity = 0;
      engine.frame(camera());

      engine.environment.bloomIntensity = 0.7;
      gpu.passes.length = 0;
      engine.frame(camera());

      expect(bloomPasses().length).toBeGreaterThan(0);
    });
  });

  describe('positive cases', () => {
    /**
     * The one that would have caught the inert version, and it asserts the REBUILD rather than the pass
     * count: the fake canvas is small enough that both scales land on the same number of levels, so a pass
     * count here would have passed on an engine that ignored the change entirely.
     */
    it('rebuilds the bloom chain when the prefilter scale changes under a running engine', async () => {
      const engine = new Engine({ ...DEFAULT_RENDER_BUDGET, bloomPrefilterScale: 0.5 });
      await engine.init(harness.canvas);
      engine.frame(camera());
      const before = gpu.destroyed.length;

      engine.budget = { ...engine.budget, bloomPrefilterScale: 1 };
      engine.frame(camera());

      expect(gpu.destroyed.slice(before)).toContain('bloom-prefilter');
    });

    it('rebuilds NOTHING while the rung holds — a key that thrashes is as wrong as one that sleeps', async () => {
      const engine = new Engine({ ...DEFAULT_RENDER_BUDGET, bloomPrefilterScale: 0.5 });
      await engine.init(harness.canvas);
      engine.frame(camera());
      const before = gpu.destroyed.length;

      engine.frame(camera());
      engine.frame(camera());

      expect(gpu.destroyed.slice(before)).toEqual([]);
    });
  });
});
