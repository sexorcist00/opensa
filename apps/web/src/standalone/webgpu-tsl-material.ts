import { BufferAttribute, CanvasTexture, Color, Mesh, PerspectiveCamera, Scene, SphereGeometry, Vector3 } from 'three';
/**
 * Phase-1 TSL port (docs/plans/073-webgpu-migration-threejs/concept). THROWAWAY verification. Builds the SA world material as a TSL
 * node graph slice by slice, on a lit sphere so lighting terms are visible, before wiring into the engine.
 *
 * Slice 1 — classic: `texel × mix(day prelit, night prelit, dnBalance) × tint`.
 * Slice 2 — modern sun: `mix(classic, albedo×tint×indirect + texel×sunColor×N·L×direct, pipelineMix)`.
 *
 *   /webgpu-tsl-material.html                 → modern path, sun orbiting (terminator moves)
 *   /webgpu-tsl-material.html?pipeline=0      → classic (no sun) for A/B
 *   /webgpu-tsl-material.html?dn=1            → hold night
 */
import { attribute, mix, normalWorld, texture, uniform } from 'three/tsl';
import { MeshBasicNodeMaterial, WebGPURenderer } from 'three/webgpu';

const params = new URLSearchParams(window.location.search);
const HOLD_DN = params.has('dn') ? Number(params.get('dn')) : null;
const PIPELINE = params.has('pipeline') ? Number(params.get('pipeline')) : 1;

const canvas = document.createElement('canvas');
canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
document.body.append(canvas);

const readout = document.createElement('pre');
readout.style.cssText =
  'position:fixed;top:12px;left:12px;margin:0;padding:8px 10px;background:rgba(0,0,0,.7);color:#0f0;' +
  'font:12px monospace;border-radius:6px;white-space:pre;z-index:10';
document.body.append(readout);

interface WorldUniforms {
  dnBalance: { value: number };
  sunDir: { value: Vector3 };
}

/** The SA world material in TSL — classic base + modern sun term, `uPipelineMix`-blended. */
function buildWorldMaterialTsl(map: CanvasTexture): { material: MeshBasicNodeMaterial; uniforms: WorldUniforms } {
  const dnBalance = uniform(0);
  const tint = uniform(new Color(1, 1, 1));
  const sunDir = uniform(new Vector3(0, 1, 0));
  const sunColor = uniform(new Color(1, 0.95, 0.85));
  const directScale = uniform(PIPELINE); // 0 classic, 1 modern
  const indirectScale = uniform(1);
  const pipelineMix = uniform(PIPELINE);

  const day = attribute<'vec3'>('color', 'vec3');
  const night = attribute<'vec3'>('nightColor', 'vec3');
  const texel = texture(map).rgb;
  const albedo = texel.mul(mix(day, night, dnBalance));
  const sunNdl = normalWorld.dot(sunDir).max(0); // world-space N·L

  const classic = albedo.mul(tint);
  const modern = albedo.mul(tint).mul(indirectScale).add(texel.mul(sunColor).mul(sunNdl).mul(directScale));
  const material = new MeshBasicNodeMaterial();
  material.colorNode = mix(classic, modern, pipelineMix);

  return {
    material,
    uniforms: { dnBalance: dnBalance, sunDir: sunDir },
  };
}

/** A checker texture so we see texel × light, not a flat sphere. */
function checkerTexture(): CanvasTexture {
  const size = 256;
  const element = document.createElement('canvas');
  element.width = element.height = size;
  const ctx = element.getContext('2d')!;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      ctx.fillStyle = (x + y) % 2 ? '#ffffff' : '#a8a8a8';
      ctx.fillRect((x * size) / 8, (y * size) / 8, size / 8, size / 8);
    }
  }

  return new CanvasTexture(element);
}

async function main(): Promise<void> {
  const renderer = new WebGPURenderer({ antialias: true, canvas });
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  await renderer.init();

  const scene = new Scene();
  const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 4);

  const geometry = new SphereGeometry(1.4, 48, 32);
  const count = geometry.attributes.position.count;
  const day = new Float32Array(count * 3);
  const night = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    day.set([0.95, 0.8, 0.6], i * 3); // warm day prelit
    night.set([0.1, 0.15, 0.4], i * 3); // cool blue night prelit
  }
  geometry.setAttribute('color', new BufferAttribute(day, 3));
  geometry.setAttribute('nightColor', new BufferAttribute(night, 3));

  const { material, uniforms } = buildWorldMaterialTsl(checkerTexture());
  scene.add(new Mesh(geometry, material));

  let frame = 0;
  const loop = (): void => {
    frame += 1;
    uniforms.dnBalance.value = HOLD_DN ?? 0;
    const a = frame * 0.01; // orbit the sun so the terminator sweeps the sphere
    uniforms.sunDir.value.set(Math.cos(a), 0.35, Math.sin(a)).normalize();
    void renderer.render(scene, camera);
    if (frame % 15 === 0) {
      readout.textContent =
        `TSL world material — classic + sun | pipeline=${PIPELINE}\n` +
        `dnBalance ${uniforms.dnBalance.value.toFixed(2)} | sun orbiting\n` +
        'EXPECT (pipeline=1): a lit sphere, bright sun side, dark terminator sweeping. pipeline=0: flat, no sun.';
    }
    requestAnimationFrame(loop);
  };
  loop();
}

void main().catch((error: unknown) => {
  readout.style.color = '#f66';
  readout.textContent = `TSL/WebGPU failed:\n${error instanceof Error ? error.message : String(error)}`;
});
