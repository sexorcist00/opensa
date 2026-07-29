/**
 * The viewer's engine host (plan 094, phases 1–2): boot the engine on the canvas, hand the cell set to the
 * `MapGame` the debugger's inspector drives, run the frame loop and translate pointer input into camera steps.
 * Plain DOM + engine — no React inside the loop, which is what lets the whole thing be driven by a URL and
 * captured headlessly.
 */
import { Engine } from '@opensa/engine';

import type { ViewerPose } from '../camera/viewer-camera';
import type { LoadedMap } from '../source/map-source';
import type { CellLoadStats } from './cell-renderer';
import type { CellProgress } from './map-game';

import { CAMERA_FAR, poseFromQuery, ViewerCamera } from '../camera/viewer-camera';
import { CellRenderer, mapCenterGta } from './cell-renderer';
import { ViewerMapGame } from './map-game';

/** The running viewer, handed back so React can mount the inspector against it. */
export interface ViewerHandle {
  game: ViewerMapGame;
}

/** What the panel reads back from the running viewer. */
export interface ViewerReadout {
  fps: number;
  load: CellLoadStats;
  lod: boolean;
  pose: ViewerPose;
  progress: CellProgress | null;
}

/** Pixels of travel a left press may accumulate and still count as a click rather than a pan. */
const CLICK_SLOP = 4;

/** Readout pushes per second — the panel is a readout, not a HUD; the loop must not re-render React. */
const READOUT_HZ = 4;

export async function bootViewer(
  canvas: HTMLCanvasElement,
  map: LoadedMap,
  onReadout: (readout: ViewerReadout) => void,
): Promise<ViewerHandle> {
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
  const params = new URLSearchParams(window.location.search);
  const wind = Number(params.get('wind') ?? Number.NaN);
  engine.environment.windStrength = Number.isFinite(wind) ? wind : 0;
  // Fog OFF by default, pushed out to the far plane. Not a look preference: the engine CULLS a cell that lies
  // entirely past `fogCutDistance` (2400 by default), so from the ~4 km eye a whole-map view needs, every cell
  // was culled and the canvas came back empty — an inspector may not hide its subject. `?fog=1` restores the
  // game's own noon fog for looking at fog.
  if (params.get('fog') !== '1') {
    engine.environment.fogStartDistance = CAMERA_FAR * 0.92;
    engine.environment.fogCutDistance = CAMERA_FAR;
  }
  // Picking is ALWAYS on here (phase 3). In the game it is viewer-only because the placement mapper and the
  // retained index bytes cost tens of MB on a full map; this app is nothing but that viewer, and it must be
  // set BEFORE the first cell loads — `debugPicking` only takes effect on load.
  engine.cells.debugPicking = true;

  const camera = new ViewerCamera(poseFromQuery(window.location.search, mapCenterGta(map)));
  const renderer = new CellRenderer(engine, map);

  let load: CellLoadStats | null = null;
  let lod = false;
  let progress: CellProgress | null = null;
  const game = new ViewerMapGame(
    engine,
    map,
    camera,
    renderer,
    (event) => {
      load = event.stats;
      lod = event.lod;
      report(map, event.stats, event.lod);
    },
    (next) => {
      progress = next;
    },
  );

  bindInput(canvas, camera, game);

  const frames: number[] = [];
  let lastReadout = 0;
  let previous = performance.now();
  const loop = (): void => {
    const now = performance.now();
    frames.push(now - previous);
    previous = now;
    if (frames.length > 60) {
      frames.shift();
    }
    engine.frame(camera.state(canvas.width / Math.max(1, canvas.height)));
    if (now - lastReadout > 1000 / READOUT_HZ) {
      lastReadout = now;
      const average = frames.reduce((sum, value) => sum + value, 0) / Math.max(1, frames.length);
      onReadout({
        fps: Math.round(1000 / Math.max(1, average)),
        load: load ?? EMPTY_LOAD,
        lod,
        pose: camera.pose(),
        progress,
      });
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return { game };
}

const EMPTY_LOAD: CellLoadStats = {
  arrays: 0,
  assetBytes: 0,
  cells: 0,
  cellsWelded: 0,
  fetchMs: 0,
  indices: 0,
  loadMs: 0,
  medianWeldMs: 0,
  slowestWeldMs: 0,
  textureMs: 0,
  textures: 0,
  vertices: 0,
  weldMs: 0,
};

/**
 * Left-drag pans, right-drag orbits/tilts, the wheel dollies — the debugger map viewer's gestures. A left
 * press that travels less than {@link CLICK_SLOP} pixels is a CLICK, and clicks pick: the same button has to
 * serve both, or panning would deselect on every drag.
 */
function bindInput(canvas: HTMLCanvasElement, camera: ViewerCamera, game: ViewerMapGame): void {
  let dragging: null | { button: number; travel: number; x: number; y: number } = null;

  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('pointerdown', (event) => {
    dragging = { button: event.button, travel: 0, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointerup', (event) => {
    if (dragging && dragging.button === 0 && dragging.travel <= CLICK_SLOP) {
      const rect = canvas.getBoundingClientRect();
      const ndc: [number, number] = [
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((event.clientY - rect.top) / rect.height) * 2,
      ];
      game.pickAt(ndc, rect.width / Math.max(1, rect.height));
    }
    dragging = null;
    canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) {
      return;
    }
    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;
    dragging = {
      button: dragging.button,
      travel: dragging.travel + Math.abs(dx) + Math.abs(dy),
      x: event.clientX,
      y: event.clientY,
    };
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

/** One line per cell-set change, naming the SOURCE — a capture out of this tool is never silent about it. */
function report(map: LoadedMap, load: CellLoadStats, lod: boolean): void {
  // eslint-disable-next-line no-console -- the load record the plan's numbers are read from
  console.log(
    `[sa-map-viewer] ${load.cells} cells ${lod ? 'LOD' : 'HD'} from ${map.label} — ` +
      `welded ${load.cellsWelded} in ${load.weldMs} ms (median ${load.medianWeldMs}, slowest ${load.slowestWeldMs}), ` +
      `read ${(load.assetBytes / 1024 / 1024).toFixed(1)} MB in ${load.fetchMs} ms, ` +
      `${load.arrays} arrays / ${(load.textures / 1024 / 1024).toFixed(1)} MB in ${load.textureMs} ms, ` +
      `upload ${load.loadMs} ms, ${load.vertices} verts / ${load.indices / 3} tris`,
  );
}
