/**
 * Phase-0 WebGPU spike (docs/concepts/webgpu-migration/phase-0-spike-checklist.md). THROWAWAY.
 *
 * The one question: does a WebGPU render bundle (`BundleGroup`) collapse the CPU draw-submission cost for a large
 * static draw list, the way our streamed world needs? This isolates that variable with synthetic geometry that
 * reproduces the *draw count* (frustum culling off → every mesh submits every frame), so the number is comparable
 * to the engine's ~14.8k-draw / ~65ms-CPU `ls-noon` baseline.
 *
 * Open (dev only):
 *   /webgpu-spike.html                 → WebGPU + BundleGroup (the record-once case)
 *   /webgpu-spike.html?bundle=0        → WebGPU, plain Group (no bundle — Level-1 only)
 *   /webgpu-spike.html?mode=webgl      → WebGL baseline (expect ~the engine's per-draw cost)
 *   &count=15000                       → draw count (default 15000, ≈ ls-noon)
 *
 * The deliverable is the on-screen `render CPU` number across the three runs → fill the table in the checklist.
 */
import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

const params = new URLSearchParams(window.location.search);
const COUNT = Number(params.get('count') ?? 15000);
const MODE = params.get('mode') ?? 'webgpu'; // 'webgpu' | 'webgl'
const BUNDLE = params.get('bundle') !== '0'; // default on for webgpu
const WARMUP = 30; // frames to skip before averaging
const WINDOW = 120; // frames averaged

const canvas = document.createElement('canvas');
canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
document.body.append(canvas);

const readout = document.createElement('pre');
readout.style.cssText =
  'position:fixed;top:12px;left:12px;margin:0;padding:10px 12px;background:rgba(0,0,0,.7);color:#0f0;' +
  'font:13px monospace;border-radius:6px;white-space:pre;z-index:10';
document.body.append(readout);

function makeCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100000);
  camera.position.set(0, 0, Math.ceil(Math.cbrt(COUNT)) * 2.4);

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
      `${label}\n` +
      `draws        ${COUNT}\n` +
      `render CPU   ${avg.toFixed(2)} ms   (this frame ${ms.toFixed(2)})\n` +
      `fps          ${fps.toFixed(1)}\n` +
      `frame ${frame}${frame <= WARMUP ? ' (warmup…)' : ''}`;
  };
}

/** A grid of `COUNT` separate boxes (shared geometry, a few materials) → one draw call each, culling disabled. */
function populate(container: Group, material: (i: number) => Mesh['material']): void {
  const geometry = new BoxGeometry(1, 1, 1);
  const side = Math.ceil(Math.cbrt(COUNT));
  for (let i = 0; i < COUNT; i += 1) {
    const mesh = new Mesh(geometry, material(i));
    mesh.position.set(
      ((i % side) - side / 2) * 2.2,
      ((Math.floor(i / side) % side) - side / 2) * 2.2,
      (Math.floor(i / (side * side)) - side / 2) * 2.2,
    );
    mesh.frustumCulled = false; // every mesh submits every frame — reproduce the worst-case draw count
    container.add(mesh);
  }
}

function runWebGl(): void {
  const renderer = new WebGLRenderer({ antialias: false, canvas });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new Scene();
  const camera = makeCamera();
  const container = new Group();
  const palette = Array.from(
    { length: 8 },
    (_, i) => new MeshBasicMaterial({ color: new Color().setHSL(i / 8, 0.6, 0.5) }),
  );
  populate(container, (i) => palette[i % palette.length]);
  scene.add(container);

  const meter = makeMeter('WebGL baseline');
  let last = performance.now();
  const loop = (): void => {
    const now = performance.now();
    const fps = 1000 / (now - last);
    last = now;
    camera.rotation.y += 0.002;
    const t0 = performance.now();
    renderer.render(scene, camera);
    meter(performance.now() - t0, fps);
    requestAnimationFrame(loop);
  };
  loop();
}

async function runWebGpu(): Promise<void> {
  const { BundleGroup, MeshBasicNodeMaterial, WebGPURenderer } = await import('three/webgpu');
  const renderer = new WebGPURenderer({ antialias: false, canvas });
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  await renderer.init();

  const scene = new Scene();
  const camera = makeCamera();
  const container = BUNDLE ? new BundleGroup() : new Group();
  if (BUNDLE) {
    (container as unknown as { static: boolean }).static = true; // record once, replay each frame
  }
  const palette = Array.from(
    { length: 8 },
    (_, i) => new MeshBasicNodeMaterial({ color: new Color().setHSL(i / 8, 0.6, 0.5) }),
  );
  populate(container, (i) => palette[i % palette.length]);
  scene.add(container);

  const meter = makeMeter(`WebGPU ${BUNDLE ? '+ BundleGroup (record-once)' : '(plain Group, no bundle)'}`);
  let last = performance.now();
  const loop = (): void => {
    const now = performance.now();
    const fps = 1000 / (now - last);
    last = now;
    camera.rotation.y += 0.002; // keep it a live render
    const t0 = performance.now();
    void renderer.render(scene, camera);
    meter(performance.now() - t0, fps);
    requestAnimationFrame(loop);
  };
  loop();
}

readout.textContent = `starting ${MODE}…`;
if (MODE === 'webgl') {
  runWebGl();
} else {
  void runWebGpu().catch((error: unknown) => {
    readout.style.color = '#f66';
    readout.textContent = `WebGPU failed:\n${error instanceof Error ? error.message : String(error)}`;
  });
}
