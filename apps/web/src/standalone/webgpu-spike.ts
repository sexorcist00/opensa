/**
 * Phase-0/1a WebGPU spike (docs/concepts/webgpu-migration/phase-0-spike-checklist.md). THROWAWAY.
 *
 * Phase 0 — does a WebGPU render bundle (`BundleGroup`) collapse CPU draw-submission for a large static draw list?
 *   /webgpu-spike.html                 → WebGPU + BundleGroup (record-once)
 *   /webgpu-spike.html?bundle=0        → WebGPU, plain Group (no bundle — Level-1 only)
 *   /webgpu-spike.html?mode=webgl      → WebGL baseline
 *   &count=15000                       → draw count (default 15000, ≈ ls-noon)
 *
 * Phase 1a — does PER-CELL bundle invalidation stay cheap when one cell "swaps" (the streaming gate)?
 *   /webgpu-spike.html?cells=100&swap=30   → 100 per-cell BundleGroups; re-record ONE cell every 30 frames.
 *   The HUD shows steady render CPU (all cells replayed) vs the swap-frame CPU (one cell re-records). GO if the
 *   swap frame is close to steady (re-record cost ≈ one cell, not the world → no boundary hitch).
 */
import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

const params = new URLSearchParams(window.location.search);
const COUNT = Number(params.get('count') ?? 15000);
const MODE = params.get('mode') ?? 'webgpu'; // 'webgpu' | 'webgl'
const BUNDLE = params.get('bundle') !== '0';
const CELLS = Number(params.get('cells') ?? 0); // >0 → Phase-1a streaming scenario (webgpu)
const SWAP = Number(params.get('swap') ?? 30); // re-record one cell every SWAP frames
const WARMUP = 30;
const WINDOW = 120;

const canvas = document.createElement('canvas');
canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
document.body.append(canvas);

const readout = document.createElement('pre');
readout.style.cssText =
  'position:fixed;top:12px;left:12px;margin:0;padding:10px 12px;background:rgba(0,0,0,.7);color:#0f0;' +
  'font:13px monospace;border-radius:6px;white-space:pre;z-index:10';
document.body.append(readout);

const geometry = new BoxGeometry(1, 1, 1);
const SIDE = Math.ceil(Math.cbrt(COUNT));

function boxAt(material: Mesh['material'], index: number): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(
    ((index % SIDE) - SIDE / 2) * 2.2,
    ((Math.floor(index / SIDE) % SIDE) - SIDE / 2) * 2.2,
    (Math.floor(index / (SIDE * SIDE)) - SIDE / 2) * 2.2,
  );
  mesh.frustumCulled = false; // every mesh submits every frame — reproduce the worst-case draw count

  return mesh;
}

function loopRender(
  renderer: { render(scene: Scene, camera: PerspectiveCamera): unknown },
  scene: Scene,
  camera: PerspectiveCamera,
  meter: (ms: number, fps: number) => void,
): void {
  let last = performance.now();
  const loop = (): void => {
    const now = performance.now();
    const fps = 1000 / (now - last);
    last = now;
    camera.rotation.y += 0.002;
    const t0 = performance.now();
    void renderer.render(scene, camera);
    meter(performance.now() - t0, fps);
    requestAnimationFrame(loop);
  };
  loop();
}

function makeCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100000);
  camera.position.set(0, 0, SIDE * 2.4);

  return camera;
}

/** Rolling average of the synchronous `render()` CPU time (skips warmup). */
function makeMeter(label: string): (ms: number, fps: number) => void {
  const samples: number[] = [];
  let frame = 0;

  return (ms, fps) => {
    frame += 1;
    if (frame > WARMUP) {
      samples.push(ms);
      if (samples.length > WINDOW) {
        samples.shift();
      }
    }
    const avg = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
    readout.textContent =
      `${label}\ndraws        ${COUNT}\nrender CPU   ${avg.toFixed(2)} ms   (this frame ${ms.toFixed(2)})\n` +
      `fps          ${fps.toFixed(1)}\nframe ${frame}${frame <= WARMUP ? ' (warmup…)' : ''}`;
  };
}

function palette<T>(make: (color: Color) => T): T[] {
  return Array.from({ length: 8 }, (_, i) => make(new Color().setHSL(i / 8, 0.6, 0.5)));
}

function runWebGl(): void {
  const renderer = new WebGLRenderer({ antialias: false, canvas });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  const scene = new Scene();
  const materials = palette((color) => new MeshBasicMaterial({ color }));
  const group = new Group();
  for (let i = 0; i < COUNT; i += 1) {
    group.add(boxAt(materials[i % 8], i));
  }
  scene.add(group);
  loopRender(renderer, scene, makeCamera(), makeMeter('WebGL baseline'));
}

async function runWebGpuFlat(): Promise<void> {
  const { BundleGroup, MeshBasicNodeMaterial, WebGPURenderer } = await import('three/webgpu');
  const renderer = new WebGPURenderer({ antialias: false, canvas });
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  await renderer.init();
  const scene = new Scene();
  const materials = palette((color) => new MeshBasicNodeMaterial({ color }));
  const container = BUNDLE ? new BundleGroup() : new Group();
  for (let i = 0; i < COUNT; i += 1) {
    container.add(boxAt(materials[i % 8], i));
  }
  scene.add(container);
  loopRender(
    renderer,
    scene,
    makeCamera(),
    makeMeter(`WebGPU ${BUNDLE ? '+ BundleGroup (record-once)' : '(no bundle)'}`),
  );
}

/** Phase-1a: one BundleGroup per "cell"; re-record ONE cell every SWAP frames and time that frame vs steady. */
async function runWebGpuStreaming(): Promise<void> {
  const { BundleGroup, MeshBasicNodeMaterial, WebGPURenderer } = await import('three/webgpu');
  const renderer = new WebGPURenderer({ antialias: false, canvas });
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  await renderer.init();
  const scene = new Scene();
  const camera = makeCamera();
  const materials = palette((color) => new MeshBasicNodeMaterial({ color }));
  const perCell = Math.max(1, Math.floor(COUNT / CELLS));
  const cells: Group[] = [];
  const fill = (cell: Group, seed: number): void => {
    cell.clear();
    for (let i = 0; i < perCell; i += 1) {
      cell.add(boxAt(materials[(seed + i) % 8], seed * perCell + i));
    }
  };
  for (let c = 0; c < CELLS; c += 1) {
    const cell = new BundleGroup();
    fill(cell, c);
    scene.add(cell);
    cells.push(cell);
  }

  const steady: number[] = [];
  let swapMax = 0;
  let swapLast = 0;
  let frame = 0;
  let last = performance.now();
  const loop = (): void => {
    const now = performance.now();
    const fps = 1000 / (now - last);
    last = now;
    frame += 1;
    const swapping = SWAP > 0 && frame % SWAP === 0 && frame > WARMUP;
    if (swapping) {
      const cell = cells[(frame / SWAP) % CELLS];
      fill(cell, frame); // new geometry for this cell only
      (cell as unknown as { needsUpdate: boolean }).needsUpdate = true; // re-record THIS cell's bundle only
    }
    camera.rotation.y += 0.002;
    const t0 = performance.now();
    void renderer.render(scene, camera);
    const dt = performance.now() - t0;
    if (frame > WARMUP) {
      if (swapping) {
        swapLast = dt;
        swapMax = Math.max(swapMax, dt);
      } else {
        steady.push(dt);
        if (steady.length > WINDOW) {
          steady.shift();
        }
      }
    }
    const steadyAvg = steady.length ? steady.reduce((a, b) => a + b, 0) / steady.length : 0;
    readout.textContent =
      `WebGPU streaming — ${CELLS} per-cell bundles, ${perCell} draws/cell (${COUNT} total)\n` +
      `steady render CPU   ${steadyAvg.toFixed(2)} ms   (all cells replayed)\n` +
      `swap-frame CPU      last ${swapLast.toFixed(2)} ms   max ${swapMax.toFixed(2)} ms   (1 cell re-records)\n` +
      `fps ${fps.toFixed(1)}   frame ${frame}\n` +
      `GO if swap ≈ steady (re-record cost ≈ one cell, not the world)`;
    requestAnimationFrame(loop);
  };
  loop();
}

readout.textContent = `starting ${MODE}…`;
if (MODE === 'webgl') {
  runWebGl();
} else {
  const run = CELLS > 0 ? runWebGpuStreaming : runWebGpuFlat;
  void run().catch((error: unknown) => {
    readout.style.color = '#f66';
    readout.textContent = `WebGPU failed:\n${error instanceof Error ? error.message : String(error)}`;
  });
}
