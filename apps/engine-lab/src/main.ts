/**
 * Engine lab entry (plan 074/04). M0: the synthetic district through the REAL path (formats → upload →
 * bundles → culling → MSAA+A2C pass), orbiting camera, the gate HUD. `?cells=N` (grid side, default 8),
 * `?boxes=N` (boxes per cell side, default 12), `?freeze=1` stops the orbit.
 */
import { type CameraState, Engine } from '@opensa/engine';

import { loadPak } from './pak-loader';
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
  const usePak = params.get('pak') === '1';
  hud.textContent = `device: ${engine.adapterInfo}\n${usePak ? 'loading pak…' : 'building synthetic district…'}`;

  const buildStart = performance.now();
  let recordedDraws = 0;
  let focus: [number, number, number];
  let orbitRadius: number;
  let title: string;
  if (usePak) {
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

  const loop = (): void => {
    const now = performance.now();
    frames.push(now - previous);
    previous = now;
    if (frames.length > 120) {
      frames.shift();
    }
    if (!freeze && !dragging) {
      angle += 0.003;
    }
    const radius = orbitRadius * zoom;
    const camera: CameraState = {
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
    const stats = engine.frame(camera);
    const frameAvg = frames.reduce((sum, value) => sum + value, 0) / frames.length;
    hud.textContent =
      `engine lab — ${title}\n` +
      `device      ${engine.adapterInfo}\n` +
      `frame       ${frameAvg.toFixed(2)} ms (${(1000 / Math.max(frameAvg, 0.001)).toFixed(0)} fps), max ${Math.max(...frames).toFixed(0)}\n` +
      `submit CPU  ${stats.submitMs.toFixed(2)} ms\n` +
      `GPU pass    ${stats.gpuPassMs > 0 ? stats.gpuPassMs.toFixed(2) : 'n/a'} ms\n` +
      `cells       ${stats.cellsVisible}/${stats.cellsTotal} visible, draws ${stats.drawsRecorded}\n` +
      `residency   ${(stats.residencyBytes / (1024 * 1024)).toFixed(1)} MB\n` +
      `build       ${buildMs.toFixed(0)} ms (fixture, off the P0 clock)`;
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
