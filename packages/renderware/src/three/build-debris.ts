import type { Matrix4, Object3D, Texture } from 'three';

import { BufferAttribute, BufferGeometry, DataTexture, DoubleSide, Mesh, ShaderMaterial } from 'three';

import type { DebrisImpact } from '../breakable/bake-debris';
import type { RWBreakable } from '../parsers/binary/types';

import { bakeDebris, DEBRIS_FADE, DEBRIS_GRAVITY, DEBRIS_LIFETIME } from '../breakable/bake-debris';
import { GLOW_LAYER } from './corona';

export { DEBRIS_LIFETIME, type DebrisImpact };

/**
 * Breakable-prop debris (plan 045): when a prop smashes, its Breakable shatter mesh becomes one
 * Mesh of flying per-triangle shards. All motion is analytic in the vertex shader (the particles
 * pattern — zero per-frame CPU): each shard gets a velocity, a spin and a precomputed landing
 * time; it flies a ballistic arc, spins around its centroid, freezes where it lands and fades
 * out at the end of the lifetime. The whole mesh despawns afterwards.
 *
 * Geometry is baked in world space (GTA Z-up, the streaming-root space) at break time — gravity
 * runs along −Z, so the mesh itself sits at identity like the roadsigns/particles.
 */

/** Wall-clock seconds driving every debris lifecycle (set per frame by the game). */
export const debrisTimeUniform = { value: 0 };

/** Simultaneous break budget — the oldest break expires early when exceeded. */
const MAX_ACTIVE_DEBRIS = 8;

/** Plain white stand-in for shards whose texture is missing from the model's TXD. */
const WHITE_TEXTURE = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE_TEXTURE.needsUpdate = true;

const VERTEX = `
  attribute vec3 aCenter;
  attribute vec3 aVelocity;
  attribute vec3 aAngular;
  attribute float aLandTime;
  uniform float uTime;
  uniform float uSpawn;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vFade;

  vec3 rotateAxis(vec3 v, vec3 axis, float angle) {
    float c = cos(angle);
    float s = sin(angle);

    return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
  }

  void main() {
    float age = max(uTime - uSpawn, 0.0);
    // Shards freeze (translation AND spin) the moment they land.
    float t = min(age, aLandTime);
    float speed = length(aAngular);
    vec3 axis = speed > 1e-5 ? aAngular / speed : vec3(0.0, 0.0, 1.0);
    vec3 offset = rotateAxis(position - aCenter, axis, speed * t);
    vec3 center = aCenter + aVelocity * t + vec3(0.0, 0.0, -0.5 * ${DEBRIS_GRAVITY.toFixed(2)}) * t * t;
    vUv = uv;
    vColor = color;
    vFade = 1.0 - smoothstep(${(DEBRIS_LIFETIME - DEBRIS_FADE).toFixed(2)}, ${DEBRIS_LIFETIME.toFixed(2)}, age);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(center + offset, 1.0);
  }
`;

const FRAGMENT = `
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vFade;
  void main() {
    vec4 tex = texture2D(uMap, vUv);
    float a = tex.a * vColor.a * vFade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(tex.rgb * vColor.rgb, a);
  }
`;

interface ActiveDebris {
  mesh: Mesh;
  spawnedAt: number;
}

const active: ActiveDebris[] = [];

/**
 * Build the shard mesh for one break: the Breakable mesh placed by the prop's world transform,
 * de-indexed into per-triangle pieces with baked flight attributes. One geometry group (and one
 * draw) per distinct shard texture; per-material ambient is baked into the vertex colours.
 */
export function buildDebrisMesh(
  breakable: RWBreakable,
  transform: Matrix4,
  options: DebrisImpact,
  textures?: Map<string, Texture>,
): Mesh {
  // The shard arithmetic (fling, spin, landing time, texture grouping) is SHARED with the own engine —
  // see `breakable/bake-debris.ts`. This function only turns it into three objects.
  const baked = bakeDebris(breakable, transform.elements, options);
  const { angular: angulars, center: centers, color: colors, landTime: landTimes, position: positions } = baked;
  const { uv: uvs, velocity: velocities } = baked;

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 4));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setAttribute('aCenter', new BufferAttribute(centers, 3));
  geometry.setAttribute('aVelocity', new BufferAttribute(velocities, 3));
  geometry.setAttribute('aAngular', new BufferAttribute(angulars, 3));
  geometry.setAttribute('aLandTime', new BufferAttribute(landTimes, 1));

  const spawnUniform = { value: debrisTimeUniform.value };
  const materials: ShaderMaterial[] = [];
  baked.groups.forEach((group, slot) => {
    geometry.addGroup(group.start, group.count, slot);
    materials.push(
      new ShaderMaterial({
        depthWrite: false,
        fragmentShader: FRAGMENT,
        side: DoubleSide, // shards are single-sided triangles — both faces must draw
        transparent: true,
        uniforms: {
          uMap: { value: textures?.get(group.texture) ?? WHITE_TEXTURE },
          uSpawn: spawnUniform,
          uTime: debrisTimeUniform,
        },
        vertexColors: true,
        vertexShader: VERTEX,
      }),
    );
  });

  const mesh = new Mesh(geometry, materials);
  mesh.name = 'debris';
  mesh.frustumCulled = false; // shards spread far past the static bounds; ≤ MAX_ACTIVE meshes
  // Shader-animated transparency: keep it out of the SSAO normal prepass (which would
  // rasterize the shards un-animated at their static bake positions — ghost AO).
  mesh.layers.set(GLOW_LAYER);

  return mesh;
}

/** Test hook: drop all active debris (the registry is module-level shared state). */
export function resetDebris(): void {
  active.length = 0;
}

/**
 * Break a prop: build its shard mesh, add it under `parent` (the streaming root / cell space)
 * and register it for expiry. Exceeding the simultaneous-break budget expires the oldest break
 * immediately.
 */
export function spawnDebris(
  parent: Object3D,
  breakable: RWBreakable,
  transform: Matrix4,
  options: DebrisImpact,
  textures?: Map<string, Texture>,
): Mesh {
  const mesh = buildDebrisMesh(breakable, transform, options, textures);
  parent.add(mesh);
  active.push({ mesh, spawnedAt: debrisTimeUniform.value });
  while (active.length > MAX_ACTIVE_DEBRIS) {
    expire(active.shift());
  }

  return mesh;
}

/** Advance the debris clock and despawn breaks past their lifetime. */
export function updateDebris(time: number): void {
  debrisTimeUniform.value = time;
  while (active.length > 0 && time - active[0].spawnedAt >= DEBRIS_LIFETIME) {
    expire(active.shift());
  }
}

function expire(entry: ActiveDebris | undefined): void {
  if (!entry) {
    return;
  }
  entry.mesh.removeFromParent();
  entry.mesh.geometry.dispose();
  for (const material of Array.isArray(entry.mesh.material) ? entry.mesh.material : [entry.mesh.material]) {
    material.dispose();
  }
}
