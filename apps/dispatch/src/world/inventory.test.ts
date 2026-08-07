import type { EngineStats, FrameSpanTotals } from '@opensa/engine';

import { describe, expect, it } from 'vitest';

import { FrameInventory } from './inventory';

const NO_SPANS: FrameSpanTotals = { byName: [], totalMs: 0 };

function stats(overrides: Partial<EngineStats> = {}): EngineStats {
  return {
    cellsTotal: 144,
    cellsVisible: 38,
    drawsRecorded: 162,
    gpuPassMs: 0,
    gpuPostMs: 0,
    gpuProbeMs: 0,
    residencyBytes: 37 * 1024 * 1024,
    submitMs: 0.4,
    trianglesRecorded: 120_000,
    ...overrides,
  };
}

const CONTEXT = { build: 'original@test', device: {}, district: 'los-santos-centre', hasTimestamps: true };

describe('FrameInventory', () => {
  describe('negative cases', () => {
    it('reports zeroes rather than dividing by no frames', () => {
      const report = new FrameInventory().report(CONTEXT);

      expect(report.frames).toBe(0);
      expect(report.frame.fps).toBe(0);
      expect(report.frame.dtP50Ms).toBe(0);
      expect(report.windowMs).toBe(0);
    });

    it('marks GPU passes UNAVAILABLE when the adapter cannot time them, instead of reporting them as free', () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS);

      const report = inventory.report({ ...CONTEXT, hasTimestamps: false });
      const gpu = report.passes.find((pass) => pass.name === 'gpuPassMs');

      expect(gpu?.available).toBe(false);
      expect(report.unavailable).toHaveLength(1);
      expect(report.unavailable[0]).toContain('timestamp-query');
    });

    it('keeps submitMs available without timestamps — it is a CPU number', () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS);

      const submit = inventory.report({ ...CONTEXT, hasTimestamps: false }).passes.find((p) => p.name === 'submitMs');

      expect(submit?.available).toBe(true);
    });

    it('records no spans when nothing between frames was wrapped', () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS);

      expect(inventory.report(CONTEXT).spans).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('reports the p95 of dt, not its mean — a mean hides the hitches this is looking for', () => {
      const inventory = new FrameInventory();
      // 10 % of frames hitch. A mean would read 38 ms and hide both the healthy body and the stalls; p50 and
      // p95 report them separately, which is the whole reason the window keeps every dt.
      for (let i = 0; i < 90; i += 1) {
        inventory.sample(16, stats(), NO_SPANS);
      }
      for (let i = 0; i < 10; i += 1) {
        inventory.sample(240, stats(), NO_SPANS);
      }

      const report = inventory.report(CONTEXT);

      expect(report.frame.dtP50Ms).toBe(16);
      expect(report.frame.dtP95Ms).toBe(240);
      expect(report.frame.dtMaxMs).toBe(240);
      expect(report.frame.fps).toBe(63);
    });

    it('averages a span over every sampled frame, not over the frames that paid it', () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), { byName: [['cell-collision', 30]], totalMs: 30 });
      inventory.sample(16, stats(), NO_SPANS);

      const [[name, meanMs]] = inventory.report(CONTEXT).spans;

      expect(name).toBe('cell-collision');
      expect(meanMs).toBe(15);
    });

    it('orders passes by mean cost so the table reads top-down', () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats({ gpuPassMs: 12, gpuPostMs: 3, submitMs: 0.4 }), NO_SPANS);

      const names = inventory.report(CONTEXT).passes.map((pass) => pass.name);

      expect(names.slice(0, 3)).toEqual(['gpuPassMs', 'gpuPostMs', 'submitMs']);
    });

    it('carries the world counters and the context the capture must state', () => {
      const inventory = new FrameInventory();
      inventory.sample(16, stats(), NO_SPANS);

      const report = inventory.report(CONTEXT);

      expect(report.world).toEqual({
        cellsTotal: 144,
        cellsVisible: 38,
        draws: 162,
        residencyMb: 37,
        triangles: 120_000,
      });
      expect(report.district).toBe('los-santos-centre');
      expect(report.build).toBe('original@test');
    });
  });
});
