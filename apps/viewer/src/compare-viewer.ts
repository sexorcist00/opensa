/**
 * Before/after model compare viewer (map-optimizer plan 019 Phase 2). Talks to the compare server
 * (`tsx tools/map-optimizer/src/compare-serve.ts --before <dir> --after <dir>`), which serves one model's
 * DFF/TXD bytes from two game trees; this tab shows them side-by-side (BEFORE left, AFTER right) through the
 * real parse → build path, with one synced orbit camera. Toggles mirror the object viewer (lit / prelit /
 * MODULATE2X) plus a **night colours** view that rebuilds each side with the night vertex-colour set swapped
 * in as prelit — the exact data the prelight passes correct.
 *
 * Open at /viewer.html?tab=compare (run `npm run dev`; the compare server is its own process).
 */
import type { RWClump } from '@opensa/renderware/parsers/binary/types';
import type { TextureDictionary } from '@opensa/renderware/three/build-texture';
import type { Group } from 'three';

import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { buildClump } from '@opensa/renderware/three/build-clump';
import { buildTextureMap } from '@opensa/renderware/three/build-texture';
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

type SceneMesh = Mesh<Mesh['geometry'], Material | Material[]>;

interface SideState {
  clump: null | RWClump;
  group: Group | null;
  scene: Scene;
  textures: null | TextureDictionary;
}

interface ViewOptions {
  lit: boolean;
  modulate2x: boolean;
  night: boolean;
  prelit: boolean;
}

const DEFAULT_SERVER = 'http://localhost:3002';
const options: ViewOptions = { lit: true, modulate2x: false, night: false, prelit: true };

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);

const camera = new PerspectiveCamera(60, window.innerWidth / 2 / window.innerHeight, 0.1, 100000);
const controls = new OrbitControls(camera, renderer.domElement);

function makeScene(): Scene {
  const scene = new Scene();
  scene.background = new Color(0x4a4a4a); // neutral grey so darkness is judged against a known mid-tone
  // Lights mirror the main app (AmbientLightPlugin 1.5 + DirectionalLightPlugin 1.5).
  const directional = new DirectionalLight(0xffffff, 1.5);
  directional.position.set(50, 100, 50);
  scene.add(new AmbientLight(0xffffff, 1.5), directional, new GridHelper(200, 20, 0x888888, 0x444444));

  return scene;
}

const sides: Record<'after' | 'before', SideState> = {
  after: { clump: null, group: null, scene: makeScene(), textures: null },
  before: { clump: null, group: null, scene: makeScene(), textures: null },
};

let serverUrl = DEFAULT_SERVER;
const status = document.createElement('div');

function addSideLabel(text: string, side: 'left' | 'right'): void {
  const label = document.createElement('div');
  label.textContent = text;
  label.style.cssText = `position:fixed;bottom:12px;${side}:12px;color:#fff;background:rgba(0,0,0,.6);padding:4px 10px;border-radius:4px;font:bold 13px monospace;z-index:10;`;
  document.body.appendChild(label);
}

function addToggle(parent: HTMLElement, label: string, initial: boolean, onChange: (on: boolean) => void): void {
  const wrapper = document.createElement('label');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = initial;
  checkbox.addEventListener('change', () => onChange(checkbox.checked));
  wrapper.append(checkbox, document.createTextNode(` ${label}`));
  parent.appendChild(wrapper);
}

function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  const halfWidth = Math.floor(window.innerWidth / 2);
  renderer.setViewport(0, 0, halfWidth, window.innerHeight);
  renderer.setScissor(0, 0, halfWidth, window.innerHeight);
  renderer.render(sides.before.scene, camera);
  renderer.setViewport(halfWidth, 0, window.innerWidth - halfWidth, window.innerHeight);
  renderer.setScissor(halfWidth, 0, window.innerWidth - halfWidth, window.innerHeight);
  renderer.render(sides.after.scene, camera);
}

function applyToMesh(mesh: SceneMesh): void {
  const colour = mesh.geometry.getAttribute('color');
  if (colour && options.modulate2x) {
    const array = colour.array as Float32Array;
    for (let i = 0; i < array.length; i += 1) {
      array[i] = Math.min(1, array[i] * 2);
    }
    colour.needsUpdate = true;
  }
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mesh.material = materials.map((material) => rebuildMaterial(material, Boolean(colour)));
}

function buildControls(): void {
  const panel = document.createElement('div');
  panel.className = 'panel';

  const server = document.createElement('input');
  server.value = DEFAULT_SERVER;
  server.title = 'compare server URL';
  server.addEventListener('change', () => {
    serverUrl = server.value.replace(/\/$/, '');
    void loadModelList(input);
  });

  const input = document.createElement('input');
  input.placeholder = 'model name…';
  input.setAttribute('list', 'compare-models');
  const datalist = document.createElement('datalist');
  datalist.id = 'compare-models';

  const load = document.createElement('button');
  load.textContent = 'Load';
  const submit = (): void => {
    if (input.value.trim()) {
      void loadModel(input.value.trim().toLowerCase());
    }
  };
  load.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      submit();
    }
  });

  status.className = 'hint';
  panel.append(server, input, datalist, load, status, document.createElement('hr'));

  addToggle(panel, 'Lit (MeshStandard)', options.lit, (on) => {
    options.lit = on;
    rebuildBoth();
  });
  addToggle(panel, 'Prelit vertex colours', options.prelit, (on) => {
    options.prelit = on;
    rebuildBoth();
  });
  addToggle(panel, 'Prelit ×2 (MODULATE2X)', options.modulate2x, (on) => {
    options.modulate2x = on;
    rebuildBoth();
  });
  addToggle(panel, 'Night colours', options.night, (on) => {
    options.night = on;
    rebuildBoth();
  });

  document.body.appendChild(panel);
  addSideLabel('BEFORE', 'left');
  addSideLabel('AFTER', 'right');
  void loadModelList(input);
}

function disposeObject(object: Object3D): void {
  object.traverse((node) => {
    if (node instanceof Mesh) {
      const mesh = node as SceneMesh;
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        material.dispose();
      }
    }
  });
}

async function fetchSide(name: 'after' | 'before', model: string): Promise<void> {
  const side = sides[name];
  const [dff, txd] = await Promise.all([
    fetch(`${serverUrl}/dff?side=${name}&model=${encodeURIComponent(model)}`),
    fetch(`${serverUrl}/txd?side=${name}&model=${encodeURIComponent(model)}`),
  ]);
  if (!dff.ok) {
    throw new Error(`${name}: dff not found`);
  }
  side.clump = parseDff(await dff.arrayBuffer());
  side.textures = txd.ok ? buildTextureMap(parseTxd(await txd.arrayBuffer())) : new Map();
  rebuildSide(side);
}

function frameModel(): void {
  const group = sides.before.group ?? sides.after.group;
  if (!group) {
    return;
  }
  const box = new Box3().expandByObject(group);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const radius = Math.max(size.x, size.y, size.z) || 10;
  controls.target.copy(center);
  camera.position.set(center.x + radius, center.y + radius * 0.7, center.z + radius);
  camera.far = radius * 100;
  camera.updateProjectionMatrix();
  controls.update();
}

async function loadModel(model: string): Promise<void> {
  status.textContent = `loading ${model}…`;
  try {
    await Promise.all([fetchSide('before', model), fetchSide('after', model)]);
    frameModel();
    status.textContent = model;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function loadModelList(input: HTMLInputElement): Promise<void> {
  try {
    const response = await fetch(`${serverUrl}/models`);
    if (!response.ok) {
      return;
    }
    const models = (await response.json()) as string[];
    const datalist = document.getElementById('compare-models');
    if (datalist) {
      datalist.replaceChildren(
        ...models.map((name) => Object.assign(document.createElement('option'), { value: name })),
      );
    }
    status.textContent = `${models.length} models on both sides`;
    input.placeholder = 'model name (autocomplete)…';
  } catch {
    status.textContent = `compare server not reachable at ${serverUrl}`;
  }
}

function meshesOf(group: Group): SceneMesh[] {
  const meshes: SceneMesh[] = [];
  group.traverse((object) => {
    if (object instanceof Mesh) {
      meshes.push(object as SceneMesh);
    }
  });

  return meshes;
}

function onResize(): void {
  camera.aspect = window.innerWidth / 2 / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function rebuildBoth(): void {
  rebuildSide(sides.before);
  rebuildSide(sides.after);
}

function rebuildMaterial(source: Material, hasPrelit: boolean): MeshBasicMaterial | MeshStandardMaterial {
  const previous = source as MeshStandardMaterial;
  const map = previous.map;
  const shared = {
    alphaTest: previous.alphaTest,
    color: map ? 0xffffff : previous.color.getHex(),
    map,
    side: previous.side,
    transparent: previous.transparent,
    vertexColors: options.prelit && hasPrelit,
  };
  source.dispose();

  return options.lit
    ? new MeshStandardMaterial({ ...shared, metalness: 0, roughness: 1 })
    : new MeshBasicMaterial(shared);
}

/** Rebuild one side's model group from its parsed clump, honouring the night toggle. */
function rebuildSide(side: SideState): void {
  if (side.group) {
    side.scene.remove(side.group);
    disposeObject(side.group);
    side.group = null;
  }
  if (!side.clump || !side.textures) {
    return;
  }
  // Night view: swap the night vertex-colour set in as prelit (shallow copies — the parsed clump stays intact).
  const clump = options.night
    ? {
        ...side.clump,
        geometries: side.clump.geometries.map((geometry) => ({
          ...geometry,
          prelitColors: geometry.nightColors ?? geometry.prelitColors,
        })),
      }
    : side.clump;
  side.group = buildClump(clump, side.textures);
  for (const mesh of meshesOf(side.group)) {
    applyToMesh(mesh);
  }
  side.scene.add(side.group);
}

window.addEventListener('resize', onResize);
buildControls();
animate();
