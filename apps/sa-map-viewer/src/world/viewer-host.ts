/**
 * The viewer's engine host (plan 094, phase 1): boot the engine on the canvas, keep the cell under the camera
 * resident, run the frame loop and translate pointer input into camera steps. Plain DOM + engine — no React
 * inside the loop, which is what lets the whole thing be driven by a URL and captured headlessly.
 */
import { Engine } from '@opensa/engine';

import type { ViewerPose } from '../camera/viewer-camera';
import type { LoadedMap } from '../source/map-source';
import type { CellLoadStats } from './cell-renderer';

import { poseFromQuery, ViewerCamera } from '../camera/viewer-camera';
import { cellAt, type CellCoord, CellRenderer, mapCenterGta } from './cell-renderer';

/** What the panel reads back from the running viewer. */
export interface ViewerReadout {
  cell: CellCoord;
  fps: number;
  load: CellLoadStats;
  pose: ViewerPose;
}

/** Readout pushes per second — the panel is a readout, not a HUD; the loop must not re-render React. */
const READOUT_HZ = 4;

export async function bootViewer(
  canvas: HTMLCanvasElement,
  map: LoadedMap,
  onReadout: (readout: ViewerReadout) => void,
): Promise<void> {
  const dpr = window.devicePixelRatio;
  const resize = (): void => {
    canvas.width = Math.max(2, Math.floor(canvas.clientWidth * dpr));
    canvas.height = Math.max(2, Math.floor(canvas.clientHeight * dpr));
  };
  resize();
  new ResizeObserver(resize).observe(canvas);

  const engine = new Engine();
  await engine.init(canvas);
  // Wind OFF by default. It is the ONLY thing in a noon frame that moves on its own, and it moves exactly
  // the vegetation — measured: two runs of the same URL are pixel-identical everywhere EXCEPT the trees.
  // A map inspector whose A/B is noisy in the canopy is a map inspector that cannot bisect a tree. `?wind=N`
  // brings it back for a look.
  const wind = Number(new URLSearchParams(window.location.search).get('wind') ?? Number.NaN);
  engine.environment.windStrength = Number.isFinite(wind) ? wind : 0;

  const camera = new ViewerCamera(poseFromQuery(window.location.search, mapCenterGta(map)));
  const renderer = new CellRenderer(engine, map);
  let cell = cellAt(camera.positionGta());
  let load = await renderer.setCells([cell], false);
  report(map, cell, load);

  bindInput(canvas, camera);

  const frames: number[] = [];
  let lastReadout = 0;
  let loading = false;
  let previous = performance.now();
  const loop = (): void => {
    const now = performance.now();
    frames.push(now - previous);
    previous = now;
    if (frames.length > 60) {
      frames.shift();
    }
    // Only the cell under the camera renders (phase 2 turns this into an explicit cell set). The load is
    // async (it reads the cell's models first), so it runs at most once at a time — panning fast simply
    // lands on whatever cell is under the camera when the previous load returns.
    const under = cellAt(camera.positionGta());
    if (!loading && (under.cx !== cell.cx || under.cy !== cell.cy)) {
      cell = under;
      loading = true;
      void renderer
        .setCells([cell], false)
        .then((result) => {
          load = result;
          report(map, cell, load);
        })
        .finally(() => {
          loading = false;
        });
    }
    engine.frame(camera.state(canvas.width / Math.max(1, canvas.height)));
    if (now - lastReadout > 1000 / READOUT_HZ) {
      lastReadout = now;
      const average = frames.reduce((sum, value) => sum + value, 0) / Math.max(1, frames.length);
      onReadout({ cell, fps: Math.round(1000 / Math.max(1, average)), load, pose: camera.pose() });
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/** Left-drag pans, right-drag orbits/tilts, the wheel dollies — the debugger map viewer's gestures. */
function bindInput(canvas: HTMLCanvasElement, camera: ViewerCamera): void {
  let dragging: null | { button: number; x: number; y: number } = null;

  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('pointerdown', (event) => {
    dragging = { button: event.button, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointerup', (event) => {
    dragging = null;
    canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) {
      return;
    }
    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;
    dragging = { button: dragging.button, x: event.clientX, y: event.clientY };
    if (dragging.button === 2) {
      camera.orbit(dx, dy);
    } else {
      camera.pan([(2 * dx) / canvas.clientWidth, (-2 * dy) / canvas.clientHeight]);
    }
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    camera.dolly(Math.sign(event.deltaY));
  });
}

/** One line per cell load, naming the SOURCE — a capture out of this tool is never silent about its origin. */
function report(map: LoadedMap, cell: CellCoord, load: CellLoadStats): void {
  // eslint-disable-next-line no-console -- the load record the plan's numbers are read from
  console.log(
    `[sa-map-viewer] cell ${cell.cx},${cell.cy} from ${map.label} — ` +
      `read ${(load.assetBytes / 1024 / 1024).toFixed(1)} MB in ${load.fetchMs} ms, weld ${load.weldMs} ms, ` +
      `textures ${load.arrays} arrays / ${(load.textures / 1024 / 1024).toFixed(1)} MB in ${load.textureMs} ms, ` +
      `${load.vertices} verts / ${load.indices / 3} tris`,
  );
}
