import type { BuiltDoor, BuiltPart, BuiltVehicle } from '@opensa/renderware/three/build-vehicle';
/**
 * Standalone vehicle viewer — a dev tool to inspect a car in isolation: select a
 * body part, open/close its door (button or `E`), swap it to its damaged mesh,
 * and toggle the collision wireframe and the low-detail `chassis_vlo` LOD.
 *
 * It reuses the real build path (`parseDff` -> `buildVehicle`, `parseDffCollision`
 * -> `buildCollisionWireframe`), so what you see is what the game builds.
 *
 * Vehicles are loaded from the compare server (`--after` side); the autocomplete list comes from that side's
 * `vehicles.ide`. Run `npx tsx tools/map-optimizer/src/compare-serve.ts --before <dir> --after <dir>` alongside
 * `npm run dev`. Open at /viewer.html?tab=vehicle.
 */
import type { Texture } from 'three';

import { parseDffCollision } from '@opensa/renderware/parsers/binary/col';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { buildCollisionWireframe } from '@opensa/renderware/three/build-col-wireframe';
import { buildTextureMap } from '@opensa/renderware/three/build-texture';
import { buildVehicle } from '@opensa/renderware/three/build-vehicle';
import {
  AmbientLight,
  Box3,
  Box3Helper,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  Matrix4,
  type Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Debug paint (the carcol markers become these) + a neutral wheel scale. */
const PRIMARY: [number, number, number] = [200, 40, 40];
const SECONDARY: [number, number, number] = [40, 50, 70];
const WHEEL_SCALE: [number, number] = [0.7, 0.7];
const DOOR_OPEN_ANGLE = -Math.PI / 3;
const HINGE = new Vector3(0, 0, 1);

/** Compare server (same as the Compare/Object tabs); vehicles load from its `--after` side. */
const DEFAULT_SERVER = 'http://localhost:3002';
let serverUrl = DEFAULT_SERVER;

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x4a4a4a);

const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100000);
const controls = new OrbitControls(camera, renderer.domElement);

const ambient = new AmbientLight(0xffffff, 1.5);
const directional = new DirectionalLight(0xffffff, 1.5);
directional.position.set(50, 100, 50);
scene.add(ambient, directional, new GridHelper(20, 20, 0x888888, 0x444444));

// Native GTA Z-up content shown Y-up (matches the game's streaming root −90°X).
const content = new Group();
content.rotation.x = -Math.PI / 2;
scene.add(content);

const partSelect = document.createElement('select');
const collisionToggle = document.createElement('input');
const lodToggle = document.createElement('input');
const wireframeToggle = document.createElement('input');
/** Live triangle count of the current car. */
const polyLabel = Object.assign(document.createElement('div'), { className: 'hint' });

let current: BuiltVehicle | null = null;
let collision: null | Object3D = null;
let selected: BuiltPart | null = null;
let highlight: Box3Helper | null = null;
/** World-space COL bounds of the current car — clamps the selection box (modded DFFs blow up the mesh bbox). */
let colBox: Box3 | null = null;
const doorOpen = new WeakSet<BuiltDoor>();

function addButton(parent: HTMLElement, label: string, onClick: () => void): void {
  const button = document.createElement('button');
  button.textContent = label;
  button.addEventListener('click', onClick);
  parent.appendChild(button);
}

function addToggle(parent: HTMLElement, label: string, input: HTMLInputElement, onChange: () => void): void {
  const wrapper = document.createElement('label');
  input.type = 'checkbox';
  input.addEventListener('change', onChange);
  wrapper.append(input, document.createTextNode(` ${label}`));
  parent.appendChild(wrapper);
}

function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

function applyCollision(): void {
  if (collision) {
    collision.visible = collisionToggle.checked;
  }
}

function applyLod(): void {
  if (!current) {
    return;
  }
  const showLod = lodToggle.checked && current.lod !== null;
  if (current.lod) {
    current.lod.visible = showLod;
  }
  for (const child of current.root.children) {
    if (child !== current.lod) {
      child.visible = !showLod;
    }
  }
}

/** Toggle the polygon wireframe on every material of the current car. */
function applyWireframe(): void {
  current?.root.traverse((node) => {
    const mesh = node as { material?: { wireframe?: boolean } | { wireframe?: boolean }[] };
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      material.wireframe = wireframeToggle.checked;
    }
  });
}

function buildControls(): void {
  const panel = document.createElement('div');
  panel.className = 'panel';

  const server = document.createElement('input');
  server.value = DEFAULT_SERVER;
  server.title = 'compare server URL';
  const input = document.createElement('input');
  input.placeholder = 'vehicle name…';
  input.setAttribute('list', 'vehicle-models');
  const datalist = document.createElement('datalist');
  datalist.id = 'vehicle-models';
  const status = document.createElement('div');
  status.className = 'hint';
  const submit = (): void => {
    const name = input.value.trim().toLowerCase();
    if (name) {
      void loadVehicle(name, status);
    }
  };
  addButton(panel, 'Load', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      submit();
    }
  });
  server.addEventListener('change', () => {
    serverUrl = server.value.replace(/\/$/, '');
    void loadVehicleList(datalist, status);
  });
  panel.append(server, input, datalist, status, partSelect);

  partSelect.addEventListener('change', () => selectPart(Number(partSelect.value)));

  const rule = document.createElement('hr');
  panel.appendChild(rule);
  addButton(panel, 'Open / close door (E)', toggleDoor);
  addButton(panel, 'Damage / repair part', toggleDamage);
  panel.appendChild(rule.cloneNode());
  addToggle(panel, 'Collision', collisionToggle, applyCollision);
  addToggle(panel, 'LOD (chassis_vlo)', lodToggle, applyLod);
  addToggle(panel, 'Wireframe (polygon mesh)', wireframeToggle, applyWireframe);
  panel.appendChild(polyLabel);

  document.body.appendChild(panel);
  void loadVehicleList(datalist, status);
}

function disposeCurrent(): void {
  if (current) {
    content.remove(current.root);
    disposeTree(current.root);
  }
  if (collision) {
    content.remove(collision);
    disposeTree(collision);
    collision = null;
  }
  if (highlight) {
    scene.remove(highlight);
    highlight = null;
  }
  selected = null;
}

function disposeTree(object: Object3D): void {
  object.traverse((node) => {
    const mesh = node as { geometry?: { dispose(): void }; material?: { dispose(): void } | { dispose(): void }[] };
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
    } else {
      material?.dispose();
    }
  });
}

async function fetchServer(endpoint: 'dff' | 'txd', model: string): Promise<ArrayBuffer> {
  const response = await fetch(`${serverUrl}/${endpoint}?side=after&model=${encodeURIComponent(model)}`);
  if (!response.ok) {
    throw new Error(`${model}: ${endpoint} not found on --after`);
  }

  return response.arrayBuffer();
}

function frameBox(box: Box3): void {
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const radius = Math.max(size.x, size.y, size.z) || 5;
  controls.target.copy(center);
  camera.position.set(center.x + radius, center.y + radius * 0.7, center.z + radius);
  controls.update();
}

async function loadVehicle(name: string, status?: HTMLElement): Promise<void> {
  if (status) {
    status.textContent = `loading ${name}…`;
  }
  let dffBuffer: ArrayBuffer;
  let txdBuffer: ArrayBuffer;
  try {
    [dffBuffer, txdBuffer] = await Promise.all([fetchServer('dff', name), fetchServer('txd', name)]);
  } catch (error) {
    if (status) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }

    return;
  }
  const textures: Map<string, Texture> = buildTextureMap(parseTxd(txdBuffer));
  const dff = parseDff(dffBuffer);

  disposeCurrent();
  current = buildVehicle(dff, textures, { primary: PRIMARY, secondary: SECONDARY, wheelScale: WHEEL_SCALE });
  content.add(current.root);

  const col = parseDffCollision(dffBuffer);
  if (col) {
    collision = buildCollisionWireframe([{ col, name: col.name, transforms: [new Matrix4()] }]);
    collision.visible = collisionToggle.checked;
    content.add(collision);
  }

  // World-space COL bounds (authored clean) — frames the camera and clamps the selection box.
  // Modded DFFs (e.g. admiral) have stray vertices that blow up the mesh bbox.
  content.updateMatrixWorld(true);
  colBox = col
    ? new Box3(new Vector3().fromArray(col.bounds.min), new Vector3().fromArray(col.bounds.max)).applyMatrix4(
        content.matrixWorld,
      )
    : null;

  rebuildPartSelect();
  applyLod();
  applyWireframe();
  updatePolyCount();
  frameBox(colBox ?? new Box3().setFromObject(current.root));
  if (status) {
    status.textContent = name;
  }
}

/** Fetch the `--after` vehicle list (from `vehicles.ide`) into the datalist. */
async function loadVehicleList(datalist: HTMLDataListElement, status: HTMLElement): Promise<void> {
  try {
    const response = await fetch(`${serverUrl}/models?side=after&kind=vehicle`);
    if (!response.ok) {
      status.textContent = `compare server not reachable at ${serverUrl}`;

      return;
    }
    const names = (await response.json()) as string[];
    datalist.replaceChildren(...names.map((name) => Object.assign(document.createElement('option'), { value: name })));
    status.textContent = `${names.length} vehicle(s) on --after`;
  } catch {
    status.textContent = `compare server not reachable at ${serverUrl}`;
  }
}

function onResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function rebuildPartSelect(): void {
  partSelect.replaceChildren();
  current?.parts.forEach((part, index) => partSelect.append(new Option(part.name, String(index))));
  selectPart(0);
}

function selectPart(index: number): void {
  selected = current?.parts[index] ?? null;
  if (selected) {
    partSelect.value = String(index);
  }
  updateHighlight();
}

function toggleDamage(): void {
  if (!selected) {
    return;
  }
  const damaged = selected.dam.visible;
  selected.dam.visible = !damaged;
  selected.ok.visible = damaged;
}

function toggleDoor(): void {
  const door = current?.doors.find((d) => `door_${d.side}` === selected?.name);
  if (!door) {
    return;
  }
  const open = !doorOpen.has(door);
  if (open) {
    doorOpen.add(door);
  } else {
    doorOpen.delete(door);
  }
  door.pivot.quaternion
    .copy(door.closed)
    .multiply(new Quaternion().setFromAxisAngle(HINGE, open ? DOOR_OPEN_ANGLE : 0));
  updateHighlight(); // door moved → re-fit the (clamped) highlight
}

/** Highlight the selected part, clamped to the car's COL bounds so a stray vertex can't blow it up. */
function updateHighlight(): void {
  if (highlight) {
    scene.remove(highlight);
    highlight = null;
  }
  if (!selected) {
    return;
  }
  content.updateMatrixWorld(true);
  const box = new Box3().setFromObject(selected.pivot);
  if (colBox && !box.isEmpty()) {
    box.intersect(colBox);
  }
  if (box.isEmpty()) {
    return;
  }
  highlight = new Box3Helper(box, 0xffff00);
  scene.add(highlight);
}

/** Sum the triangle count of the current car's meshes and show it. */
function updatePolyCount(): void {
  let triangles = 0;
  current?.root.traverse((node) => {
    const mesh = node as {
      geometry?: { getAttribute(name: string): undefined | { count: number }; getIndex(): null | { count: number } };
    };
    const geometry = mesh.geometry;
    if (geometry) {
      const index = geometry.getIndex();
      triangles += (index ? index.count : (geometry.getAttribute('position')?.count ?? 0)) / 3;
    }
  });
  polyLabel.textContent = current ? `Triangles: ${Math.round(triangles).toLocaleString()}` : '';
}

window.addEventListener('resize', onResize);
window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'e') {
    toggleDoor();
  }
});
buildControls();
collisionToggle.checked = false;
animate();
