/**
 * Engine lab entry (plan 074/04). M0: the synthetic district through the REAL path (formats → upload →
 * bundles → culling → MSAA+A2C pass), orbiting camera, the gate HUD. `?cells=N` (grid side, default 8),
 * `?boxes=N` (boxes per cell side, default 12), `?freeze=1` stops the orbit.
 */
import {
  type CameraState,
  Engine,
  type EngineStats,
  setupStreaming,
  type StreamingDriver,
  type StreamStats,
} from '@opensa/engine';

import {
  BENCH_SCENE_MEASURE,
  BENCH_SCENES,
  BenchCollector,
  downloadRecord,
  fetchConverterMetrics,
  formatRecord,
} from './bench';
import { type EnvironmentDriver, parametricDriver, timecycDriver } from './environment';
import { loadPak } from './pak-loader';
import { loadPedProbe } from './ped';
import { syntheticCell, syntheticTextureArray } from './synthetic';
import { loadVehicleProbe } from './vehicle';

const CELL_SIZE = 250;

/** `?ao=` / `?sunvis=` / `?wind=` / `?stoch=` A/B overrides (074/07, 074/06 row 10, 074/12). */
function applyEnvironmentOverrides(engine: Engine, params: URLSearchParams): void {
  const aoParam = Number(params.get('ao') ?? Number.NaN);
  if (Number.isFinite(aoParam)) {
    engine.environment.aoStrength = aoParam;
  }
  const sunVisParam = Number(params.get('sunvis') ?? Number.NaN);
  if (Number.isFinite(sunVisParam)) {
    engine.environment.sunVisStrength = sunVisParam;
  }
  const windParam = Number(params.get('wind') ?? Number.NaN);
  if (Number.isFinite(windParam)) {
    engine.environment.windStrength = windParam;
  }
  const stochParam = Number(params.get('stoch') ?? Number.NaN);
  if (Number.isFinite(stochParam)) {
    engine.environment.stochastic = stochParam;
  }
}

/** The M0 synthetic fixture: a grid of box cells through the real format path; returns recorded draws. */
function buildSyntheticDistrict(engine: Engine, gridSide: number, boxesPerSide: number): number {
  engine.textures.load(0, syntheticTextureArray());
  let recordedDraws = 0;
  for (let cx = 0; cx < gridSide; cx += 1) {
    for (let cy = 0; cy < gridSide; cy += 1) {
      const handle = engine.cells.load(`${cx},${cy},hd`, syntheticCell(cx, cy, CELL_SIZE, boxesPerSide));
      recordedDraws += handle.draws;
    }
  }

  return recordedDraws;
}

/** The steady-state HUD block (bench/leak modes replace it wholesale). */
function hudText(input: {
  buildMs: number;
  engineInfo: string;
  frames: readonly number[];
  pedLine: null | { ms: number; position: readonly [number, number, number] };
  stats: EngineStats;
  streamStats: null | StreamStats;
  title: string;
  vehicleMs: null | number;
}): string {
  const frameAvg = input.frames.reduce((sum, value) => sum + value, 0) / Math.max(1, input.frames.length);

  return (
    `engine lab — ${input.title}\n` +
    `device      ${input.engineInfo}\n` +
    `frame       ${frameAvg.toFixed(2)} ms (${(1000 / Math.max(frameAvg, 0.001)).toFixed(0)} fps), max ${Math.max(...input.frames).toFixed(0)}\n` +
    `submit CPU  ${input.stats.submitMs.toFixed(2)} ms\n` +
    `GPU pass    ${input.stats.gpuPassMs > 0 ? input.stats.gpuPassMs.toFixed(2) : 'n/a'} ms\n` +
    `cells       ${input.stats.cellsVisible}/${input.stats.cellsTotal} visible, draws ${input.stats.drawsRecorded}\n` +
    `residency   ${(input.stats.residencyBytes / (1024 * 1024)).toFixed(1)} MB\n` +
    `build       ${input.buildMs.toFixed(0)} ms (fixture, off the P0 clock)` +
    (input.pedLine
      ? `\nped sampler ${input.pedLine.ms.toFixed(2)} ms @ [${input.pedLine.position.map((value) => value.toFixed(0)).join(', ')}] (074/08 probe)`
      : '') +
    (input.vehicleMs !== null ? `\nvehicle upd ${input.vehicleMs.toFixed(2)} ms (074/08 B2 rigid entity)` : '') +
    (input.streamStats
      ? `\nstream      ${input.streamStats.loadedCells} loaded, ${input.streamStats.pendingCells} pending, ` +
        `${input.streamStats.created} created / ${input.streamStats.evicted} evicted, worst create ${input.streamStats.worstCreateMs.toFixed(1)} ms`
      : '')
  );
}

/** One frame of the `?test=leak` phases: sweep 600 frames → unloadAll → settle 60 → ledger compare. */
function leakStep(
  leakFrame: number,
  focus: [number, number, number],
  streaming: StreamingDriver,
  engine: Engine,
  leakBaseline: string,
  hud: HTMLPreElement,
): void {
  if (leakFrame < 600) {
    // Phase 1: sweep the focus across the district — load a wide set of cells.
    const t01 = leakFrame / 600;
    focus[0] += Math.sin(t01 * Math.PI * 2) * 6;
    focus[2] += Math.cos(t01 * Math.PI * 3) * 6;
  } else if (leakFrame === 600) {
    streaming.unloadAll();
    // eslint-disable-next-line no-console -- the leak test's phase marker IS its console protocol
    console.log('[leak] unloadAll issued');
  } else if (leakFrame === 660) {
    // Phase 3: settle 60 frames, then compare.
    const now = JSON.stringify(pick(engine.ledger()));
    const pass = now === leakBaseline;
    // eslint-disable-next-line no-console -- the leak verdict prints the ledger diff by design
    console[pass ? 'log' : 'error'](`[leak] ${pass ? 'PASS' : 'FAIL'}\nbaseline ${leakBaseline}\nnow      ${now}`);
    hud.style.background = pass ? 'rgba(10,60,16,0.85)' : 'rgba(80,10,10,0.85)';
  }
}

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
  const weather = Number(params.get('weather') ?? 0) || 0;
  let hour = Number.isFinite(hourParam) ? hourParam : 12;
  applyEnvironmentOverrides(engine, params);
  // Row 14: the environment driver — real timecyc when the manifest carries it, parametric fallback else.
  // Swapped in after the pak loads (the manifest arrives there); parametric until then.
  let environmentDriver: EnvironmentDriver = parametricDriver(engine);
  const applyEnvironment = (): void => environmentDriver.apply(hour);
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
    // `?src=pak-sf` streams an alternative converted district (default /pak) — e.g. the SF beams rect.
    const setup = await setupStreaming(engine, `/${params.get('src') ?? 'pak'}`);
    streaming = setup.driver;
    focus = setup.center;
    orbitRadius = setup.radius * 1.4;
    title = 'STREAMING district (worker pak, rings live)';
    if (setup.timecyc !== undefined) {
      const fogScale = Number(params.get('fogscale') ?? 2.5) || 2.5;
      environmentDriver = timecycDriver(engine, setup.timecyc, setup.timecyc24, weather, fogScale);
      applyEnvironment();
    }
  } else if (usePak) {
    const district = await loadPak(engine);
    recordedDraws = district.drawsRecorded;
    focus = district.center;
    orbitRadius = Math.max(district.radius * 1.6, 400);
    title = `converted district (${district.cellCount} cells, ${recordedDraws} recorded draws)`;
  } else {
    recordedDraws = buildSyntheticDistrict(engine, gridSide, boxesPerSide);
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
  // Skinning probe (074/08 B1): `?ped=1` drops the animated fixture ped at the focus point and STARTS the
  // camera zoomed onto it (a 1.8-unit ped is subpixel at a full-city orbit radius); wheel out to leave.
  let pedHost: Awaited<ReturnType<typeof loadPedProbe>> | null = null;
  let pedMs = 0;
  let pedPosition: [number, number, number] | null = null;
  if (params.get('ped') === '1') {
    const pedY = Number(params.get('pedy') ?? focus[1]) || focus[1];
    pedPosition = [focus[0], pedY, focus[2]];
    pedHost = await loadPedProbe(engine, pedPosition);
    zoom = Math.min(1, 14 / orbitRadius);
  }
  // Rigid-entity probe (074/08 B2c): `?vehicle=1` drives the fixture vehicle in a circle around the focus.
  let vehicleHost: Awaited<ReturnType<typeof loadVehicleProbe>> | null = null;
  let vehicleMs = 0;
  if (params.get('vehicle') === '1') {
    const vehicleY = Number(params.get('pedy') ?? focus[1]) || focus[1];
    vehicleHost = await loadVehicleProbe(engine, [focus[0], vehicleY, focus[2]]);
    zoom = Math.min(zoom, 55 / orbitRadius);
  }
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
  // WASD pans the orbit FOCUS — the streaming rings follow the focus, so this is how you travel the
  // full-city pak in the lab (the standalone page has the true fly camera).
  const held = new Set<string>();
  window.addEventListener('keydown', (event) => held.add(event.code));
  window.addEventListener('keyup', (event) => held.delete(event.code));

  // Leak assertion (M1 tail, `?test=leak` with streaming): load a sweep of cells, unload ALL, and the
  // residency ledger must return to its post-texture baseline — buffers leak loudly, not silently.
  const leakTest = params.get('test') === 'leak' && streaming !== null;
  const leakBaseline = leakTest ? JSON.stringify(pick(engine.ledger())) : '';
  let leakFrame = 0;

  // Bench mode (074/11): deterministic scene script + warmup/measure collection, then a JSON record.
  const benchScene = params.get('bench');
  if (benchScene && leakTest) {
    throw new Error(
      '`?test=leak` and `?bench=` are mutually exclusive — the leak phases halt streaming and invalidate the bench window',
    );
  }
  const benchScript = benchScene ? BENCH_SCENES[benchScene] : null;
  if (benchScene && !benchScript) {
    throw new Error(`unknown bench scene '${benchScene}' (have: ${Object.keys(BENCH_SCENES).join(', ')})`);
  }
  const collector = new BenchCollector(benchScene ? BENCH_SCENE_MEASURE[benchScene] : undefined);
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
    if (held.size > 0) {
      panFocus(focus, held, angle, Math.min(2000, Math.max(60, orbitRadius * zoom)) * (frameDt / 1000) * 1.2);
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
    if (leakTest && streaming) {
      leakFrame += 1;
      leakStep(leakFrame, focus, streaming, engine, leakBaseline, hud);
    }
    let streamStats: null | StreamStats = null;
    if (streaming && !(leakTest && leakFrame >= 600)) {
      // Rings follow the camera TARGET (the ground focus — the "player"), not the eye: an orbiting eye sits
      // outside the LOD ring and would stream nothing. In leak mode the driver STOPS after unloadAll —
      // otherwise it would immediately re-stream the rings and fail the comparison by design.
      streamStats = streaming.update(camera.target);
    }
    if (pedHost) {
      pedMs = pedHost.update(now / 1000);
    }
    if (vehicleHost) {
      vehicleMs = vehicleHost.update(now / 1000);
    }
    const stats = engine.frame(camera);
    if (benchScript && !benchDone) {
      collector.sample(frameDt, stats);
      if (!collector.running) {
        benchDone = true;
        const record = collector.finish(benchScene ?? '?', engine.adapterInfo, canvas);
        // Converter metrics ride the record (074/11) — tool regressions get caught by the same ritual.
        void fetchConverterMetrics(`/${params.get('src') ?? 'pak'}`).then((converter) => {
          if (converter) {
            record.converter = converter;
          }
          downloadRecord(record);
        });
        hud.textContent = formatRecord(record);

        return; // freeze the loop on the summary
      }
    }
    hud.textContent = hudText({
      buildMs,
      engineInfo: engine.adapterInfo,
      frames,
      pedLine: pedHost && pedPosition ? { ms: pedMs, position: pedPosition } : null,
      stats,
      streamStats,
      title,
      vehicleMs: vehicleHost ? vehicleMs : null,
    });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/** WASD pans the orbit FOCUS — streaming rings follow it (how you travel a full-city pak in the lab). */
function panFocus(focus: [number, number, number], held: ReadonlySet<string>, angle: number, pan: number): void {
  const fx = -Math.cos(angle);
  const fz = -Math.sin(angle);
  if (held.has('KeyW')) {
    focus[0] += fx * pan;
    focus[2] += fz * pan;
  }
  if (held.has('KeyS')) {
    focus[0] -= fx * pan;
    focus[2] -= fz * pan;
  }
  if (held.has('KeyA')) {
    focus[0] += fz * pan;
    focus[2] -= fx * pan;
  }
  if (held.has('KeyD')) {
    focus[0] -= fz * pan;
    focus[2] += fx * pan;
  }
}

/** Leak-relevant ledger categories (targets resize with the canvas; textures persist by design). */
function pick(
  ledger: Record<string, { bytes: number; count: number }>,
): Record<string, { bytes: number; count: number }> {
  return { cellIndex: ledger.cellIndex, cellVertex: ledger.cellVertex, uniform: ledger.uniform };
}

main().catch((error: unknown) => {
  const hud = document.getElementById('hud');
  if (hud) {
    hud.textContent = `engine failed:\n${error instanceof Error ? error.message : String(error)}`;
    hud.style.color = '#f66';
  }
});
