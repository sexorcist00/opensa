import { Engine } from '@opensa/engine';
import {
  createEngineEnvironmentDriver,
  DEFAULT_ENGINE_ENV_CONFIG,
} from '@opensa/game/adapters/engine-environment-driver';

import type { OrbitRig } from './orbit';

import { createOrbitRig } from './orbit';

/**
 * The shared boot for every viewer tab: one canvas, one engine, one orbit rig, one frame loop.
 *
 * TWO constraints shape this file:
 *
 * 1. **The canvas is created and appended SYNCHRONOUSLY**, before any `await`. `e2e/viewer-tabs.spec.ts`
 *    asserts a visible canvas immediately after navigation, and `engine.init` awaits an adapter — so the
 *    element must exist first and be configured later.
 * 2. **The viewer is not the game.** The engine's defaults are tuned for a streamed city at noon (fog cut
 *    2400, AO, bloom); an asset viewer must show the model as it IS. `neutralEnvironment` flattens that.
 */

export interface ViewerEngine {
  canvas: HTMLCanvasElement;
  engine: Engine;
  orbit: OrbitRig;
  /** Resolves once the device is up; every engine call must await it. */
  ready: Promise<void>;
  /** Runs `step` every frame after `ready`. */
  start(step?: (dtSeconds: number) => void): void;
}

export function createViewerEngine(): ViewerEngine {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100vw;height:100vh';
  document.body.appendChild(canvas);

  const dpr = Math.min(window.devicePixelRatio, 2);
  const resize = (): void => {
    canvas.width = Math.max(2, Math.floor(canvas.clientWidth * dpr));
    canvas.height = Math.max(2, Math.floor(canvas.clientHeight * dpr));
  };
  resize();
  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe(canvas);

  const engine = new Engine();
  const orbit = createOrbitRig(canvas);
  const ready = engine.init(canvas).then(() => {
    neutralEnvironment(engine);
  });

  return {
    canvas,
    engine,
    orbit,
    ready,
    start(step) {
      void ready.then(() => {
        let previous = performance.now();
        const loop = (now: number): void => {
          const dt = Math.min(0.1, (now - previous) / 1000);
          previous = now;
          step?.(dt);
          // Flattens every rigid instance's part matrices and uploads them. Without it the models exist
          // on the GPU but are never placed — an empty frame with a correct triangle count.
          engine.updateVehicles();
          engine.frame(orbit.state(canvas.width / Math.max(1, canvas.height)));
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      });
    },
  };
}

/** Noon, no haze, no baked-lighting boost — a neutral studio for looking at geometry. */
function neutralEnvironment(engine: Engine): void {
  createEngineEnvironmentDriver(engine.environment, {
    config: {
      ...DEFAULT_ENGINE_ENV_CONFIG,
      graphics: {
        ...DEFAULT_ENGINE_ENV_CONFIG.graphics,
        bloom: { ...DEFAULT_ENGINE_ENV_CONFIG.graphics.bloom, enabled: false },
        sun: { godrays: false },
      },
    },
  }).apply(12);
  engine.environment.aoStrength = 0;
  engine.environment.fogStartDistance = 50_000;
  engine.environment.fogCutDistance = 100_000;
  // No streamed world means no cell geometry for a probe to capture — the analytic sky is the fallback.
  engine.probeCenter = null;
}
