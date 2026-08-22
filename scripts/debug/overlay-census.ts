/**
 * What the console's 2D layers ASK OF THE CANVAS per frame (201/7-04, 7-05) — the desk half of the two
 * insets' cost.
 *
 * The same method as [5/02's symbology count](../../docs/benchmarks/opensa-engine/2026-08-21-dispatch-symbology-call-counts.json):
 * the layers are driven with a stub `CanvasRenderingContext2D` that records calls, so what is measured is
 * how much work they REQUEST, never how long a browser takes to do it. Milliseconds belong to a device run
 * ([2/03](../../docs/plans/201-dispatch-console/2-real-device-truth/readme.md)).
 *
 * Two questions it exists to answer:
 *
 * - **the radar's repaint** — what one costs, and how often it happens. Its dirty check is the whole of its
 *   answer to [chain 4](../../docs/plans/201-dispatch-console/4-a-console-is-not-a-game/readme.md): an inset
 *   that repaints every frame would defeat render-on-demand before it is built.
 * - **the sketches** — what N annotations cost, which is [7/05](../../docs/plans/201-dispatch-console/7-the-operator-map/readme.md)'s
 *   owed number.
 *
 * Run:
 *
 * ```sh
 * npx tsx scripts/debug/overlay-census.ts [--units 150] [--calls 40] [--shapes 10] [--json out.json]
 * ```
 */
import { writeFileSync } from 'node:fs';

import type { GtaGround } from '../../apps/dispatch/src/map/coords';
import type { MinimapFrame, MinimapWorld } from '../../apps/dispatch/src/map/minimap';
import type { Incident, Operations, Unit } from '../../apps/dispatch/src/ops/types';

import { MinimapLayer } from '../../apps/dispatch/src/map/minimap';
import { drawSketches, SketchStore } from '../../apps/dispatch/src/map/sketch';

/** The board 201's budget table declares as the worst case. */
const UNITS = 150;
const CALLS = 40;
/** Los Santos ships ~120 zones; a total conversion may carry more, so the census runs a generous city. */
const BOXES = 160;
const SHAPES = 10;
const POINTS_PER_SHAPE = 8;

interface Counter {
  calls: number;
  ctx: CanvasRenderingContext2D;
}

function board(units: number, calls: number): Operations {
  return {
    incidents: Array.from(
      { length: calls },
      (_, i): Incident => ({
        assigned: [],
        at: [1000 + i * 7, -1500 - i * 5],
        code: '10-50',
        id: `i${String(i)}`,
        opened: 0,
        place: 'Somewhere',
        priority: ((i % 3) + 1) as 1 | 2 | 3,
        remaining: 30,
        status: 'pending',
        title: 'Call',
      }),
    ),
    log: [],
    now: 0,
    units: Array.from(
      { length: units },
      (_, i): Unit => ({
        at: [900 + i * 11, -1400 - i * 9],
        callsign: `4-X-${String(i)}`,
        heading: 0,
        id: `u${String(i)}`,
        incident: null,
        kind: 'patrol',
        status: (['available', 'busy', 'enRoute', 'onScene'] as const)[i % 4],
        target: null,
      }),
    ),
  };
}

/** A context that counts every drawing call made on it. What it draws is not the point; how much is. */
function counter(): Counter {
  const state = { calls: 0 };
  const bump = () => (): void => {
    state.calls += 1;
  };
  const ctx = {
    arc: bump(),
    beginPath: bump(),
    clearRect: bump(),
    clip: bump(),
    closePath: bump(),
    fill: bump(),
    fillRect: bump(),
    fillStyle: '',
    fillText: bump(),
    font: '',
    lineJoin: 'round',
    lineTo: bump(),
    lineWidth: 0,
    measureText: (text: string): TextMetrics => {
      state.calls += 1;

      return { width: text.length * 6 } as TextMetrics;
    },
    moveTo: bump(),
    rect: bump(),
    restore: bump(),
    save: bump(),
    setLineDash: bump(),
    stroke: bump(),
    strokeStyle: '',
    textAlign: 'center',
    textBaseline: 'middle',
  } as unknown as CanvasRenderingContext2D;

  return {
    get calls(): number {
      return state.calls;
    },
    ctx,
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const read = (flag: string, fallback: number): number => {
    const at = args.indexOf(flag);

    return at < 0 ? fallback : Number(args[at + 1]) || fallback;
  };
  const units = read('--units', UNITS);
  const calls = read('--calls', CALLS);
  const shapes = read('--shapes', SHAPES);
  const ops = board(units, calls);
  const world = minimapWorld(BOXES);

  const layer = new MinimapLayer();
  const first = counter();
  layer.render(first.ctx, radarFrame(ops, world, [1500, -1700]));
  const still = counter();
  const repainted = layer.render(still.ctx, radarFrame(ops, world, [1500, -1700]));
  const moved = counter();
  layer.render(moved.ctx, radarFrame(ops, world, [1520, -1700]));

  const store = new SketchStore();
  for (let shape = 0; shape < shapes; shape += 1) {
    store.setTool('area');
    for (let point = 0; point < POINTS_PER_SHAPE; point += 1) {
      store.addPoint([1000 + shape * 30 + point * 12, -1500 - point * 9]);
    }
    store.finish();
  }
  const sketchCounter = counter();
  drawSketches(sketchCounter.ctx, (at) => ({ x: at[0] / 10, y: -at[1] / 10 }), store);

  const report = {
    note:
      `A DESK COUNT, not a timing: the layers are driven with a stub 2D context that records calls. Board ` +
      `${String(units)} units + ${String(calls)} calls, ${String(BOXES)} district boxes, ` +
      `${String(shapes)} sketches of ${String(POINTS_PER_SHAPE)} points, radar 132 CSS px.`,
    readings: {
      radarRepaintCalls: moved.calls,
      radarSkipCalls: still.calls,
      radarSkipped: !repainted,
      sketchCalls: sketchCounter.calls,
      sketchCallsPerShape: Math.round(sketchCounter.calls / Math.max(1, shapes)),
    },
  };
  console.log(JSON.stringify(report, null, 2));
  const jsonAt = args.indexOf('--json');
  if (jsonAt >= 0 && args[jsonAt + 1]) {
    writeFileSync(args[jsonAt + 1], `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nwrote ${args[jsonAt + 1]}`);
  }
}

function minimapWorld(boxes: number): MinimapWorld {
  return {
    boxes: Array.from({ length: boxes }, (_, i) => ({
      max: [i * 20 + 200, i * 15 + 200] as const,
      min: [i * 20, i * 15] as const,
    })),
    centre: [1500, -1700],
    radius: 3000,
  };
}

function radarFrame(ops: Operations, world: MinimapWorld, at: GtaGround): MinimapFrame {
  return {
    footprint: [
      [at[0] - 300, at[1] - 300],
      [at[0] + 300, at[1] - 400],
      [at[0] + 400, at[1] + 500],
      [at[0] - 400, at[1] + 400],
    ],
    ops,
    pose: { at, height: 700, pitch: -1.1, projection: 'perspective', yaw: Math.PI },
    selection: null,
    size: 132,
    world,
  };
}

main();
