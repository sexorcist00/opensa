import { BoxGeometry, BufferAttribute, CanvasTexture, Group, Matrix4, PerspectiveCamera, Scene, Vector3 } from 'three';
/**
 * Phase-1 focused repro (docs/concepts/webgpu-migration): the streaming-compile stall. Every SPAWN frames it adds a
 * new InstancedMesh with a custom-colorNode node material (like a streamed world cell) under a −90°X parent, and
 * times the APPEARANCE frame. Reproduces the "camera-move freeze" = WebGPU compiling the pipeline on the frame the
 * cell appears, and tests whether `compileAsync` (and in which context) pre-warms it.
 *
 *   /webgpu-stream-compile.html                    → add WITHOUT precompile (expect appearance-frame spikes)
 *   /webgpu-stream-compile.html?precompile=1&ctx=bare   → compileAsync in a bare holder first (like game.precompile)
 *   /webgpu-stream-compile.html?precompile=1&ctx=scene  → compileAsync with the object already in the real rotated scene
 *   &variant=same|new  → all cells share one material variant (same) or force a new pipeline each (new)
 */
import { attribute, mix, normalWorld, texture, uniform } from 'three/tsl';
import { InstancedMesh, MeshBasicNodeMaterial, WebGPURenderer } from 'three/webgpu';

const params = new URLSearchParams(window.location.search);
const PRECOMPILE = params.get('precompile') === '1';
const CTX = params.get('ctx') ?? 'bare'; // bare | scene
const VARIANT = params.get('variant') ?? 'same'; // same → one pipeline; new → force a new pipeline per cell
const SPAWN = Number(params.get('spawn') ?? 45); // add a cell every N frames
const PER = 200; // instances per cell

const canvas = document.createElement('canvas');
canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
document.body.append(canvas);
const readout = document.createElement('pre');
readout.style.cssText =
  'position:fixed;top:12px;left:12px;margin:0;padding:8px 10px;background:rgba(0,0,0,.7);color:#0f0;' +
  'font:12px monospace;border-radius:6px;white-space:pre;z-index:10';
document.body.append(readout);

const geometry = new BoxGeometry(1, 1, 1);
const uSun = uniform(new Vector3(0, 1, 0));

function checker(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff';
  x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#888';
  x.fillRect(0, 0, 32, 32);
  x.fillRect(32, 32, 32, 32);

  return new CanvasTexture(c);
}
const map = checker();

async function main(): Promise<void> {
  const renderer = new WebGPURenderer({ antialias: true, canvas });
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  await renderer.init();

  const scene = new Scene();
  const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 0, 30);
  const root = new Group();
  root.rotation.x = -Math.PI / 2; // mimic the streaming root
  scene.add(root);

  const bareHolder = new Group();
  const spikes: number[] = [];
  let steadySum = 0;
  let steadyN = 0;
  let cellIndex = 0;
  let appearing = false;
  let frame = 0;

  const addCell = async (): Promise<void> => {
    const cell = makeCell(cellIndex++);
    if (PRECOMPILE && CTX === 'bare') {
      bareHolder.add(cell);
      await renderer.compileAsync(bareHolder, camera, scene);
      bareHolder.remove(cell);
    } else if (PRECOMPILE && CTX === 'scene') {
      root.add(cell); // compile in its REAL parent/scene context
      await renderer.compileAsync(scene, camera);
      appearing = true; // it's already in the scene; next frame is its first draw

      return;
    }
    root.add(cell);
    appearing = true;
  };

  const loop = (): void => {
    frame += 1;
    if (frame % SPAWN === 0 && cellIndex < 30) {
      void addCell();
    }
    uSun.value.set(Math.cos(frame * 0.01), 0.4, Math.sin(frame * 0.01)).normalize();
    const t0 = performance.now();
    void renderer.render(scene, camera);
    const dt = performance.now() - t0;
    if (appearing) {
      spikes.push(dt);
      appearing = false;
    } else if (frame > 30) {
      steadySum += dt;
      steadyN += 1;
    }
    if (frame % 10 === 0) {
      const recent = spikes
        .slice(-8)
        .map((s) => s.toFixed(0))
        .join(' ');
      readout.textContent =
        `stream-compile | precompile=${PRECOMPILE} ctx=${CTX} variant=${VARIANT}\n` +
        `cells added ${cellIndex} | steady ${(steadyN ? steadySum / steadyN : 0).toFixed(1)} ms\n` +
        `appearance-frame ms (recent): ${recent}\n` +
        `max spike ${Math.max(0, ...spikes).toFixed(0)} ms  ← low = pipeline pre-warmed, high = compiles on appear`;
    }
    requestAnimationFrame(loop);
  };
  loop();
}

function makeCell(index: number): InstancedMesh {
  const mesh = new InstancedMesh(geometry, makeMaterial(index), PER);
  mesh.frustumCulled = false;
  const matrix = new Matrix4();
  const colors = new Float32Array(PER * 3);
  for (let i = 0; i < PER; i += 1) {
    matrix.makeTranslation(((i % 20) - 10) * 2, (Math.floor(i / 20) - 5) * 2, -index * 3);
    mesh.setMatrixAt(i, matrix);
    colors.set([0.9, 0.8, 0.6], i * 3);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.geometry.setAttribute('color', new BufferAttribute(colors, 3));

  return mesh;
}

/** A world-material-like node graph so the pipeline complexity matches the engine. `variant=new` tweaks the graph
 *  so three must compile a fresh pipeline (tests whether same-structure materials otherwise share one). */
function makeMaterial(index: number): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  const day = attribute('color', 'vec3');
  const albedo = texture(map).rgb.mul(day);
  const sun = normalWorld.dot(uSun).max(0);
  const base = albedo.add(texture(map).rgb.mul(sun).mul(0.5));
  material.colorNode = VARIANT === 'new' ? mix(base, base.mul(1.0001 + index * 1e-6), 1) : base;

  return material;
}

void main().catch((error: unknown) => {
  readout.style.color = '#f66';
  readout.textContent = `WebGPU failed:\n${error instanceof Error ? error.message : String(error)}`;
});
