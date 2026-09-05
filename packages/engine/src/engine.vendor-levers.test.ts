import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CameraState } from './engine';
import type { FakeGpu } from './test/fake-device';

import { Engine } from './engine';
import { DEFAULT_RENDER_BUDGET } from './render/budget';
import { installFakeWebGpu } from './test/fake-device';

/**
 * The two vendor levers actually REACH THE FRAME (201/9, the Arm/Bjørge material in `docs/links.md`).
 *
 * **This file exists because of what the same chain found a day earlier.** `?ablate=probe` was priced at
 * 1.6 ms on a surface where the pass it removes had never run — a knob that reaches nothing produces an
 * ordinary capture with a believable number in it, and nothing complains
 * ([the null arm](../../../docs/benchmarks/opensa-engine/2026-09-05-mobile-ablation-null-arm.json)). A
 * budget field is exactly that shape of risk: it typechecks, it round-trips through the query parser, it
 * appears in the report, and it can still be read by nobody.
 *
 * So each lever is asserted at the only place that settles it — the passes the frame actually encoded, and
 * the shader module the pipelines were compiled from.
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

/** The downsample passes this frame encoded, by pipeline id — which kernel ran is a label, not an inference. */
function downsampleKernels(): Set<string> {
  return new Set(gpu.passes.map((pass) => pass.label).filter((label) => label.startsWith('bloom-down')));
}

beforeEach(() => {
  harness = installFakeWebGpu();
  gpu = harness.gpu;
});

afterEach(() => {
  harness.restore();
});

describe('the bloom downsample kernel', () => {
  describe('negative cases', () => {
    it('does not run Bjorge dual filtering unless a budget asks for it', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      engine.frame(camera());

      expect(downsampleKernels()).toEqual(new Set(['bloom-down']));
    });

    it('never mixes the two kernels inside one frame — a pyramid blurred two ways is neither', async () => {
      const engine = new Engine({ ...DEFAULT_RENDER_BUDGET, bloomDownsample: 'dual5' });
      await engine.init(harness.canvas);
      engine.frame(camera());

      expect(downsampleKernels().size).toBe(1);
    });
  });

  describe('positive cases', () => {
    it('runs every downsample level on the kernel the budget names', async () => {
      const engine = new Engine({ ...DEFAULT_RENDER_BUDGET, bloomDownsample: 'dual5' });
      await engine.init(harness.canvas);
      engine.frame(camera());

      expect(downsampleKernels()).toEqual(new Set(['bloom-down-dual']));
    });
  });
});

describe('the post chain precision', () => {
  describe('negative cases', () => {
    it('compiles the full-width shader when no budget asks for half', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);

      expect(gpu.shaderModules).toContain('bloom');
      expect(gpu.shaderModules).toContain('post');
      expect(gpu.shaderModules).not.toContain('bloom-f16');
      expect(gpu.shaderModules).not.toContain('post-f16');
    });

    it('compiles the full-width shader anyway on an adapter without shader-f16', async () => {
      // The refusal that has to be VISIBLE rather than silent: a surface asked for half width, the device
      // did not have it, and what actually ran is the full-width chain. `surface.postPrecision` in the
      // report reads the resolved budget for the same reason.
      const engine = new Engine({ ...DEFAULT_RENDER_BUDGET, postPrecision: 'f16' });
      await engine.init(harness.canvas);

      expect(gpu.shaderModules).not.toContain('bloom-f16');
      expect(gpu.shaderModules).toContain('bloom');
      expect(engine.budget.postPrecision).toBe('f32');
    });
  });

  describe('positive cases', () => {
    it('compiles BOTH chains from the half-width source where the adapter grants shader-f16', async () => {
      // The label is the module name, so this is the one assertion that distinguishes "the field was set"
      // from "the field changed which WGSL the device compiled".
      harness.restore();
      harness = installFakeWebGpu({ adapterFeatures: ['texture-compression-bc', 'shader-f16'] });
      gpu = harness.gpu;
      const engine = new Engine({ ...DEFAULT_RENDER_BUDGET, postPrecision: 'f16' });
      await engine.init(harness.canvas);

      expect(gpu.shaderModules).toContain('bloom-f16');
      expect(gpu.shaderModules).toContain('post-f16');
      expect(gpu.shaderModules).not.toContain('post');
    });
  });
});
