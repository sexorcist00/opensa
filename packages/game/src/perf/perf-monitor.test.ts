import type { WebGLRenderer } from 'three';

import { describe, expect, it } from 'vitest';

import { percentile, PerfMonitor } from './perf-monitor';

/** A renderer stub whose `info` counters are settable per frame. */
function fakeRenderer(calls = 100, triangles = 5000): WebGLRenderer {
  return {
    info: {
      memory: { geometries: 10, textures: 20 },
      programs: [{}, {}],
      render: { calls, triangles },
    },
  } as unknown as WebGLRenderer;
}

describe('percentile', () => {
  describe('negative cases', () => {
    it('returns 0 for an empty sample set', () => {
      expect(percentile([], 95)).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('returns the nearest-rank value without mutating the input', () => {
      const samples = [5, 1, 3, 2, 4];
      expect(percentile(samples, 95)).toBe(5);
      expect(percentile(samples, 50)).toBe(3);
      expect(samples).toEqual([5, 1, 3, 2, 4]);
    });
  });
});

describe('PerfMonitor', () => {
  describe('negative cases', () => {
    it('samples nothing while disabled and not capturing', () => {
      const monitor = new PerfMonitor();
      monitor.frame(1 / 60, fakeRenderer());
      expect(monitor.stats()).toBeNull();
    });

    it('ignores non-positive frame deltas', () => {
      const monitor = new PerfMonitor();
      monitor.enabled = true;
      monitor.frame(0, fakeRenderer());
      monitor.frame(-1, fakeRenderer());
      expect(monitor.stats()).toBeNull();
    });

    it('endCapture returns null when no frames were captured', () => {
      const monitor = new PerfMonitor();
      monitor.beginCapture();
      expect(monitor.endCapture()).toBeNull();
      expect(monitor.endCapture()).toBeNull(); // and when no capture is open at all
    });
  });

  describe('positive cases', () => {
    it('reports rolling stats with renderer info of the last frame', () => {
      const monitor = new PerfMonitor();
      monitor.enabled = true;
      for (let index = 0; index < 10; index += 1) {
        monitor.frame(0.01, fakeRenderer(150, 9000));
      }
      const stats = monitor.stats();
      expect(stats).not.toBeNull();
      expect(stats?.avgMs).toBeCloseTo(10, 5);
      expect(stats?.fps).toBeCloseTo(100, 3);
      expect(stats?.drawCalls).toBe(150);
      expect(stats?.triangles).toBe(9000);
      expect(stats?.programs).toBe(2);
      expect(stats?.geometries).toBe(10);
      expect(stats?.textures).toBe(20);
    });

    it('trims the rolling window to ~2 seconds', () => {
      const monitor = new PerfMonitor();
      monitor.enabled = true;
      for (let index = 0; index < 100; index += 1) {
        monitor.frame(0.1, fakeRenderer()); // 10 s of 100 ms frames
      }
      const stats = monitor.stats();
      expect(stats?.avgMs).toBeCloseTo(100, 5); // window holds only 100 ms frames, sum ≤ 2 s
    });

    it('captures a run aggregate even while the HUD sampling is disabled', () => {
      const monitor = new PerfMonitor();
      monitor.beginCapture();
      monitor.frame(0.02, fakeRenderer(100, 4000));
      monitor.frame(0.04, fakeRenderer(200, 8000));
      const capture = monitor.endCapture();
      expect(capture?.frames).toBe(2);
      expect(capture?.avgMs).toBeCloseTo(30, 5);
      expect(capture?.p95Ms).toBeCloseTo(40, 5);
      expect(capture?.avgDrawCalls).toBe(150);
      expect(capture?.avgTriangles).toBe(6000);
      expect(monitor.stats()).toBeNull(); // capture does not feed the HUD window
    });
  });
});
