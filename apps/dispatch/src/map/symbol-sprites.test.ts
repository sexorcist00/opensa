import { describe, expect, it } from 'vitest';

import { ALPHA_STEPS, quantizeAlpha, SymbolSprites } from './symbol-sprites';

/** A factory that hands out recording canvases and counts how many were asked for. */
function factory(): { create: (w: number, h: number) => HTMLCanvasElement; made: { calls: string[] }[] } {
  const made: { calls: string[] }[] = [];

  return {
    create: (): HTMLCanvasElement => {
      const next = fakeCanvas();
      made.push(next);

      return next.canvas;
    },
    made,
  };
}

/** A canvas that records the ops a sprite was baked with, so a test can read what was rasterized. */
function fakeCanvas(): { calls: string[]; canvas: HTMLCanvasElement } {
  const calls: string[] = [];
  const ctx = {
    arc: (): void => void calls.push('arc'),
    beginPath: (): void => void calls.push('beginPath'),
    closePath: (): void => undefined,
    fill: (): void => void calls.push('fill'),
    fillStyle: '',
    lineTo: (): void => undefined,
    lineWidth: 0,
    moveTo: (): void => undefined,
    rect: (): void => void calls.push('rect'),
    rotate: (): void => undefined,
    setTransform: (): void => undefined,
    stroke: (): void => void calls.push('stroke'),
    strokeStyle: '',
    translate: (): void => undefined,
  };

  return { calls, canvas: { getContext: () => ctx, height: 0, width: 0 } as unknown as HTMLCanvasElement };
}

describe('SymbolSprites', () => {
  describe('negative cases', () => {
    it('answers null where no canvas can be made, so the layer keeps its path drawing', () => {
      const sprites = new SymbolSprites(2, () => null);

      expect(sprites.chevron('#fff', false, false)).toBeNull();
      expect(sprites.diamond('#fff', false, 8)).toBeNull();
    });

    it('does not retry a host that has already refused — one attempt per variant, not one per frame', () => {
      let asked = 0;
      const sprites = new SymbolSprites(2, () => {
        asked += 1;

        return null;
      });
      for (let frame = 0; frame < 50; frame += 1) {
        sprites.chevron('#fff', false, false);
      }

      expect(asked).toBe(1);
    });

    it('does not grow a sprite per aging unit — the fade is quantized before it becomes a key', () => {
      const { create, made } = factory();
      const sprites = new SymbolSprites(2, create);
      // 400 distinct raw alphas, as a fading board would produce frame after frame.
      for (let i = 0; i < 400; i += 1) {
        sprites.chevron(`rgba(1, 2, 3, ${quantizeAlpha(1 - i / 400)})`, false, true);
      }

      expect(made.length).toBeLessThanOrEqual(ALPHA_STEPS + 1);
      expect(sprites.size).toBe(made.length);
    });
  });

  describe('positive cases', () => {
    it('rasterizes a variant once however many instances ask for it', () => {
      const { create, made } = factory();
      const sprites = new SymbolSprites(2, create);
      for (let unit = 0; unit < 150; unit += 1) {
        sprites.chevron('#4ade80', false, false);
      }

      expect(made.length).toBe(1);
      expect(sprites.size).toBe(1);
      // The disc and the arrow, both baked: an `arc` and a path, each painted.
      expect(made[0].calls).toContain('arc');
      expect(made[0].calls.filter((call) => call === 'fill').length).toBe(2);
    });

    it('keeps the variants that look different apart', () => {
      const { create, made } = factory();
      const sprites = new SymbolSprites(2, create);
      sprites.chevron('#4ade80', false, false);
      sprites.chevron('#4ade80', true, false);
      sprites.chevron('#4ade80', false, true);
      sprites.chevron('#f87171', false, false);
      sprites.chevron('#4ade80', false, false);

      expect(made.length).toBe(4);
    });

    it('bakes a call as a rect it has already rotated, so an instance is a plain blit', () => {
      const { create, made } = factory();
      const sprites = new SymbolSprites(2, create);
      const sprite = sprites.diamond('#fbbf24', false, 8);

      expect(made[0].calls).toContain('rect');
      expect(sprite?.size).toBe((sprite?.halfSize ?? 0) * 2);
    });

    it('rounds an alpha onto a bounded set of steps', () => {
      expect(quantizeAlpha(1)).toBe(1);
      expect(quantizeAlpha(0.35)).toBeCloseTo(0.375, 5);
      expect(new Set(Array.from({ length: 500 }, (_, i) => quantizeAlpha(i / 500))).size).toBeLessThanOrEqual(
        ALPHA_STEPS + 1,
      );
    });
  });
});
