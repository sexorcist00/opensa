/**
 * Engine lab entry (plan 074/04). M0: the synthetic district through the REAL path (formats → upload →
 * bundles → culling → MSAA+A2C pass), orbiting camera, the gate HUD. `?cells=N` (grid side, default 8),
 * `?boxes=N` (boxes per cell side, default 12), `?freeze=1` stops the orbit.
 */
import { type CameraState, Engine } from '@opensa/engine';

import type { StreamingDriver } from './stream/streaming';

import { BENCH_SCENES, BenchCollector, downloadRecord, formatRecord } from './bench';
import { loadPak } from './pak-loader';
import { setupStreaming } from './stream/setup';
import { type StreamStats } from './stream/streaming';
import { syntheticCell, syntheticTextureArray } from './synthetic';

const CELL_SIZE = 250;

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const gridSide = Number(params.get('cells') ?? 8) || 8;
  const boxesPerSide = Number(params.get('boxes') ?? 12) || 12;
  const freeze = params.get('freeze') === '1';

  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const hud = document.getElementById('hud') as HTMLPreElement;

  const engine = new Engine();
  await engine.init(canvas);
  // `?hour=N` (default 12): a simple parametric day arc drives the environment — real timecyc sampling is
  // effects-ledger row 14. `?daycycle=1` animates the hour for eyeballing the blend.
  const hourParam = Number(params.get('hour') ?? 12);
  const dayCycle = params.get('daycycle') === '1';
  let hour = Number.isFinite(hourParam) ? hourParam : 12;
  const applyEnvironment = (): void => {
    const elevation = Math.sin(((hour - 6) / 12) * Math.PI); // -1..1 across 6:00→18:00
    const dn = 1 - Math.min(1, Math.max(0, (elevation + 0.15) / 0.3));
    engine.environment.dn = dn;
    engine.environment.sunDir = [0.35, Math.max(0.05, elevation), 0.25];
    const warm = Math.min(1, Math.max(0, 1 - elevation)); // low sun → warm
    engine.environment.sunColor = [1, 0.96 - warm * 0.15, 0.88 - warm * 0.3];
    engine.environment.sunDirect = Math.max(0, elevation) * 0.9;
    engine.environment.sunIndirect = 0.75 * (1 - dn) + 0.35 * dn;
    // LINEAR-space sky gradient (sky pass + world fog share it; the flat clear is behind the sky pass now).
    const lerp3 = (a: readonly number[], b: readonly number[], t: number): [number, number, number] => [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ];
    engine.environment.skyTop = lerp3([0.12, 0.32, 0.65], [0.002, 0.004, 0.012], dn);
    engine.environment.skyHorizon = lerp3([0.42, 0.55, 0.72], [0.01, 0.012, 0.03], dn);
    engine.environment.fogCutDistance = 2400;
    engine.environment.fogStartDistance = 250;
  };
  applyEnvironment();
  const usePak = params.get('pak') === '1';
  const useStream = usePak && params.get('stream') === '1';
  hud.textContent = `device: ${engine.adapterInfo}\n${usePak ? 'loading pak…' : 'building synthetic district…'}`;

  const buildStart = performance.now();
  let recordedDraws = 0;
  let focus: [number, number, number];
  let orbitRadius: number;
  let title: string;
  let streaming: null | StreamingDriver = null;
  if (useStream) {
    const setup = await setupStreaming(engine);
    streaming = setup.driver;
    focus = setup.center;
    orbitRadius = setup.radius * 1.4;
    title = 'STREAMING district (worker pak, rings live)';
  } else if (usePak) {
    const district = await loadPak(engine);
    recordedDraws = district.drawsRecorded;
    focus = district.center;
    orbitRadius = Math.max(district.radius * 1.6, 400);
    title = `converted district (${district.cellCount} cells, ${recordedDraws} recorded draws)`;
  } else {
    engine.textures.load(0, syntheticTextureArray());
    for (let cx = 0; cx < gridSide; cx += 1) {
      for (let cy = 0; cy < gridSide; cy += 1) {
        const handle = engine.cells.load(`${cx},${cy},hd`, syntheticCell(cx, cy, CELL_SIZE, boxesPerSide));
        recordedDraws += handle.draws;
      }
    }
    const half = (gridSide * CELL_SIZE) / 2;
    focus = [half, 0, half];
    orbitRadius = half * 1.7;
    title = `synthetic district (${gridSide}×${gridSide} cells, ${recordedDraws} recorded draws)`;
  }
  const buildMs = performance.now() - buildStart;
  const frames: number[] = [];
  let previous = performance.now();
  let angle = 0;
  let zoom = 1;
  let heightFactor = 0.9;
  let dragging = false;
  // Wheel = zoom (the alpha-edge inspection needs to get CLOSE to foliage/fences); drag = orbit/height.
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoom = Math.min(20, Math.max(0.02, zoom * (event.deltaY > 0 ? 1.1 : 0.9)));
  });
  canvas.addEventListener('pointerdown', () => (dragging = true));
  window.addEventListener('pointerup', () => (dragging = false));
  window.addEventListener('pointermove', (event) => {
    if (dragging) {
      angle += event.movementX * 0.004;
      heightFactor = Math.min(4, Math.max(0.05, heightFactor + event.movementY * 0.004));
    }
  });

  // Bench mode (074/11): deterministic scene script + warmup/measure collection, then a JSON record.
  const benchScene = params.get('bench');
  const benchScript = benchScene ? BENCH_SCENES[benchScene] : null;
  if (benchScene && !benchScript) {
    throw new Error(`unknown bench scene '${benchScene}' (have: ${Object.keys(BENCH_SCENES).join(', ')})`);
  }
  const collector = new BenchCollector();
  let benchDone = false;

  const loop = (): void => {
    const now = performance.now();
    const frameDt = now - previous;
    frames.push(frameDt);
    previous = now;
    if (frames.length > 120) {
      frames.shift();
    }
    if (!freeze && !dragging) {
      angle += 0.003;
    }
    if (dayCycle) {
      hour = (hour + 0.005) % 24;
      applyEnvironment();
    }
    const radius = orbitRadius * zoom;
    const camera: CameraState = benchScript
      ? benchScript(collector.currentFrame, {
          aspect: canvas.width / Math.max(1, canvas.height),
          focus,
          radius: orbitRadius,
        })
      : {
          aspect: canvas.width / Math.max(1, canvas.height),
          eye: [
            focus[0] + Math.cos(angle) * radius,
            focus[1] + Math.max(4, radius * heightFactor * 0.45),
            focus[2] + Math.sin(angle) * radius,
          ],
          far: 10000,
          fovYRad: Math.PI / 3,
          near: 0.5,
          target: focus,
          up: [0, 1, 0],
        };
    let streamStats: null | StreamStats = null;
    if (streaming) {
      // Rings follow the camera TARGET (the ground focus — the "player"), not the eye: an orbiting eye sits
      // outside the LOD ring and would stream nothing.
      streamStats = streaming.update(camera.target);
    }
    const stats = engine.frame(camera);
    if (benchScript && !benchDone) {
      collector.sample(frameDt, stats);
      if (!collector.running) {
        benchDone = true;
        const record = collector.finish(benchScene ?? '?', engine.adapterInfo, canvas);
        downloadRecord(record);
        hud.textContent = formatRecord(record);

        return; // freeze the loop on the summary
      }
    }
    const frameAvg = frames.reduce((sum, value) => sum + value, 0) / frames.length;
    hud.textContent =
      `engine lab — ${title}\n` +
      `device      ${engine.adapterInfo}\n` +
      `frame       ${frameAvg.toFixed(2)} ms (${(1000 / Math.max(frameAvg, 0.001)).toFixed(0)} fps), max ${Math.max(...frames).toFixed(0)}\n` +
      `submit CPU  ${stats.submitMs.toFixed(2)} ms\n` +
      `GPU pass    ${stats.gpuPassMs > 0 ? stats.gpuPassMs.toFixed(2) : 'n/a'} ms\n` +
      `cells       ${stats.cellsVisible}/${stats.cellsTotal} visible, draws ${stats.drawsRecorded}\n` +
      `residency   ${(stats.residencyBytes / (1024 * 1024)).toFixed(1)} MB\n` +
      `build       ${buildMs.toFixed(0)} ms (fixture, off the P0 clock)` +
      (streamStats
        ? `\nstream      ${streamStats.loadedCells} loaded, ${streamStats.pendingCells} pending, ` +
          `${streamStats.created} created / ${streamStats.evicted} evicted, worst create ${streamStats.worstCreateMs.toFixed(1)} ms`
        : '');
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

main().catch((error: unknown) => {
  const hud = document.getElementById('hud');
  if (hud) {
    hud.textContent = `engine failed:\n${error instanceof Error ? error.message : String(error)}`;
    hud.style.color = '#f66';
  }
});
