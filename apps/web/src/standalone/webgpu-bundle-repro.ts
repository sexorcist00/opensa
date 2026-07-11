/**
 * Phase-1 bug repro (docs/plans/073-webgpu-migration-threejs/concept/phase-1-findings.md). THROWAWAY. Isolates the one thing the
 * engine's near ring does that the far ring doesn't: render an **InstancedMesh** inside a static **BundleGroup**
 * under a **rotated parent** (the streaming root is −90°X). If the instances collapse/stretch/vanish → the
 * InstancedMesh × static-bundle interaction is the bug.
 *
 *   /webgpu-bundle-repro.html               → InstancedMesh in a BundleGroup, rotated parent (the suspect case)
 *   /webgpu-bundle-repro.html?bundle=0      → same, but NO bundle (control — should be a clean grid)
 *   /webgpu-bundle-repro.html?rot=0         → no parent rotation
 *   /webgpu-bundle-repro.html?fix=world     → updateMatrixWorld(true) before the bundle records
 *   /webgpu-bundle-repro.html?fix=late       → populate the InstancedMesh AFTER it's added to the live scene
 */
import { BoxGeometry, Color, Group, InstancedMesh, Matrix4, PerspectiveCamera, Scene } from 'three';
import { BundleGroup, MeshBasicNodeMaterial, WebGPURenderer } from 'three/webgpu';

const params = new URLSearchParams(window.location.search);
const BUNDLE = params.get('bundle') !== '0';
const ROT = params.get('rot') !== '0';
const FIX = params.get('fix') ?? '';
const STREAM = Number(params.get('stream') ?? 0); // >0 → add the bundle to a LIVE scene after N frames (like streaming)
const SIDE = 20; // 20×20 = 400 instances

const canvas = document.createElement('canvas');
canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
document.body.append(canvas);

const readout = document.createElement('pre');
readout.style.cssText =
  'position:fixed;top:12px;left:12px;margin:0;padding:8px 10px;background:rgba(0,0,0,.7);color:#0f0;' +
  'font:12px monospace;border-radius:6px;white-space:pre;z-index:10';
readout.textContent = `InstancedMesh | bundle=${BUNDLE} | rot=${ROT} | fix=${FIX || 'none'}\nstarting…`;
document.body.append(readout);

function fillInstances(mesh: InstancedMesh): void {
  const matrix = new Matrix4();
  for (let i = 0; i < SIDE * SIDE; i += 1) {
    matrix.makeTranslation(((i % SIDE) - SIDE / 2) * 1.6, (Math.floor(i / SIDE) - SIDE / 2) * 1.6, 0);
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, new Color().setHSL(i / (SIDE * SIDE), 0.6, 0.5));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
}

async function main(): Promise<void> {
  const renderer = new WebGPURenderer({ antialias: true, canvas });
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  await renderer.init();

  const scene = new Scene();
  const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 0, 40);

  const parent = new Group();
  if (ROT) {
    parent.rotation.x = -Math.PI / 2; // mimic the streaming root
  }
  scene.add(parent);

  const container = BUNDLE ? new BundleGroup() : new Group();
  const populate = (): void => {
    const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicNodeMaterial(), SIDE * SIDE);
    mesh.frustumCulled = false;
    if (FIX === 'late') {
      container.add(mesh);
      fillInstances(mesh);
    } else {
      fillInstances(mesh);
      container.add(mesh);
    }
    parent.add(container);
    if (FIX === 'world') {
      scene.updateMatrixWorld(true);
    }
    (container as unknown as { needsUpdate: boolean }).needsUpdate = true;
  };

  // STREAM: leave the scene empty, add the bundle live after N frames (mimics a cell streaming into a running
  // renderer — the suspected real cause). Otherwise populate up front (the case that already rendered clean).
  if (STREAM <= 0) {
    populate();
  }

  let frame = 0;
  const loop = (): void => {
    frame += 1;
    if (STREAM > 0 && frame === STREAM) {
      populate();
    }
    if (ROT) {
      // The parent is −90°X; spin the camera a touch so the grid is clearly framed.
      camera.position.x = Math.sin(frame * 0.002) * 4;
    }
    camera.lookAt(0, 0, 0);
    void renderer.render(scene, camera);
    if (frame % 30 === 0) {
      const info = renderer.info.render as { drawCalls?: number };
      readout.textContent =
        `InstancedMesh | bundle=${BUNDLE} | rot=${ROT} | fix=${FIX || 'none'} | stream=${STREAM || 'off'}\n` +
        `${SIDE * SIDE} instances | drawCalls ${info.drawCalls ?? '?'} | frame ${frame}\n` +
        `EXPECT: a clean ${SIDE}×${SIDE} colour grid. Empty/distorted = bug reproduced.`;
    }
    requestAnimationFrame(loop);
  };
  loop();
}

void main().catch((error: unknown) => {
  readout.style.color = '#f66';
  readout.textContent = `WebGPU failed:\n${error instanceof Error ? error.message : String(error)}`;
});
