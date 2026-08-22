/**
 * Plan mode: the console with no 3D at all.
 *
 * The engine needs WebGPU, and a browser without it — an older phone, a locked-down build, a device whose GPU
 * is blocklisted — would otherwise get a dead screen and nothing else. But a dispatcher's actual job is on the
 * symbology layer, which is 2D by nature and already draws itself by projecting world points: hand it the same
 * camera and it produces a working map plan without a GPU in the picture.
 *
 * What is lost is the world — buildings, terrain, water. What survives is every unit, every call, their
 * positions, the selection, the scale bar, the gestures and the whole board. That is a usable fallback rather
 * than a consolation screen, and it is the same camera and the same code, so the two modes cannot drift.
 */

import type { GtaGround } from '../map/coords';
import type { Operations, Selection } from '../ops/types';
import type { BootOptions, DispatchHandle } from './boot';

import { gtaToEngine } from '../map/coords';
import { bindGestures } from '../map/gestures';
import { groundPoint, MAP_YAW, MapCamera, type MapProjection } from '../map/map-camera';
import { SymbologyLayer } from '../map/overlay-2d';
import { ScreenProjector } from '../map/projection';

/** Opening view. Higher than the 3D mode's: with no buildings to give scale, more ground reads better. */
const OPENING = {
  at: [1700, -1500] as GtaGround,
  height: 1400,
  pitch: -1.35,
  projection: 'perspective' as MapProjection,
  yaw: MAP_YAW,
};
/** Grid pitch in world units — the render grid, so the plan's squares mean something. */
const GRID = 250;
/** Draw at most this many grid lines per axis; past it the grid is noise and costs real time. */
const GRID_LINE_CAP = 60;
const READOUT_HZ = 4;

/** Plan mode never streams, so the board's own snapshot is all it reads. */
export type PlanModeOps = () => Operations;

/** Kept for symmetry with the 3D host's selection getter. */
export type PlanModeSelection = () => Selection;

export function bootPlanMode(options: BootOptions, why: string): DispatchHandle {
  const { canvas, overlay } = options;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = (): void => {
    overlay.width = Math.max(2, Math.floor(overlay.clientWidth * dpr));
    overlay.height = Math.max(2, Math.floor(overlay.clientHeight * dpr));
  };
  resize();
  new ResizeObserver(resize).observe(overlay);
  // The dead WebGPU canvas must not eat the gestures — in plan mode the overlay is the input surface.
  canvas.style.display = 'none';
  overlay.style.pointerEvents = 'auto';
  overlay.style.touchAction = 'none';

  const camera = new MapCamera(OPENING);
  const symbology = new SymbologyLayer();
  const projector = new ScreenProjector();
  const context = overlay.getContext('2d');
  if (!context) {
    throw new Error('overlay canvas has no 2d context');
  }

  const unbind = bindGestures(overlay, {
    dolly: (notch) => camera.dolly(notch),
    longPress: (x, y) => {
      const ground = groundPoint(ray(x, y));
      if (ground) {
        // Plan mode has no pak and therefore no baked district table — the board falls back to its own
        // landmark list, the same way the synthetic demo does.
        options.onGround(ground, null);
      }
    },
    orbit: (dx, dy) => camera.orbit(dx, dy),
    pan: (delta) => camera.pan(delta),
    tap: (x, y) => {
      const symbol = symbology.hitTest(x, y);
      options.onClick(symbol ?? { at: groundPoint(ray(x, y)) ?? [0, 0], kind: 'ground' });
    },
    zoomBy: (factor) => camera.zoomBy(factor),
  });

  function ray(x: number, y: number): ReturnType<MapCamera['rayAt']> {
    const rect = overlay.getBoundingClientRect();

    return camera.rayAt([(x / rect.width) * 2 - 1, 1 - (y / rect.height) * 2], rect.width / Math.max(1, rect.height));
  }

  const frames: number[] = [];
  let disposed = false;
  let lastReadout = 0;
  let previous = performance.now();

  const loop = (): void => {
    if (disposed) {
      return;
    }
    const now = performance.now();
    frames.push(now - previous);
    previous = now;
    if (frames.length > 60) {
      frames.shift();
    }
    const ops = options.ops();
    const size = { height: overlay.clientHeight, width: overlay.clientWidth };
    const state = camera.state(size.width / Math.max(1, size.height));
    projector.update(state, size.width, size.height);

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    drawGrid(context, projector, camera, size);
    symbology.render(context, projector, ops, options.selection(), size);

    if (now - lastReadout > 1000 / READOUT_HZ) {
      lastReadout = now;
      const average = frames.reduce((sum, value) => sum + value, 0) / Math.max(1, frames.length);
      options.onReadout({
        buildTime: `plan mode — ${why}`,
        cellsTotal: 0,
        cellsVisible: 0,
        draws: 0,
        fps: Math.round(1000 / Math.max(1, average)),
        hour: 12,
        pending: 0,
        pose: camera.pose(),
        residencyMb: 0,
      });
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return {
    camera,
    dispose(): void {
      disposed = true;
      unbind();
    },
    /** Nothing to inventory: plan mode draws no world, so there are no passes and no residency to count. */
    inventory(): null {
      return null;
    },
    locate(at: GtaGround): void {
      camera.zoomTo(at, 500);
    },
    setHour(): void {
      // Nothing to light.
    },
    setProjection(projection: MapProjection): void {
      camera.setProjection(projection);
    },
  };
}

/** The ground grid, projected like everything else so it tilts with the camera instead of faking a plan view. */
function drawGrid(
  ctx: CanvasRenderingContext2D,
  projector: ScreenProjector,
  camera: MapCamera,
  size: { readonly height: number; readonly width: number },
): void {
  const [cx, cy] = camera.positionGta();
  // Cover roughly what the eye can see, then cap the line count so a zoomed-out view cannot melt the CPU.
  const reach = Math.min(camera.height() * 2.2, GRID * GRID_LINE_CAP);
  const x0 = Math.floor((cx - reach) / GRID) * GRID;
  const y0 = Math.floor((cy - reach) / GRID) * GRID;
  const steps = Math.min(GRID_LINE_CAP, Math.ceil((reach * 2) / GRID));

  ctx.lineWidth = 1;
  for (let i = 0; i <= steps; i += 1) {
    const x = x0 + i * GRID;
    const y = y0 + i * GRID;
    ctx.strokeStyle = x % 1000 === 0 ? 'rgba(90, 118, 148, 0.55)' : 'rgba(60, 78, 98, 0.35)';
    segment(ctx, projector, [x, y0], [x, y0 + steps * GRID], size);
    ctx.strokeStyle = y % 1000 === 0 ? 'rgba(90, 118, 148, 0.55)' : 'rgba(60, 78, 98, 0.35)';
    segment(ctx, projector, [x0, y], [x0 + steps * GRID, y], size);
  }
}
/** One projected ground segment. Skipped whole when either end falls behind the eye — a clipped line is worse
 *  than a missing one, because a wrong-side projection draws straight across the screen. */
function segment(
  ctx: CanvasRenderingContext2D,
  projector: ScreenProjector,
  from: GtaGround,
  to: GtaGround,
  size: { readonly height: number; readonly width: number },
): void {
  const a = projector.project(gtaToEngine(from));
  const b = projector.project(gtaToEngine(to));
  if (!a || !b) {
    return;
  }
  const offscreen = (Math.min(a.x, b.x) > size.width && Math.min(a.y, b.y) > size.height) || (a.x < 0 && b.x < 0);
  if (offscreen) {
    return;
  }
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}
