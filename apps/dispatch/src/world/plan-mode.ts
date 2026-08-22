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
import type { SharedView } from '../map/view-link';
import type { Operations, Selection } from '../ops/types';
import type { BootOptions, DispatchHandle, DispatchReadout, ZoomLevel } from './boot';
import type { SearchedPlace } from './zones';

import { gtaToEngine } from '../map/coords';
import { bindGestures } from '../map/gestures';
import { bindKeys } from '../map/keys';
import { groundPoint, MAP_YAW, MapCamera, type MapProjection } from '../map/map-camera';
import { SymbologyLayer } from '../map/overlay-2d';
import { ScreenProjector } from '../map/projection';
import { drawSketches, type MapTool, SketchStore } from '../map/sketch';
import { viewOfPose } from '../map/view-link';
import { applyHeldKeys, IDLE_WAKE_MS, runCommand, zoomSpan } from './boot';
import { composeImage } from './capture';
import { RenderGate } from './render-gate';
import { NO_DISTRICTS } from './zones';

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
  // Measuring works here too, and deliberately: plan mode IS a 2D map, so a ruler and a cordon are exactly
  // what it is good at — and 201/7-05's shapes are symbology, which is the half of the console that survives
  // having no GPU (201/7's verification asks every capability to work in every mode or say why not).
  const sketch = new SketchStore();
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
      if (sketch.tool() !== 'none') {
        const ground = groundPoint(ray(x, y));
        if (ground) {
          sketch.addPoint(ground);
        }

        return;
      }
      const symbol = symbology.hitTest(x, y);
      options.onClick(symbol ?? { at: groundPoint(ray(x, y)) ?? [0, 0], kind: 'ground' });
    },
    zoomBy: (factor) => camera.zoomBy(factor),
  });

  // The same keyboard the 3D map has: plan mode is the fallback an operator may work a whole shift in, not
  // a consolation screen, and a map with no keys on a machine with no GPU is exactly the wrong trade.
  const zoomLevel = (level: ZoomLevel): void =>
    camera.flyTo(
      camera.positionGta(),
      zoomSpan(level, camera.positionGta(), { districts: NO_DISTRICTS, reach: camera.maxSpan() / 2 }),
    );
  const keyboard = bindKeys(window, (command) =>
    runCommand(command, {
      camera,
      fit: () => camera.fitBounds(boardPoints()),
      followSelected: () => followSelected(),
      options,
      zoomLevel,
    }),
  );

  /** Every point an operator is working right now — the same set the 3D host fits. */
  function boardPoints(): readonly GtaGround[] {
    const ops = options.ops();

    return [
      ...ops.units.map((unit) => unit.at),
      ...ops.incidents.filter((incident) => incident.status !== 'closed').map((incident) => incident.at),
    ];
  }

  function followSelected(): void {
    const selection = options.selection();
    camera.follow(
      camera.following() || selection?.kind !== 'unit'
        ? null
        : () => options.ops().units.find((unit) => unit.id === selection.id)?.at ?? null,
    );
  }

  function ray(x: number, y: number): ReturnType<MapCamera['rayAt']> {
    const rect = overlay.getBoundingClientRect();

    return camera.rayAt([(x / rect.width) * 2 - 1, 1 - (y / rect.height) * 2], rect.width / Math.max(1, rect.height));
  }

  const frames: number[] = [];
  let disposed = false;
  let lastReadout = 0;
  let previous = performance.now();
  // Render on demand (201/4-01), for the same reason the 3D mode has it and more so: this is the fallback a
  // WEAK device gets, and redrawing a still plan sixty times a second is the last thing such a machine needs.
  const gate = new RenderGate();
  let idleTimer: null | ReturnType<typeof setTimeout> = null;
  const schedule = (idle: boolean): void => {
    if (disposed) {
      return;
    }
    if (idle) {
      idleTimer = setTimeout(loop, IDLE_WAKE_MS);
    } else {
      requestAnimationFrame(loop);
    }
  };
  const wake = (): void => {
    gate.wake();
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
      requestAnimationFrame(loop);
    }
  };
  for (const event of ['pointerdown', 'wheel'] as const) {
    overlay.addEventListener(event, wake, { passive: true });
  }
  window.addEventListener('keydown', wake, { passive: true });
  let idleReported = false;
  let lastPayload: DispatchReadout | null = null;

  const loop = (): void => {
    if (disposed) {
      return;
    }
    const now = performance.now();
    const dt = now - previous;
    frames.push(dt);
    previous = now;
    if (frames.length > 60) {
      frames.shift();
    }
    const ops = options.ops();
    // Plan mode's zoom keys fly like the 3D mode's, so its loop samples the flight too — one nobody
    // advances is a camera frozen at take-off until the next input cancels it.
    applyHeldKeys(camera, keyboard, dt);
    camera.advance(dt);
    const size = { height: overlay.clientHeight, width: overlay.clientWidth };
    if (
      !gate.shouldDraw({
        canvas: size.width * size.height,
        created: 0,
        evicted: 0,
        hour: 12,
        ops,
        pending: 0,
        pose: camera.pose(),
        selection: options.selection(),
        sketch: sketch.revision(),
      })
    ) {
      if (!idleReported && lastPayload !== null) {
        idleReported = true;
        options.onReadout({ ...lastPayload, idle: true });
      }
      schedule(true);

      return;
    }
    idleReported = false;
    const state = camera.state(size.width / Math.max(1, size.height));
    projector.update(state, size.width, size.height);

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    drawGrid(context, projector, camera, size);
    symbology.render(context, projector, ops, options.selection(), size);
    drawSketches(context, (at) => projector.project(gtaToEngine(at)), sketch);

    if (now - lastReadout > 1000 / READOUT_HZ) {
      lastReadout = now;
      const average = frames.reduce((sum, value) => sum + value, 0) / Math.max(1, frames.length);
      lastPayload = {
        buildTime: `plan mode — ${why}`,
        cellsTotal: 0,
        cellsVisible: 0,
        draws: 0,
        following: camera.following(),
        fps: Math.round(1000 / Math.max(1, average)),
        hour: 12,
        idle: false,
        idleFrames: gate.idleFrames,
        measurement: sketch.measurement(),
        namesHidden: symbology.counted().chipsDropped,
        pending: 0,
        pose: camera.pose(),
        residencyMb: 0,
        tool: sketch.tool(),
      };
      options.onReadout(lastPayload);
    }
    schedule(false);
  };
  requestAnimationFrame(loop);

  return {
    camera,
    dispose(): void {
      disposed = true;
      keyboard.unbind();
      unbind();
      for (const event of ['pointerdown', 'wheel'] as const) {
        overlay.removeEventListener(event, wake);
      }
      window.removeEventListener('keydown', wake);
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    },
    /**
     * Plan mode has ONE canvas — the overlay is the whole picture here — so the export composes it with
     * itself rather than with a WebGPU layer that does not exist. What comes out says `plan mode` in its
     * stamp through the build label the host passed in, which is what an image of a GPU-less shift should
     * say on its face.
     */
    exportImage(): Promise<Blob | null> {
      return composeImage(overlay, overlay, {
        build: `plan mode — ${why}`,
        district: '',
        pose: camera.pose(),
      });
    },
    faceNorth(): void {
      camera.turnTo(MAP_YAW);
    },
    fitBoard(): void {
      const ops = options.ops();
      camera.fitBounds([
        ...ops.units.map((unit) => unit.at),
        ...ops.incidents.filter((incident) => incident.status !== 'closed').map((incident) => incident.at),
      ]);
    },
    follow(id: null | string): void {
      camera.follow(id === null ? null : () => options.ops().units.find((unit) => unit.id === id)?.at ?? null);
    },
    goToPlace(place: SearchedPlace): void {
      camera.fitBounds([place.min, place.max]);
    },
    /** Nothing to inventory: plan mode draws no world, so there are no passes and no residency to count. */
    inventory(): null {
      return null;
    },
    locate(at: GtaGround): void {
      camera.flyTo(at, 500);
    },
    pose: () => camera.pose(),
    recallView(pose): void {
      camera.flyToPose(pose);
    },
    /** Plan mode streams no pak, so there is no baked district table to search — and nothing to invent. */
    searchPlaces: () => [],
    setBindings(next): void {
      keyboard.setBindings(next);
    },
    setHour(): void {
      // Nothing to light.
    },
    setProjection(projection: MapProjection): void {
      camera.setProjection(projection);
    },
    setTool(tool: MapTool): void {
      sketch.setTool(tool);
    },
    setZoomLevel(level: ZoomLevel): void {
      // Plan mode has no world to measure: no pak, no ring, and no baked districts. So "everything there
      // is" is the widest view the camera's own bounds allow, and the middle level falls back to the
      // geometric mean the same way it does on a pak with no zone table.
      zoomLevel(level);
    },
    sharedView: (): SharedView => viewOfPose(camera.pose()),
    sketchClear(): void {
      sketch.clear();
    },
    sketchFinish(): void {
      sketch.finish();
    },
    sketchUndo(): void {
      sketch.undo();
    },
    tiltBy(radians: number): void {
      camera.tiltBy(radians);
    },
    turnBy(radians: number): void {
      camera.turnTo(camera.pose().yaw + radians);
    },
    zoomBySteps(steps: number): void {
      camera.flyTo(camera.positionGta(), camera.span() * 2 ** -steps);
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
