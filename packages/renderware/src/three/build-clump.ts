import type { MeshBasicMaterial, Texture } from 'three';

import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  FrontSide,
  Group,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Sphere,
  Vector3,
} from 'three';

import type { PreparedAtomic, PreparedPart, PreparedSphere } from '../mesh/prepare-clump';
import type { RWClump, RWGeometry, RWMaterial } from '../parsers/binary/types';

import {
  groupTrianglesByMaterial,
  prepareClumpAtomics,
  sanitizeDegenerateNormals,
  sanitizeVertexPositions,
} from '../mesh/prepare-clump';
import { GeometryFlag } from '../parsers/binary/constants';
import { applyWorldUvAnim, getUvAnimUniform, registerUvAnimations } from './uv-anim';
import { buildWorldMaterial } from './world-material';

export { groupTrianglesByMaterial } from '../mesh/prepare-clump';

/**
 * Convert a parsed RWClump into a renderable three.js Group.
 *
 * One Mesh per atomic. Triangles are grouped by material index into geometry
 * groups so a single BufferGeometry can carry several materials. Missing
 * normals are computed. The root is rotated from RenderWare's Z-up space into
 * three.js Y-up.
 */
export interface BuildClumpOptions {
  /** Rotate the result from RenderWare Z-up into three.js Y-up. Default true.
   *  Set false when placing instances in shared GTA world (Z-up) space. */
  convertToYUp?: boolean;
}

/** Stand-in for the rare geometry slice whose material table is empty (renders plain white). */
const FALLBACK_RW_MATERIAL: RWMaterial = { color: [255, 255, 255, 255], texture: null, textured: false };

/** A model's 2dfx escalator in clump-local space (frame transform applied; plan 044).
 *  `points` is the step path: start → bottom (lower landing) → top (incline) → end (upper landing). */
export interface ClumpEscalator {
  /** 1 = steps move up (start → end), 0 = down. */
  direction: number;
  points: [[number, number, number], [number, number, number], [number, number, number], [number, number, number]];
}

/** A model's 2d-effect light in clump-local space (frame transform applied; still native Z-up). */
export interface ClumpLight {
  color: [number, number, number];
  farClip: number;
  position: [number, number, number];
  size: number;
}

/** A model's 2dfx particle emitter in clump-local space (frame transform applied; plan 044). */
export interface ClumpParticle {
  effectName: string;
  position: [number, number, number];
}

/** WebGPU/TSL factory registered under `?webgpu=1` (night-fill-tsl); when set, buildMaterial delegates so
 *  dynamics get NODE materials (a `.emissiveNode` night-fill needs one — `onBeforeCompile` is dead on
 *  `WebGPURenderer`). Mirrors `setWorldMaterialTslBuilder`; avoids importing three/webgpu here. */
export type DynamicMaterialFactory = (params: DynamicMaterialParams, reflective: boolean) => MeshStandardMaterial;

/** The `MeshStandardMaterial` constructor params buildMaterial resolves — what the TSL factory receives. */
export interface DynamicMaterialParams {
  alphaTest: number;
  color: number;
  map: null | Texture;
  metalness: number;
  roughness: number;
  side: typeof DoubleSide | typeof FrontSide;
  transparent: boolean;
  vertexColors: boolean;
}

/** A single-material renderable slice of a clump (for InstancedMesh). */
export interface RenderPart {
  geometry: BufferGeometry;
  /** The unlit SA world material (plan 038) — the map is prelit, never dynamically lit. */
  material: MeshBasicMaterial;
  /** Minimum day-prelit ALPHA, present only when some vertex alpha < 255 — wind-adapted vegetation
   *  encodes per-vertex sway weight there (plan 039: 255 = rigid trunk, lower = swaying canopy).
   *  The geometry then also carries a `swayWeight` attribute (= (255 − a) / 255). */
  swayAlphaMin?: number;
}

export function buildClump(clump: RWClump, textures?: Map<string, Texture>, options: BuildClumpOptions = {}): Group {
  const root = new Group();
  root.name = 'RWClump';

  for (const atomic of clump.atomics) {
    const rwGeometry = clump.geometries[atomic.geometryIndex];
    const frame = clump.frames[atomic.frameIndex];
    if (!rwGeometry) {
      continue;
    }

    const geometry = buildGeometry(rwGeometry);
    const materials = rwGeometry.materials.map((m) => buildMaterial(m, rwGeometry, textures));
    const mesh = new Mesh(geometry, materials.length > 0 ? materials : undefined);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = frame?.name ?? `atomic_${atomic.geometryIndex}`;

    if (frame) {
      mesh.applyMatrix4(frameMatrix(frame.rotation, frame.position));
    }
    root.add(mesh);
  }

  if (options.convertToYUp ?? true) {
    root.rotateX(-Math.PI / 2); // RenderWare Z-up -> three.js Y-up
  }

  return root;
}

/**
 * Extract a clump's 2dfx escalators, every path point frame-transformed into clump-local space
 * (native Z-up) like the lights/particles. Empty when the model has none.
 */
export function buildClumpEscalators(clump: RWClump): ClumpEscalator[] {
  const escalators: ClumpEscalator[] = [];
  const point = new Vector3();
  for (const atomic of clump.atomics) {
    const rw = clump.geometries[atomic.geometryIndex];
    if (!rw?.escalators || rw.escalators.length === 0) {
      continue;
    }
    const frame = clump.frames[atomic.frameIndex];
    const matrix = frame ? frameMatrix(frame.rotation, frame.position) : new Matrix4();
    for (const escalator of rw.escalators) {
      const points = [escalator.position, escalator.bottom, escalator.top, escalator.end].map((p) => {
        point.set(p[0], p[1], p[2]).applyMatrix4(matrix);

        return [point.x, point.y, point.z] as [number, number, number];
      });
      escalators.push({ direction: escalator.direction, points: points as ClumpEscalator['points'] });
    }
  }

  return escalators;
}

/**
 * Extract a clump's 2d-effect lights/coronas, each placed by its atomic's frame transform into
 * clump-local space (native Z-up — the streaming root applies the Z-up→Y-up rotation, like the parts).
 * Empty when the model has no lights. The caller multiplies these by each instance transform.
 */
export function buildClumpLights(clump: RWClump): ClumpLight[] {
  const lights: ClumpLight[] = [];
  const point = new Vector3();
  for (const atomic of clump.atomics) {
    const rw = clump.geometries[atomic.geometryIndex];
    if (!rw || rw.lights.length === 0) {
      continue;
    }
    const frame = clump.frames[atomic.frameIndex];
    const matrix = frame ? frameMatrix(frame.rotation, frame.position) : new Matrix4();
    for (const light of rw.lights) {
      point.set(light.position[0], light.position[1], light.position[2]).applyMatrix4(matrix);
      lights.push({
        color: [light.color[0], light.color[1], light.color[2]],
        farClip: light.coronaFarClip,
        position: [point.x, point.y, point.z],
        size: light.coronaSize,
      });
    }
  }

  return lights;
}

/**
 * Extract a clump's 2dfx particle emitters, frame-transformed into clump-local space (native
 * Z-up) like the lights. Empty when the model has none; the caller applies instance transforms.
 */
export function buildClumpParticles(clump: RWClump): ClumpParticle[] {
  const particles: ClumpParticle[] = [];
  const point = new Vector3();
  for (const atomic of clump.atomics) {
    const rw = clump.geometries[atomic.geometryIndex];
    if (!rw?.particles || rw.particles.length === 0) {
      continue;
    }
    const frame = clump.frames[atomic.frameIndex];
    const matrix = frame ? frameMatrix(frame.rotation, frame.position) : new Matrix4();
    for (const particle of rw.particles) {
      point.set(particle.position[0], particle.position[1], particle.position[2]).applyMatrix4(matrix);
      particles.push({ effectName: particle.effectName, position: [point.x, point.y, point.z] });
    }
  }

  return particles;
}

/**
 * Flatten a clump into single-material {@link RenderPart}s for instanced
 * rendering. Unlike {@link buildClump} (one multi-material Mesh per atomic),
 * each part carries exactly one geometry + one material so it can drive an
 * InstancedMesh. Parts stay in native Z-up — the caller (map scene root) does
 * the single Z-up→Y-up rotation. Shared vertex attributes are reused across a
 * model's parts so the GPU uploads them once.
 */
export function buildClumpParts(clump: RWClump, textures?: Map<string, Texture>): RenderPart[] {
  return wrapClumpParts(clump, prepareClumpAtomics(clump), textures);
}

export function buildGeometry(rw: RWGeometry): BufferGeometry {
  sanitizeVertexPositions(rw.positions);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(rw.positions, 3));

  if (rw.uvLayers.length > 0) {
    geometry.setAttribute('uv', new BufferAttribute(rw.uvLayers[0], 2));
  }

  if (rw.prelitColors) {
    const colors = new Float32Array((rw.prelitColors.length / 4) * 3);
    for (let i = 0, j = 0; i < rw.prelitColors.length; i += 4, j += 3) {
      colors[j] = rw.prelitColors[i] / 255;
      colors[j + 1] = rw.prelitColors[i + 1] / 255;
      colors[j + 2] = rw.prelitColors[i + 2] / 255;
    }
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
  }

  // Build an index buffer ordered by material, adding one group per material so
  // each face is drawn with the right material.
  const byMaterial = groupTrianglesByMaterial(rw.triangles, rw.materials.length);
  const index: number[] = [];
  let start = 0;
  byMaterial.forEach((tris, materialIndex) => {
    for (const tri of tris) {
      index.push(tri.a, tri.b, tri.c);
    }
    const count = tris.length * 3;
    if (count > 0) {
      geometry.addGroup(start, count, materialIndex);
      start += count;
    }
  });
  geometry.setIndex(index);

  if (rw.normals) {
    // Stored normals can be exporter garbage too (PF re-exports ship all-zero blocks — black faces);
    // repair is in-place and idempotent, so mutating the cached parse is safe. See plan 037.
    sanitizeDegenerateNormals(rw.normals, rw.positions, rw.triangles);
    geometry.setAttribute('normal', new BufferAttribute(rw.normals, 3));
  } else {
    geometry.computeVertexNormals();
    const normal = geometry.getAttribute('normal') as BufferAttribute;
    sanitizeDegenerateNormals(normal.array as Float32Array, rw.positions, rw.triangles);
  }
  geometry.computeBoundingSphere();

  return geometry;
}
let dynamicMaterialTslFactory: DynamicMaterialFactory | null = null;
export function buildMaterial(
  rw: RWMaterial,
  geometry: RWGeometry,
  textures?: Map<string, Texture>,
): MeshStandardMaterial {
  const map = rw.texture && textures ? (textures.get(rw.texture.name.toLowerCase()) ?? null) : null;
  const hasVertexColors = (geometry.flags & GeometryFlag.PRELIT) !== 0;
  const transparent = map ? Boolean(map.userData.hasAlpha) : rw.color[3] < 255;

  const params: DynamicMaterialParams = {
    alphaTest: transparent ? 0.5 : 0,
    color: map ? 0xffffff : (rw.color[0] << 16) | (rw.color[1] << 8) | rw.color[2],
    map,
    metalness: 0,
    roughness: 1,
    side: transparent ? DoubleSide : FrontSide,
    transparent,
    vertexColors: hasVertexColors,
  };

  // Env-map-reflective materials are built as MeshPhysicalMaterial so the vehicle-reflection plugin can
  // add a reflective **clearcoat** (glossy lacquer over the saturated paint) per the active preset.
  const env = rw.effects?.envMap;
  const reflective = env !== undefined && env.coefficient > 0;
  const material = dynamicMaterialTslFactory
    ? dynamicMaterialTslFactory(params, reflective)
    : reflective
      ? new MeshPhysicalMaterial({ ...params, clearcoat: 0 })
      : new MeshStandardMaterial(params);
  material.name = rw.texture?.name ?? 'material';

  // Carry the SA reflection-plugin data (preset-independent; shape matches `VehicleReflectionData` in
  // game/**) as plain userData so renderware stays free of game-layer types.
  if (env && env.coefficient > 0) {
    material.userData.reflection = {
      coefficient: env.coefficient,
      envTexture: env.texture,
      intensity: rw.effects?.reflection?.intensity ?? 0,
      offset: rw.effects?.reflection?.offset ?? [0, 0],
      scale: rw.effects?.reflection?.scale ?? [1, 1],
      specularLevel: rw.effects?.specular?.level ?? 0,
    };
    // Resolve the DFF-named env texture (vehicleenvmap128 / custom) and wire the SA sphere-map shader
    // so the PC/PS2 presets can reflect it the authentic way (toggled by a uniform from the game plugin).
    const saEnvMap = env.texture && textures ? (textures.get(env.texture.toLowerCase()) ?? null) : null;
    if (saEnvMap) {
      installSaReflection(material as MeshPhysicalMaterial, saEnvMap);
    }
  }

  return material;
}

export function frameMatrix(rotation: number[], position: [number, number, number]): Matrix4 {
  const [r0, r1, r2, r3, r4, r5, r6, r7, r8] = rotation;
  const matrix = new Matrix4();
  // RW stores right/up/at basis vectors; lay them into column-major Matrix4.
  matrix.set(r0, r3, r6, position[0], r1, r4, r7, position[1], r2, r5, r8, position[2], 0, 0, 0, 1);

  return matrix;
}

export function setDynamicMaterialTslFactory(factory: DynamicMaterialFactory | null): void {
  dynamicMaterialTslFactory = factory;
}

/**
 * The three.js half of {@link buildClumpParts} (plan 060 Phase 5): wrap prepared typed arrays into
 * BufferGeometry + world materials. All per-vertex/per-triangle work already happened in
 * `prepareClumpAtomics` (main thread or the streaming parse worker) — this only creates GPU-side objects,
 * so it's cheap enough for the streamed build's frame slices.
 */
export function wrapClumpParts(
  clump: RWClump,
  atomics: readonly PreparedAtomic[],
  textures?: Map<string, Texture>,
): RenderPart[] {
  const parts: RenderPart[] = [];
  // UV-animated textures (plan 041): dict entries must be registered before the materials below
  // look them up by name. Idempotent — re-building a streamed cell re-registers the same names.
  if (clump.uvAnimations) {
    registerUvAnimations(clump.uvAnimations);
  }
  for (const prepared of atomics) {
    const rw = clump.geometries[prepared.geometryIndex];
    if (!rw) {
      continue;
    }
    // NB the DFF's frame transform is deliberately IGNORED for map models, like SA: CFileLoader
    // re-frames atomic-model atomics onto a fresh identity frame, so map geometry lives in raw
    // model space (== its COL space). Vanilla frames are identity anyway; dirty re-exports
    // (gta3-pf CE_grndPALCST05 shipped a stray (12.9, 317, −28.5) frame translation) would
    // otherwise render ~300 m away from their collision.

    // Shared vertex attributes are reused across a model's parts so the GPU uploads them once.
    const attributes = preparedAttributes(prepared);
    for (const part of prepared.parts) {
      const geometry = partGeometry(attributes, part, prepared.sphere);

      // Unlit SA prelit blend (plan 038) — the night set is consumed by the material's dnBalance mix.
      const rwMaterial = rw.materials[part.materialIndex] ?? rw.materials[0];
      const material = buildWorldMaterial(rwMaterial ?? FALLBACK_RW_MATERIAL, rw, textures);
      // UV Anim PLG: the material plays a dict entry (signs/waterfalls scroll their map UVs).
      const uvAnimName = rwMaterial?.effects?.uvAnim?.names[0];
      const uvAnimUniform = uvAnimName === undefined ? undefined : getUvAnimUniform(uvAnimName);
      if (uvAnimUniform) {
        applyWorldUvAnim(material, uvAnimUniform);
      }
      parts.push({ geometry, material, ...(prepared.sway ? { swayAlphaMin: prepared.sway.minAlpha } : {}) });
    }
  }

  return parts;
}

/**
 * Wire the GTA-SA env-map reflection (PC/PS2) into a reflective material via `onBeforeCompile`: an additive
 * **sphere/matcap** reflection of `saEnvMap`, sampled by the **camera-space normal** (so it's screen-locked
 * like the original `CCustomCarEnvMapPipeline`). Gated by a `saStrength` uniform the vehicle-reflection plugin
 * drives per preset (0 for non-SA presets). Only the JSON-safe `saStrength` holder lives on `userData` (so the
 * plugin can reach it); the env **Texture** uniform stays in this closure and is NEVER put on `userData` —
 * `Material.copy()` (used by `clone()`, e.g. the vehicle glass-pass) JSON-clones userData and can't serialize a
 * Texture ("THREE.Texture: Unable to serialize Texture").
 */
function installSaReflection(material: MeshPhysicalMaterial, saEnvMap: Texture): void {
  const envMap = { value: saEnvMap }; // closure-only uniform — keep the Texture off userData (not serializable)
  const saStrength = { value: 0 };
  material.userData.saReflect = { saStrength };
  material.onBeforeCompile = (shader): void => {
    shader.uniforms.saEnvMap = envMap;
    shader.uniforms.saStrength = saStrength;
    shader.fragmentShader = `uniform sampler2D saEnvMap;\nuniform float saStrength;\n${shader.fragmentShader}`.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        vec3 saV = normalize( vViewPosition );
        vec3 saXx = normalize( vec3( saV.z, 0.0, -saV.x ) );
        vec3 saYy = cross( saV, saXx );
        vec2 saUV = vec2( dot( saXx, normal ), dot( saYy, normal ) ) * 0.495 + 0.5;
        totalEmissiveRadiance += texture2D( saEnvMap, saUV ).rgb * saStrength;
      }`,
    );
  };
  material.needsUpdate = true;
}

/** A part's BufferGeometry: the atomic's shared attributes + its own index and precomputed sphere. */
function partGeometry(
  attributes: Map<string, BufferAttribute>,
  part: PreparedPart,
  sphere: PreparedSphere,
): BufferGeometry {
  const geometry = new BufferGeometry();
  attributes.forEach((attribute, name) => geometry.setAttribute(name, attribute));
  geometry.setIndex(new BufferAttribute(part.index, 1));
  geometry.boundingSphere = new Sphere(
    new Vector3(sphere.center[0], sphere.center[1], sphere.center[2]),
    sphere.radius,
  );

  return geometry;
}

/** One BufferAttribute per prepared array — created once per atomic, shared by all its parts. */
function preparedAttributes(prepared: PreparedAtomic): Map<string, BufferAttribute> {
  const attributes = new Map<string, BufferAttribute>();
  attributes.set('position', new BufferAttribute(prepared.positions, 3));
  attributes.set('normal', new BufferAttribute(prepared.normals, 3));
  if (prepared.uv) {
    attributes.set('uv', new BufferAttribute(prepared.uv, 2));
  }
  if (prepared.color) {
    attributes.set('color', new BufferAttribute(prepared.color.array, prepared.color.itemSize));
  }
  // SA night (extra) vertex colours — bright warm texels are lit windows; added as emissive at night.
  if (prepared.nightColor) {
    attributes.set('nightColor', new BufferAttribute(prepared.nightColor, 3));
  }
  // Wind-adapted vegetation encodes per-vertex sway weight in the day-prelit ALPHA (plan 039).
  if (prepared.sway) {
    attributes.set('swayWeight', new BufferAttribute(prepared.sway.weights, 1));
  }

  return attributes;
}
