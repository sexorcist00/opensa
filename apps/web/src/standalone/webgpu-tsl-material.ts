import { BufferAttribute, CanvasTexture, Color, Mesh, PerspectiveCamera, PlaneGeometry, Scene } from 'three';
/**
 * Phase-1 TSL port — slice 1 (docs/concepts/webgpu-migration). THROWAWAY verification. Authors the SA world
 * material's CLASSIC path as a TSL node graph and renders it on a textured, vertex-coloured quad so the node
 * syntax + the day↔night look can be dialled in isolation before wiring into the engine.
 *
 * Classic path (world-material.ts 038): `texel × mix(dayPrelit vColor, nightPrelit nightColor, dnBalance) × tint`.
 *
 *   /webgpu-tsl-material.html            → animates dnBalance 0→1 (day → night)
 *   /webgpu-tsl-material.html?dn=0.0     → hold at a value (0 day … 1 night)
 */
import { attribute, mix, texture, uniform } from 'three/tsl';
import { MeshBasicNodeMaterial, WebGPURenderer } from 'three/webgpu';

const params = new URLSearchParams(window.location.search);
const HOLD = params.has('dn') ? Number(params.get('dn')) : null;

const canvas = document.createElement('canvas');
canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
document.body.append(canvas);

const readout = document.createElement('pre');
readout.style.cssText =
  'position:fixed;top:12px;left:12px;margin:0;padding:8px 10px;background:rgba(0,0,0,.7);color:#0f0;' +
  'font:12px monospace;border-radius:6px;white-space:pre;z-index:10';
document.body.append(readout);

/** The SA classic world material, in TSL: texel × mix(day, night, dnBalance) × tint. */
function buildWorldMaterialTsl(map: CanvasTexture): { dnBalance: { value: number }; material: MeshBasicNodeMaterial } {
  const dnBalance = uniform(0);
  const worldTint = uniform(new Color(1, 1, 1));
  const dayColor = attribute('color', 'vec3'); // prelit day (the stock vertexColors slot)
  const nightColor = attribute('nightColor', 'vec3'); // SA night prelit set
  const material = new MeshBasicNodeMaterial();
  material.colorNode = texture(map)
    .rgb.mul(mix(dayColor, nightColor, dnBalance))
    .mul(worldTint);

  return { dnBalance: dnBalance, material };
}

/** A simple checker texture (the "map") so we see texel × vertex-colour, not a flat quad. */
function checkerTexture(): CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      ctx.fillStyle = (x + y) % 2 ? '#ffffff' : '#b0b0b0';
      ctx.fillRect((x * size) / 8, (y * size) / 8, size / 8, size / 8);
    }
  }

  return new CanvasTexture(c);
}

async function main(): Promise<void> {
  const renderer = new WebGPURenderer({ antialias: true, canvas });
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  await renderer.init();

  const scene = new Scene();
  const camera = new PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 3);

  const geometry = new PlaneGeometry(3, 3, 1, 1);
  // Day prelit: warm; night prelit: cool blue. Per-vertex so we can see the blend, not a flat multiply.
  const day = new Float32Array([1, 0.85, 0.6, 1, 0.6, 0.4, 0.8, 0.7, 0.5, 0.6, 0.5, 0.4]);
  const night = new Float32Array([0.1, 0.15, 0.4, 0.05, 0.05, 0.2, 0.15, 0.2, 0.5, 0.05, 0.1, 0.3]);
  geometry.setAttribute('color', new BufferAttribute(day, 3));
  geometry.setAttribute('nightColor', new BufferAttribute(night, 3));

  const { dnBalance, material } = buildWorldMaterialTsl(checkerTexture());
  scene.add(new Mesh(geometry, material));

  let frame = 0;
  const loop = (): void => {
    frame += 1;
    dnBalance.value = HOLD ?? Math.sin(frame * 0.01) * 0.5 + 0.5; // animate day↔night unless held
    void renderer.render(scene, camera);
    if (frame % 15 === 0) {
      readout.textContent =
        'TSL world material (classic path)\n' +
        `dnBalance ${dnBalance.value.toFixed(2)} (0 day → 1 night)\n` +
        'EXPECT: warm checker by day → cool blue by night, texture visible throughout.';
    }
    requestAnimationFrame(loop);
  };
  loop();
}

void main().catch((error: unknown) => {
  readout.style.color = '#f66';
  readout.textContent = `TSL/WebGPU failed:\n${error instanceof Error ? error.message : String(error)}`;
});
