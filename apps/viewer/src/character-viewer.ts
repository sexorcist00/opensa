/**
 * Standalone character viewer — a dev tool to inspect a skinned ped in isolation:
 * see its skeleton and collision capsule and play any `ped.ifp` animation (looped).
 *
 * It reuses the real path (`parseDff` -> `buildSkinnedClump`, `orientCharacter`,
 * `parseIfp` -> `buildAnimationClip` -> `AnimationController`), so the rig and
 * animations behave exactly as in the game.
 *
 * Peds are loaded from the compare server (`--after` side); the autocomplete list comes from that side's
 * `peds.ide` and animations from its `anim/ped.ifp`. Run
 * `npx tsx tools/map-optimizer/src/compare-serve.ts --before <dir> --after <dir>` alongside `npm run dev`.
 * Open at /viewer.html?tab=character.
 */
import type { AnimationClip, Object3D } from 'three';

import { AnimationController } from '@opensa/game/character/animation-controller';
import { orientCharacter } from '@opensa/game/character/orient-character';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { parseIfp } from '@opensa/renderware/parsers/binary/ifp';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { buildAnimationClip } from '@opensa/renderware/three/build-anim-clip';
import { buildSkinnedClump } from '@opensa/renderware/three/build-skinned-clump';
import { buildTextureMap } from '@opensa/renderware/three/build-texture';
import {
  AmbientLight,
  Box3,
  Box3Helper,
  Clock,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  PerspectiveCamera,
  Scene,
  SkeletonHelper,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEFAULT_CLIP = 'idle_stance';
/** Stand the SA bind pose up (matches canvas-host's PLAYER_PLACEMENT). */
const PLACEMENT = {
  offset: [0, 0, 0.04] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  scale: 1,
};
/** Player collision half-extents (Z-up) from the game (canvas-host PLAYER_HALF_EXTENTS). */
const HALF = new Vector3(0.3, 0.3, 0.9);

/** Compare server (same as the other tabs); peds load from its `--after` side. */
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
const clock = new Clock();

const ambient = new AmbientLight(0xffffff, 1.5);
const directional = new DirectionalLight(0xffffff, 1.5);
directional.position.set(50, 100, 50);
scene.add(ambient, directional, new GridHelper(8, 8, 0x888888, 0x444444));

// Native GTA Z-up content shown Y-up (matches the game's entity root −90°X).
const content = new Group();
content.rotation.x = -Math.PI / 2;
scene.add(content);

const clipSelect = document.createElement('select');
const loopToggle = document.createElement('input');
const skeletonToggle = document.createElement('input');
const collisionToggle = document.createElement('input');
const wireframeToggle = document.createElement('input');
/** Live triangle count of the current ped. */
const polyLabel = Object.assign(document.createElement('div'), { className: 'hint' });

let controller: AnimationController | null = null;
let skeletonHelper: null | SkeletonHelper = null;
let collisionBox: Box3Helper | null = null;
let currentPlayer: null | Object3D = null;
/** IFP clips, fetched once per server (cleared when the server URL changes). */
let clipCache: Map<string, AnimationClip> | null = null;

function addToggle(parent: HTMLElement, label: string, input: HTMLInputElement, onChange: () => void): void {
  const wrapper = document.createElement('label');
  input.type = 'checkbox';
  input.addEventListener('change', onChange);
  wrapper.append(input, document.createTextNode(` ${label}`));
  parent.appendChild(wrapper);
}

function animate(): void {
  requestAnimationFrame(animate);
  controller?.update(clock.getDelta());
  controls.update();
  renderer.render(scene, camera);
}

function applyCollision(): void {
  if (collisionBox) {
    collisionBox.visible = collisionToggle.checked;
  }
}

function applySkeleton(): void {
  if (skeletonHelper) {
    skeletonHelper.visible = skeletonToggle.checked;
  }
}

/** Toggle the polygon wireframe on the current ped's materials. */
function applyWireframe(): void {
  currentPlayer?.traverse((node) => {
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
  input.placeholder = 'ped name…';
  input.setAttribute('list', 'ped-models');
  const datalist = document.createElement('datalist');
  datalist.id = 'ped-models';
  const status = document.createElement('div');
  status.className = 'hint';
  const submit = (): void => {
    const name = input.value.trim().toLowerCase();
    if (name) {
      void loadCharacter(name, status);
    }
  };
  const load = document.createElement('button');
  load.textContent = 'Load';
  load.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      submit();
    }
  });
  server.addEventListener('change', () => {
    serverUrl = server.value.replace(/\/$/, '');
    clipCache = null; // animations are per-side
    void loadPedList(datalist, status);
  });
  panel.append(server, input, datalist, load, status);

  clipSelect.addEventListener('change', playSelected);
  panel.appendChild(clipSelect);

  loopToggle.checked = true;
  addToggle(panel, 'Loop', loopToggle, playSelected);
  skeletonToggle.checked = true;
  addToggle(panel, 'Skeleton', skeletonToggle, applySkeleton);
  addToggle(panel, 'Collision (capsule)', collisionToggle, applyCollision);
  addToggle(panel, 'Wireframe (polygon mesh)', wireframeToggle, applyWireframe);
  panel.appendChild(polyLabel);

  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.textContent = 'click scene to replay';
  panel.appendChild(hint);

  document.body.appendChild(panel);
  void loadPedList(datalist, status);
}

/** Remove the current ped (mesh, skeleton, capsule, controller) before loading another. */
function disposeCharacter(): void {
  controller = null;
  if (currentPlayer) {
    content.remove(currentPlayer);
    currentPlayer.traverse((node) => {
      const mesh = node as { geometry?: { dispose(): void }; material?: { dispose(): void } | { dispose(): void }[] };
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose());
      } else {
        material?.dispose();
      }
    });
    currentPlayer = null;
  }
  if (skeletonHelper) {
    scene.remove(skeletonHelper);
    skeletonHelper = null;
  }
  if (collisionBox) {
    content.remove(collisionBox);
    collisionBox = null;
  }
  clipSelect.replaceChildren();
}

async function fetchServer(endpoint: string): Promise<ArrayBuffer> {
  const response = await fetch(`${serverUrl}/${endpoint}`);
  if (!response.ok) {
    throw new Error(`${endpoint}: not found on --after`);
  }

  return response.arrayBuffer();
}

function frameObject(object: Object3D): void {
  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const radius = Math.max(size.x, size.y, size.z) || 2;
  controls.target.copy(center);
  camera.position.set(center.x + radius, center.y + radius * 0.5, center.z + radius);
  controls.update();
}

async function loadAnimations(): Promise<Map<string, AnimationClip>> {
  if (clipCache) {
    return clipCache;
  }
  const clips = new Map<string, AnimationClip>();
  for (const anim of parseIfp(await fetchServer('ifp?side=after'))) {
    clips.set(anim.name.toLowerCase(), buildAnimationClip(anim));
  }
  clipCache = clips;

  return clips;
}

async function loadCharacter(name: string, status: HTMLElement): Promise<void> {
  status.textContent = `loading ${name}…`;
  let dffBuffer: ArrayBuffer;
  let txdBuffer: ArrayBuffer;
  try {
    [dffBuffer, txdBuffer] = await Promise.all([
      fetchServer(`dff?side=after&model=${encodeURIComponent(name)}`),
      fetchServer(`txd?side=after&model=${encodeURIComponent(name)}`),
    ]);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);

    return;
  }
  const skinned = buildSkinnedClump(parseDff(dffBuffer), buildTextureMap(parseTxd(txdBuffer)));
  if (!skinned) {
    status.textContent = `${name}: not skinned (no skeleton)`;

    return;
  }

  disposeCharacter();
  const player = orientCharacter(skinned.root, PLACEMENT);
  currentPlayer = player;
  content.add(player);
  updatePolyCount();

  skeletonHelper = new SkeletonHelper(skinned.root);
  skeletonHelper.visible = skeletonToggle.checked;
  scene.add(skeletonHelper);
  // Capsule footprint as a box: feet at z=0, ±half on x/y, full height on z (Z-up).
  const bounds = new Box3(new Vector3(-HALF.x, -HALF.y, 0), new Vector3(HALF.x, HALF.y, HALF.z * 2));
  collisionBox = new Box3Helper(bounds, 0x00ff88);
  collisionBox.visible = collisionToggle.checked;
  content.add(collisionBox);

  const clips = await loadAnimations();
  controller = new AnimationController(player, clips, skinned.bonesByName);
  [...clips.keys()].sort().forEach((clip) => clipSelect.append(new Option(clip, clip)));
  clipSelect.value = clips.has(DEFAULT_CLIP) ? DEFAULT_CLIP : (clipSelect.options[0]?.value ?? '');
  playSelected();
  applyWireframe();
  frameObject(player);
  status.textContent = name;
}

/** Fetch the `--after` ped list (from `peds.ide`) into the datalist. */
async function loadPedList(datalist: HTMLDataListElement, status: HTMLElement): Promise<void> {
  try {
    const response = await fetch(`${serverUrl}/models?side=after&kind=ped`);
    if (!response.ok) {
      status.textContent = `compare server not reachable at ${serverUrl}`;

      return;
    }
    const names = (await response.json()) as string[];
    datalist.replaceChildren(...names.map((name) => Object.assign(document.createElement('option'), { value: name })));
    status.textContent = `${names.length} ped(s) on --after`;
  } catch {
    status.textContent = `compare server not reachable at ${serverUrl}`;
  }
}

function onResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function playSelected(): void {
  if (controller && clipSelect.value) {
    controller.play(clipSelect.value, 0.2, loopToggle.checked);
  }
}

/** Sum the triangle count of the current ped's meshes and show it. */
function updatePolyCount(): void {
  let triangles = 0;
  currentPlayer?.traverse((node) => {
    const mesh = node as {
      geometry?: { getAttribute(name: string): undefined | { count: number }; getIndex(): null | { count: number } };
    };
    const geometry = mesh.geometry;
    if (geometry) {
      const index = geometry.getIndex();
      triangles += (index ? index.count : (geometry.getAttribute('position')?.count ?? 0)) / 3;
    }
  });
  polyLabel.textContent = currentPlayer ? `Triangles: ${Math.round(triangles).toLocaleString()}` : '';
}

window.addEventListener('resize', onResize);
renderer.domElement.addEventListener('click', playSelected);
buildControls();
animate();
