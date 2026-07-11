/**
 * Babylon.js spike (docs/plans/073-webgpu-migration-threejs/concept — the "leave three?" question). THROWAWAY. Mirrors the three
 * Phase-0/1a harnesses so the numbers are directly comparable: ~15k independent draws (cloned boxes, 8 unlit
 * materials, culling defeated), camera orbiting, and Babylon's **Snapshot Rendering** (the record-once analogue of
 * WebGPU render bundles) toggleable — plus a streaming scenario that adds mesh batches to a LIVE snapshot scene
 * and measures the reset/re-record frame (the case that killed the three integration).
 *
 *   /babylon-spike.html                       → WebGPU + snapshot FAST (the headline case)
 *   /babylon-spike.html?snapshot=standard     → WebGPU + snapshot STANDARD
 *   /babylon-spike.html?snapshot=0            → WebGPU, no snapshot
 *   /babylon-spike.html?engine=webgl          → Babylon WebGL2 baseline
 *   &count=15000                              → draw count (default 15000 ≈ ls-noon)
 *   &stream=45                                → every 45 frames add a 150-mesh "cell" (+snapshot reset) and time it
 *
 * Compare against three (same machine): WebGL 10.3 ms / WebGPU no-bundle 27 ms / WebGPU+bundle 4.3 ms @ 15k.
 */
import {
  Color3,
  Constants,
  Engine,
  FreeCamera,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
  WebGPUEngine,
} from '@babylonjs/core';

const params = new URLSearchParams(window.location.search);
const COUNT = Number(params.get('count') ?? 15000);
const ENGINE = params.get('engine') ?? 'webgpu'; // webgpu | webgl
const SNAPSHOT = params.get('snapshot') ?? 'fast'; // fast | standard | 0 (webgpu only)
const STREAM = Number(params.get('stream') ?? 0); // >0 → add a cell of meshes every N frames
const CELL_SIZE = 150; // meshes per streamed "cell"
const SIDE = Math.ceil(Math.cbrt(COUNT));

const canvas = document.createElement('canvas');
canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
document.body.append(canvas);
const readout = document.createElement('pre');
readout.style.cssText =
  'position:fixed;top:12px;left:12px;margin:0;padding:8px 10px;background:rgba(0,0,0,.7);color:#0f0;' +
  'font:12px monospace;border-radius:6px;white-space:pre;z-index:10';
readout.textContent = 'starting…';
document.body.append(readout);

async function main(): Promise<void> {
  let engine: Engine | WebGPUEngine;
  if (ENGINE === 'webgl') {
    engine = new Engine(canvas, false);
  } else {
    const webgpu = new WebGPUEngine(canvas, { antialias: false });
    await webgpu.initAsync();
    engine = webgpu;
  }

  const scene = new Scene(engine);
  scene.skipFrustumClipping = true;
  const camera = new FreeCamera('cam', new Vector3(0, 0, SIDE * 2.4), scene);
  camera.setTarget(Vector3.Zero());

  const materials = makeMaterials(scene);
  const base = MeshBuilder.CreateBox('base', { size: 1 }, scene);
  base.setEnabled(false);

  /** A grid batch of `n` cloned boxes (shared geometry, cycling materials) — one draw each, culling defeated. */
  let spawned = 0;
  const addBatch = (n: number, zOffset: number): void => {
    for (let i = 0; i < n; i += 1) {
      const index = spawned++;
      const mesh = base.clone(`b${index}`);
      mesh.setEnabled(true);
      mesh.position.set(
        ((index % SIDE) - SIDE / 2) * 2.2,
        ((Math.floor(index / SIDE) % SIDE) - SIDE / 2) * 2.2,
        (Math.floor(index / (SIDE * SIDE)) - SIDE / 2) * 2.2 + zOffset,
      );
      mesh.material = materials[index % materials.length];
      mesh.alwaysSelectAsActiveMesh = true; // defeat culling — every mesh submits every frame (parity with three)
      mesh.freezeWorldMatrix(); // static world parity
    }
  };
  addBatch(COUNT, 0);

  const snapshotOn = ENGINE !== 'webgl' && SNAPSHOT !== '0';
  const applySnapshot = (): void => {
    if (!snapshotOn) {
      return;
    }
    engine.snapshotRenderingMode =
      SNAPSHOT === 'standard' ? Constants.SNAPSHOTRENDERING_STANDARD : Constants.SNAPSHOTRENDERING_FAST;
    engine.snapshotRendering = true;
  };
  scene.executeWhenReady(() => {
    applySnapshot();
    // eslint-disable-next-line no-console -- throwaway spike: mark the run start (copyable)
    console.log(`[babylon-spike] READY ${ENGINE} snapshot=${snapshotOn ? SNAPSHOT : 'off'} draws=${spawned}`);
  });

  const cfg = `engine=${ENGINE} snapshot=${snapshotOn ? SNAPSHOT : 'off'} stream=${STREAM || 'off'}`;
  const steady: number[] = [];
  const spikes: number[] = [];
  let frame = 0;
  let streamedThisFrame = false;

  engine.runRenderLoop(() => {
    frame += 1;
    if (STREAM > 0 && frame % STREAM === 0 && frame > 60) {
      addBatch(CELL_SIZE, 3 + (frame / STREAM) * 2); // a new "cell" streams in
      if (snapshotOn) {
        // Live-scene change under snapshot: Babylon requires a re-record — THE streaming-cost question.
        engine.snapshotRenderingReset();
      }
      streamedThisFrame = true;
    }
    const a = frame * 0.002;
    camera.position.set(Math.sin(a) * 4, 0, SIDE * 2.4);
    const t0 = performance.now();
    scene.render();
    const dt = performance.now() - t0;
    if (streamedThisFrame) {
      spikes.push(dt);
      streamedThisFrame = false;
      // eslint-disable-next-line no-console -- throwaway spike: the copyable measurement
      console.log(`[babylon-spike] ${cfg} | stream-frame #${spikes.length} = ${dt.toFixed(1)} ms`);
    } else if (frame > 60) {
      steady.push(dt);
      if (steady.length > 240) {
        steady.shift();
      }
    }
    if (frame % 15 === 0) {
      const avg = steady.length ? steady.reduce((sum, value) => sum + value, 0) / steady.length : 0;
      readout.textContent =
        `Babylon ${cfg}\ndraws ~${spawned} | render CPU ${avg.toFixed(2)} ms (this frame ${dt.toFixed(2)})\n` +
        `fps ${engine.getFps().toFixed(0)} | stream spikes max ${Math.max(0, ...spikes).toFixed(0)} ms\n` +
        `three (same machine): WebGL 10.3 | WebGPU no-bundle 27 | WebGPU+bundle 4.3 @ 15k`;
    }
    if (frame % 120 === 0) {
      const avg = steady.length ? steady.reduce((sum, value) => sum + value, 0) / steady.length : 0;
      // eslint-disable-next-line no-console -- throwaway spike summary
      console.log(
        `[babylon-spike] SUMMARY ${cfg} | draws ${spawned} | steady ${avg.toFixed(2)} ms | fps ${engine
          .getFps()
          .toFixed(0)} | stream spikes [${spikes.map((value) => value.toFixed(0)).join(',')}]`,
      );
    }
  });
  window.addEventListener('resize', () => engine.resize());
}

function makeMaterials(scene: Scene): StandardMaterial[] {
  return Array.from({ length: 8 }, (_, i) => {
    const material = new StandardMaterial(`m${i}`, scene);
    // Unlit (parity with the three harness's basic materials): emissive only, lighting off.
    material.disableLighting = true;
    material.emissiveColor = Color3.FromHSV((i / 8) * 360, 0.6, 0.9);
    material.freeze(); // static material — Babylon best practice for static worlds

    return material;
  });
}

void main().catch((error: unknown) => {
  readout.style.color = '#f66';
  readout.textContent = `Babylon failed:\n${error instanceof Error ? error.message : String(error)}`;
});
