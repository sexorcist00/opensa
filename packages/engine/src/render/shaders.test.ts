import { describe, expect, it } from 'vitest';

import { pipelineIdFor } from './pipelines';
import { assertGuardrails, resolveShader, shaderModuleNames } from './shaders';

describe('shader store', () => {
  describe('negative cases', () => {
    it('rejects an unknown module', () => {
      expect(() => resolveShader('nope')).toThrow(/unknown shader module/);
    });

    it('guardrail bans uniform-space arrays (the 073 naga/Metal occupancy trap)', () => {
      const banned = 'struct P { l: array<vec4f, 12> };\n@group(0) @binding(0) var<uniform> pool: array<vec4f, 12>;';

      expect(() => assertGuardrails('test', banned)).toThrow(/uniform-space array/);
    });

    it('guardrail bans unbounded loops', () => {
      expect(() => assertGuardrails('test', 'fn f() { loop { } }')).toThrow(/unbounded loop/);
    });
  });

  describe('positive cases', () => {
    it('resolves the world shader with its includes expanded and guardrails clean', () => {
      const wgsl = resolveShader('world');

      expect(wgsl).toContain('fn vsWorld');
      expect(wgsl).toContain('fn fsWorld');
      expect(wgsl).toContain('var<uniform> frame: Frame'); // the include landed
      expect(wgsl).not.toContain('#include');
    });

    it('golden snapshot per module (shader diffs become reviewable)', () => {
      for (const name of shaderModuleNames()) {
        expect(resolveShader(name)).toMatchSnapshot(name);
      }
    });

    it('keeps each precision variant a WRAPPER rather than a second copy of the shader', () => {
      // 201/9, Arm's mediump guidance: `bloom-f16` and `post-f16` exist to give the colour maths half
      // width, and the danger of a variant is that it drifts from the source it was cloned off. It cannot
      // drift here, because it is not a clone: both wrappers are three alias lines over ONE included body,
      // and this asserts that the resolved sources differ by exactly those lines and nothing else.
      const preamble = /^\s*(?:enable f16;|alias hf\d? = .*;)\s*$/;
      const body = (name: string): string[] =>
        resolveShader(name)
          .split('\n')
          .filter((line) => !preamble.test(line));

      expect(body('bloom-f16')).toEqual(body('bloom'));
      expect(body('post-f16')).toEqual(body('post'));
    });

    it('gives every precision variant the same entry points, so a pipeline can pick either', () => {
      for (const [plain, half] of [
        ['bloom', 'bloom-f16'],
        ['post', 'post-f16'],
      ]) {
        const entries = (name: string): string[] =>
          [...resolveShader(name).matchAll(/^fn (\w+)\(/gm)].map((match) => match[1]).sort();

        expect(entries(half), half).toEqual(entries(plain));
      }
    });

    it('carries BOTH downsample kernels, because the budget picks one per frame', () => {
      // Jimenez's thirteen taps and Bjorge's five (SIGGRAPH 2015 — Arm's own kernel for this GPU family).
      for (const name of ['bloom', 'bloom-f16']) {
        expect(resolveShader(name), name).toContain('fn fsBloomDown(');
        expect(resolveShader(name), name).toContain('fn fsBloomDownDual(');
      }
    });

    it('keeps every COORDINATE at full width in the half-width variants', () => {
      // The load-bearing half of the f16 change: an f16 UV resolves to ~1/2048 near 0.5 against a texel
      // offset of 1/1440 on this surface, so tap positions would collapse into each other. If a `uv`,
      // a texel offset or the godray walk ever takes the `hf` alias, this fails.
      for (const name of ['bloom-f16', 'post-f16']) {
        const wgsl = resolveShader(name);

        expect(wgsl, name).toContain('uv: vec2f');
        expect(wgsl, name).not.toMatch(/uv:\s*hf/);
        expect(wgsl, name).not.toMatch(/let (?:t|h|delta) = .*hf\(/);
      }
      expect(resolveShader('bloom-f16')).toContain('fn insideFrame(uv: vec2f) -> f32');
      expect(resolveShader('post-f16')).toContain('let delta = (post.sun.xy - in.uv) / f32(GODRAY_TAPS);');
    });

    it('maps .oscell group classes onto the enumerated pipeline ids', () => {
      expect(pipelineIdFor(0, 0)).toBe('world-opaque-front');
      expect(pipelineIdFor(0, 1)).toBe('world-opaque-double');
      expect(pipelineIdFor(1, 0)).toBe('world-cutout-front');
      expect(pipelineIdFor(2, 1)).toBe('world-blend-double');
      expect(pipelineIdFor(3, 0)).toBe('world-beam-front');
      expect(pipelineIdFor(4, 0)).toBe('world-additive-front');
      expect(pipelineIdFor(4, 1)).toBe('world-additive-double');
    });
  });
});
