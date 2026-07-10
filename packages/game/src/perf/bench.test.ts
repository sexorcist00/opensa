import type { PerspectiveCamera } from 'three';

import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import type { PluginContext } from '../plugins/plugin';
import type { BenchHost, BenchScene } from './bench';

import { BenchPlugin, samplePath } from './bench';
import { PerfMonitor } from './perf-monitor';

const PATH = [
  { look: [0, 0, 0], pos: [0, 0, 0] },
  { look: [10, 0, 0], pos: [10, 0, 0] },
  { look: [10, 10, 0], pos: [10, 10, 0] },
] as const;

describe('samplePath', () => {
  describe('negative cases', () => {
    it('clamps t outside [0, 1] to the endpoints', () => {
      expect(samplePath(PATH, -1).pos).toEqual([0, 0, 0]);
      expect(samplePath(PATH, 2).pos).toEqual([10, 10, 0]);
    });

    it('returns the single keyframe for a one-point path', () => {
      expect(samplePath([PATH[0]], 0.5)).toBe(PATH[0]);
    });
  });

  describe('positive cases', () => {
    it('interpolates piecewise-linearly across segments', () => {
      expect(samplePath(PATH, 0.25).pos).toEqual([5, 0, 0]); // middle of segment 1
      expect(samplePath(PATH, 0.5).pos).toEqual([10, 0, 0]); // exactly keyframe 2
      expect(samplePath(PATH, 0.75).pos).toEqual([10, 5, 0]); // middle of segment 2
    });
  });
});

/** Camera stub good enough for the runner (position + lookAt). */
function fakeCamera(): PerspectiveCamera {
  return {
    lookAt: () => undefined,
    position: new Vector3(),
  } as unknown as PerspectiveCamera;
}

function fakeContext(camera: PerspectiveCamera, delta: number): PluginContext {
  return { camera, clock: { delta, elapsed: 0 } } as unknown as PluginContext;
}

function fakeHost(): { calls: string[]; host: BenchHost; perf: PerfMonitor } {
  const calls: string[] = [];
  const perf = new PerfMonitor();
  const host: BenchHost = {
    perf,
    setFlyCamera: (enabled) => void calls.push(`fly:${enabled}`),
    setTimeMinutes: (minutes) => void calls.push(`time:${minutes}`),
    setWeather: (weather) => void calls.push(`weather:${weather}`),
    teleport: (coords) => {
      calls.push(`teleport:${coords.join(',')}`);

      return Promise.resolve('settled');
    },
  };

  return { calls, host, perf };
}

const SCENE: BenchScene = {
  anchor: [100, 20, -100],
  durationS: 2,
  hour: 12,
  key: 'test-noon',
  path: PATH,
  weather: 0,
};

describe('BenchPlugin', () => {
  describe('negative cases', () => {
    it('rejects a second run while one is in flight', async () => {
      const { host } = fakeHost();
      const plugin = new BenchPlugin(host);
      void plugin.run(SCENE);
      await Promise.resolve(); // let the async prologue (teleport) finish
      await expect(plugin.run(SCENE)).rejects.toThrow(/already running/);
    });

    it('does nothing when idle', () => {
      const { host } = fakeHost();
      const plugin = new BenchPlugin(host);
      const camera = fakeCamera();
      plugin.update(fakeContext(camera, 0.016));
      expect(camera.position.length()).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('runs setup → warmup → capture → report and restores the camera mode', async () => {
      const { calls, host, perf } = fakeHost();
      const plugin = new BenchPlugin(host);
      const camera = fakeCamera();
      const promise = plugin.run(SCENE);
      await Promise.resolve(); // drain the teleport await
      expect(calls).toEqual(['time:720', 'weather:0', 'teleport:100,20,-100', 'fly:true']);

      // warmup (1.5 s at 0.5 s steps) — camera pinned to path start, no capture yet
      plugin.update(fakeContext(camera, 0.5));
      plugin.update(fakeContext(camera, 0.5));
      plugin.update(fakeContext(camera, 0.5));
      expect(camera.position.toArray()).toEqual([0, 0, 0]);

      // the run: 2 s at 0.5 s steps; PerfMonitor captures via frame()
      const renderer = {
        info: { memory: { geometries: 0, textures: 0 }, programs: [], render: { calls: 50, triangles: 1000 } },
      };
      for (let step = 0; step < 4; step += 1) {
        perf.frame(0.5, renderer as never);
        plugin.update(fakeContext(camera, 0.5));
      }
      const report = await promise;
      expect(report.key).toBe('test-noon');
      expect(report.frames).toBe(4);
      expect(report.avgMs).toBeCloseTo(500, 5);
      expect(report.avgDrawCalls).toBe(50);
      expect(calls[calls.length - 1]).toBe('fly:false');
      expect(camera.position.toArray()).toEqual([10, 10, 0]); // parked at path end
    });
  });
});
