import { describe, expect, it } from 'vitest';

import type { Incident, Operations, Unit } from '../ops/types';
import type { ScreenPoint, ScreenProjector } from './projection';

import { SymbologyLayer } from './overlay-2d';

function board(units: number, incidents = 0): Operations {
  return {
    incidents: Array.from({ length: incidents }, (_, i) => call(i)),
    log: [],
    now: 0,
    units: Array.from({ length: units }, (_, i) => unit(i)),
  };
}

function call(index: number): Incident {
  return {
    assigned: [],
    at: [1000 + index, -1000],
    code: '10-50',
    id: `i${index}`,
    opened: 0,
    place: 'Ganton',
    priority: 2,
    remaining: 30,
    status: 'pending',
    title: 'Traffic collision',
  };
}

/** A 2D context that records what was asked of it — the layer's cost is calls, not pixels. */
function fakeContext(): { calls: { font: number; measure: number }; ctx: CanvasRenderingContext2D } {
  const calls = { font: 0, measure: 0 };
  const ctx = {
    arc: (): void => undefined,
    arcTo: (): void => undefined,
    beginPath: (): void => undefined,
    closePath: (): void => undefined,
    fill: (): void => undefined,
    fillStyle: '',
    fillText: (): void => undefined,
    lineTo: (): void => undefined,
    lineWidth: 0,
    measureText: (text: string): TextMetrics => {
      calls.measure += 1;

      return { width: text.length * 6 } as TextMetrics;
    },
    moveTo: (): void => undefined,
    rect: (): void => undefined,
    restore: (): void => undefined,
    rotate: (): void => undefined,
    save: (): void => undefined,
    stroke: (): void => undefined,
    strokeStyle: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    translate: (): void => undefined,
  };
  Object.defineProperty(ctx, 'font', {
    get: (): string => '',
    set: (): void => {
      calls.font += 1;
    },
  });

  return { calls, ctx: ctx as unknown as CanvasRenderingContext2D };
}

/** Everything lands at the same near point — the layer is being measured, not the camera. */
function fakeProjector(depth = 100): ScreenProjector {
  return { project: (): ScreenPoint => ({ depth, x: 200, y: 200 }) } as unknown as ScreenProjector;
}

function unit(index: number): Unit {
  return {
    at: [1000 + index, -1000],
    callsign: `4-XRAY-${index}`,
    heading: 0,
    id: `u${index}`,
    incident: null,
    kind: 'patrol',
    status: 'available',
    target: null,
  };
}

const SIZE = { height: 800, width: 1200 };

describe('SymbologyLayer', () => {
  describe('negative cases', () => {
    it('does not re-measure a label it has already drawn — the per-symbol cost 5/02 was written for', () => {
      const { calls, ctx } = fakeContext();
      const layer = new SymbologyLayer();
      const ops = board(150);

      layer.render(ctx, fakeProjector(), ops, null, SIZE);
      expect(calls.measure).toBe(150);
      expect(layer.counted().measures).toBe(150);

      const first = calls.measure;
      layer.render(ctx, fakeProjector(), ops, null, SIZE);
      layer.render(ctx, fakeProjector(), ops, null, SIZE);

      expect(calls.measure).toBe(first);
      expect(layer.counted().measures).toBe(0);
    });

    it('sets the font a fixed number of times per frame, not once per chip', () => {
      const { calls, ctx } = fakeContext();
      const layer = new SymbologyLayer();

      layer.render(ctx, fakeProjector(), board(4), null, SIZE);
      const small = calls.font;
      layer.render(ctx, fakeProjector(), board(150), null, SIZE);

      expect(calls.font - small).toBe(small);
    });

    it('drops a chip past the depth cut and counts the drop', () => {
      const { ctx } = fakeContext();
      const layer = new SymbologyLayer();

      layer.render(ctx, fakeProjector(9000), board(10, 2), null, SIZE);

      expect(layer.counted().chips).toBe(0);
      expect(layer.counted().chipsDropped).toBe(12);
      expect(layer.counted().symbols).toBe(12);
    });
  });

  describe('positive cases', () => {
    it('counts every symbol and chip it drew', () => {
      const { ctx } = fakeContext();
      const layer = new SymbologyLayer();

      layer.render(ctx, fakeProjector(), board(150, 40), null, SIZE);

      expect(layer.counted()).toEqual({ chips: 190, chipsDropped: 0, measures: 151, symbols: 190 });
    });

    it('hit-tests the pixels it last drew', () => {
      const { ctx } = fakeContext();
      const layer = new SymbologyLayer();

      layer.render(ctx, fakeProjector(), board(1), null, SIZE);

      expect(layer.hitTest(200, 200)).toEqual({ id: 'u0', kind: 'unit' });
      expect(layer.hitTest(2, 2)).toBeNull();
    });
  });
});
