/**
 * WebGPU/TSL world material (Phase 1, docs/concepts/webgpu-migration). The SA world material as a TSL node graph
 * for `WebGPURenderer` — three's auto-conversion of the GLSL `MeshBasicMaterial` drops all the custom shading, so
 * under `?webgpu=1` the engine builds this instead (registered via {@link setWorldMaterialTslBuilder}).
 *
 * Slice status (plan 073/04): classic path (`texel × mix(day,night,dnBalance) × tint`) + the modern terms —
 * direct sun N·L, wrapped moon N·L, night emissive glow, the 12-slot local-light pool — `uPipelineMix`-blended;
 * beam vertex-alpha and the timed window-glow overlay ({@link applyWorldWindowGlowTsl}) are ported. Fog rides the
 * stock scene FogExp2 (canvas-host drives it under WebGPU); the LUT fog waits for the 073/03-C horizon LUT.
 * CSM/shadow sampling waits for plan 073/05 maps. The shared uniform nodes mirror the engine's plain uniform
 * objects; {@link syncWorldTsl} copies them once per frame (all materials share the nodes).
 */
import type { Texture } from 'three';

import { Color, DataTexture, DoubleSide, FloatType, FrontSide, NearestFilter, RGBAFormat, Vector3 } from 'three';
import {
  attribute,
  float,
  Fn,
  If,
  int,
  ivec2,
  Loop,
  mix,
  normalWorld,
  positionWorld,
  renderGroup,
  select,
  smoothstep,
  texture,
  textureLoad,
  uniform,
  vec3,
} from 'three/tsl';
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu';

import type { RWGeometry, RWMaterial } from '../parsers/binary/types';

import { isVertexAlphaBeam } from '../mesh/prepare-clump';
import { GeometryFlag } from '../parsers/binary/constants';
import {
  dnBalanceUniform,
  LOCAL_LIGHT_POOL,
  windowGlowUniform,
  worldDayTintUniform,
  worldEmissiveUniforms,
  worldLocalLightUniforms,
  type WorldMaterialVariant,
  worldMoonUniforms,
  worldSunUniforms,
  worldTintUniform,
} from './world-material';

// Shared TSL uniform nodes — one set for every world material; the engine drives them via syncWorldTsl().
// `renderGroup`: updated once per render for ALL objects (not per-object) — required so objects frozen inside
// static render bundles (docs/concepts/webgpu-migration) still receive live sun/night values every frame.
const uDn = uniform(0).setGroup(renderGroup);
const uTint = uniform(new Color(1, 1, 1)).setGroup(renderGroup);
const uDayTint = uniform(new Color(1, 1, 1)).setGroup(renderGroup);
const uSunDir = uniform(new Vector3(0, 1, 0)).setGroup(renderGroup);
const uSunColor = uniform(new Color(1, 1, 1)).setGroup(renderGroup);
const uDirect = uniform(0).setGroup(renderGroup);
const uIndirect = uniform(1).setGroup(renderGroup);
const uPipelineMix = uniform(0).setGroup(renderGroup);
const uMoonDir = uniform(new Vector3(0, 1, 0)).setGroup(renderGroup);
const uMoonColor = uniform(new Color(0, 0, 0)).setGroup(renderGroup);
const uEmissiveBoost = uniform(0).setGroup(renderGroup);
const uWindowGlow = uniform(1.2).setGroup(renderGroup);
const uLocalCount = uniform(0, 'int').setGroup(renderGroup);
// Bounding sphere over ALL active pool lights (synced per frame): one cheap distance test per fragment
// gates the whole loop — without it every world pixel iterated the pool (field: ~250 ms GPU at night).
const uPoolCenter = uniform(new Vector3()).setGroup(renderGroup);
const uPoolRadiusSq = uniform(0).setGroup(renderGroup);
// The pool lives in a tiny FLOAT TEXTURE (12×3 texels: row 0 = pos+radius, 1 = dir+coneCos, 2 = colour),
// read with `textureLoad` — NOT in uniform arrays: dynamically-indexed uniform arrays inside a fragment loop
// are a naga/Metal antipattern (the whole array can spill to per-fragment private memory → occupancy collapse;
// field: ~250 ms/frame on an M3 Pro, resolution-INdependent). Texel fetches are cheap and portable, and a
// data re-upload never touches bind groups — frozen render bundles keep working.
const POOL_TEXTURE_ROWS = 3;
const poolData = new Float32Array(LOCAL_LIGHT_POOL * POOL_TEXTURE_ROWS * 4);
const poolTexture = new DataTexture(poolData, LOCAL_LIGHT_POOL, POOL_TEXTURE_ROWS, RGBAFormat, FloatType);
poolTexture.magFilter = NearestFilter;
poolTexture.minFilter = NearestFilter;
poolTexture.generateMipmaps = false;
poolTexture.needsUpdate = true;

// The GLSL `saLocalLight()` pool term as a node function (plan 070): smooth windowed falloff × squared-rim
// cone × WRAP N·L (a headlight grazes the road tangentially — hard N·L collapses the beam; see world-material).
const saLocalLight = Fn(() => {
  const acc = vec3(0).toVar();
  If(positionWorld.sub(uPoolCenter).lengthSq().lessThan(uPoolRadiusSq), () => {
    Loop({ condition: '<', end: uLocalCount, start: int(0), type: 'int' }, ({ i }) => {
      const pos = textureLoad(poolTexture, ivec2(i, 0));
      const lampDir = textureLoad(poolTexture, ivec2(i, 1));
      const toL = pos.xyz.sub(positionWorld).toVar();
      const dist = toL.length().toVar();
      const radius = pos.w;
      If(dist.lessThan(radius), () => {
        const dir = toL.div(dist.max(0.001));
        const t = dist.div(radius);
        const window = t.mul(t).oneMinus();
        const atten = window.mul(window).div(t.mul(t).mul(3).add(1));
        const coneCos = lampDir.w;
        const coneEdge = smoothstep(coneCos, coneCos.add(0.3).min(1), dir.negate().dot(lampDir.xyz));
        const cone = select(coneCos.lessThan(1.5), coneEdge.mul(coneEdge), float(1));
        const wrap = select(coneCos.greaterThan(1.5), float(0), float(0.25));
        const ndl = normalWorld.dot(dir).add(wrap).div(wrap.add(1)).clamp(0, 1);
        acc.addAssign(textureLoad(poolTexture, ivec2(i, 2)).rgb.mul(atten.mul(cone).mul(ndl)));
      });
    });
  });

  return acc;
});

/** Rec.709 luma — the night-emissive "is this vertex a light source?" detector (plan 071). */
const SA_LUMA = vec3(0.2126, 0.7152, 0.0722);

// Material-independent lighting nodes — shared subgraphs, built once for every world material.
const sunNdl = normalWorld.dot(uSunDir).max(0);
// Moon N·L, wrapped: moonlight is a huge soft source — a hard terminator reads as a second harsh sun.
const moonNdl = normalWorld.dot(uMoonDir).add(0.6).div(1.6).clamp(0, 1);
const directLight = uSunColor.mul(sunNdl).mul(uDirect).add(uMoonColor.mul(moonNdl));
let lightTerm: null | typeof directLight = null;
/** The night-emissive glow (plan 071), or an inert zero on the pre-04 graph / no-night materials. */
function glowFor(full: boolean, texel: Node<'vec3'>, day: Node<'vec3'>, night: Node<'vec3'> | null): Node<'vec3'> {
  return full && night
    ? texel
        .mul(night)
        .mul(smoothstep(0.05, 0.32, night.dot(SA_LUMA).sub(day.dot(SA_LUMA))))
        .mul(uEmissiveBoost.mul(uDn))
    : vec3(0, 0, 0);
}

/** Pre-04 sun-only term vs the full 04 light term (see {@link mat04Enabled}). */
function lightTermFor(full: boolean): Node<'vec3'> {
  return full ? modernLightTerm() : uSunColor.mul(sunNdl).mul(uDirect);
}

/** The `material.map` property mirror — pre-04 left it unset (see {@link mat04Enabled}). */
function mapFor(full: boolean, map: null | Texture): null | Texture {
  return full ? map : null;
}

/** `?mat04=0`: rebuild the PRE-073/04 graph (classic + sun N·L only — no map property, moon, glow, pool,
 *  beam vec4 alpha, window glow). The MASTER bisect switch for the plan-04 slowdown investigation:
 *  `?mat04=0&fog=0` ≈ the confirmed-fast pre-04 state. */
function mat04Enabled(): boolean {
  return typeof window === 'undefined' || new URLSearchParams(window.location.search).get('mat04') !== '0';
}

/** Sun + moon direct light, plus the local-light pool unless `?pool=0` (perf bisect: the 12-slot loop bulks
 *  EVERY world pipeline's WGSL, and WebGPU compiles pipelines per OBJECT until plan 073/08). Built lazily
 *  once — the flag is stable for the page's lifetime. */
function modernLightTerm(): typeof directLight {
  lightTerm ??= poolEnabled() ? directLight.add(saLocalLight()) : directLight;

  return lightTerm;
}

/** Shared material instances: node materials are EXPENSIVE per instance under WebGPU (the node builder generates
 *  WGSL per material, ~ms each — appearance-frame spikes as cells stream). Same texture + same flag combination →
 *  the SAME material instance, so the builder runs once per distinct texture ever. Keyed by the Texture OBJECT
 *  (names repeat across TXDs with different pixels — lod-common plan 004), flags as a sub-key; untextured
 *  materials key by their RW colour. All per-frame state lives in the shared module uniforms, so sharing is safe. */
const texturedCache = new WeakMap<Texture, Map<string, MeshBasicNodeMaterial>>();
const untexturedCache = new Map<string, MeshBasicNodeMaterial>();

/** The TSL twin of {@link buildWorldMaterial}: same texture/flags rules, colour authored as a node graph. */
export function buildWorldMaterialTsl(
  rw: RWMaterial,
  geometry: RWGeometry,
  textures?: Map<string, Texture>,
  variant: WorldMaterialVariant = 'static',
): MeshBasicNodeMaterial {
  const map = rw.texture && textures ? (textures.get(rw.texture.name.toLowerCase()) ?? null) : null;
  const hasVertexColors = (geometry.flags & GeometryFlag.PRELIT) !== 0;
  const beam = isVertexAlphaBeam(rw, geometry);
  const transparent = beam || (map ? Boolean(map.userData.hasAlpha) : rw.color[3] < 255);
  const nightBlend = hasVertexColors && geometry.nightColors !== null;

  // `variant` in the key: a material shared between a count-1 InstancedMesh (static world) and a plain Mesh
  // (animated prop) collides in three's WebGPU render-object cache → one wrong vertex stage (see WorldMaterialVariant).
  // Cache ON by default since three r185 (see cacheEnabled) — r177's cache-key hole made sharing collide.
  const flagsKey = `${variant}|${hasVertexColors ? 'v' : ''}${nightBlend ? 'n' : ''}${beam ? 'b' : ''}${transparent ? 't' : ''}`;
  const [byFlags, cacheKey] = cacheSlot(map, rw, flagsKey);
  const cached = cacheEnabled() ? byFlags.get(cacheKey) : undefined;
  if (cached) {
    return cached;
  }

  const full = mat04Enabled();
  const texel = map ? texture(map).rgb : vec3(rw.color[0] / 255, rw.color[1] / 255, rw.color[2] / 255);
  // vec3(attribute(…)): 0.185's TSL types return an untyped AttributeNode — the vec3() wrap is the typed conversion.
  // Beams carry a vec4 `color` (the cone is the per-vertex ALPHA) — the attribute type must match the buffer.
  const day = beam && full ? attribute<'vec4'>('color', 'vec4').rgb : attribute<'vec3'>('color', 'vec3');
  const night = nightBlend ? attribute<'vec3'>('nightColor', 'vec3') : null;
  const prelit = hasVertexColors ? (night ? mix(day, night, uDn) : day) : vec3(1, 1, 1);
  const albedo = texel.mul(prelit);
  const tint = nightBlend ? uDayTint : uTint;
  // Night emissive (plan 071): a vertex much brighter at night than by day IS a lit window / neon / sign,
  // so it GLOWS (past the bloom threshold via uEmissiveBoost) instead of being merely tinted.
  const glow = glowFor(full, texel, day, night);

  const classic = albedo.mul(tint);
  // Modern (064/070/071): prelit as the INDIRECT term + real sun/moon/local lights on the raw albedo + glow.
  // Sun shadow factor is 1 until plan 073/05 provides maps.
  const modern = albedo
    .mul(tint)
    .mul(uIndirect)
    .add(texel.mul(lightTermFor(full)))
    .add(glow);

  const material = new MeshBasicNodeMaterial();
  material.name = rw.texture?.name ?? 'material';
  // colorNode wins over `map` for shading — but the engine gates on `material.map` (build-region treatments,
  // vehicle helpers), so keep the property in sync with the GLSL twin.
  material.map = mapFor(full, map);
  material.colorNode = mix(classic, modern, uPipelineMix);
  material.side = transparent ? DoubleSide : FrontSide;
  material.depthWrite = !beam;
  if (transparent) {
    applyAlpha(material, map, beam);
  }
  byFlags.set(cacheKey, material);

  return material;
}

/** Materials already carrying the glow term — timed overlays share cached materials, so a second part with the
 *  same texture must not stack the term twice. */
const glowedMaterials = new WeakSet<MeshBasicNodeMaterial>();

/** TSL twin of `applyWorldWindowGlow` (build-region timed overlays): `+ texture × windowGlow` over the night
 *  blend. Mutates the (cache-shared) material — timed window textures are dedicated to the overlays, so the
 *  term doesn't leak to unrelated geometry; the WeakSet guards double-application. */
export function applyWorldWindowGlowTsl(material: MeshBasicNodeMaterial): void {
  const map = material.map;
  if (!map || !material.colorNode || glowedMaterials.has(material) || !mat04Enabled()) {
    return;
  }
  glowedMaterials.add(material);
  // vec3(): colorNode's union type (float|vec2|…) doesn't satisfy add()'s overloads; ours is always vec3.
  material.colorNode = texture(map)
    .rgb.mul(uWindowGlow)
    .add(vec3(material.colorNode as Node<'vec3'>));
  material.needsUpdate = true;
}

/** Copy the engine's per-frame world-lighting uniforms into the shared TSL nodes (call once per frame, WebGPU).
 *  The local-light POOL arrays are wrapped by reference (see above) — only the count is copied. */
export function syncWorldTsl(): void {
  uDn.value = dnBalanceUniform.value;
  uTint.value.copy(worldTintUniform.value);
  uDayTint.value.copy(worldDayTintUniform.value);
  uSunDir.value.copy(worldSunUniforms.uSunDir.value);
  uSunColor.value.copy(worldSunUniforms.uSunColor.value);
  uDirect.value = worldSunUniforms.uDirectScale.value;
  uIndirect.value = worldSunUniforms.uIndirectScale.value;
  uPipelineMix.value = worldSunUniforms.uPipelineMix.value;
  uMoonDir.value.copy(worldMoonUniforms.uMoonDir.value);
  uMoonColor.value.copy(worldMoonUniforms.uMoonColor.value);
  uEmissiveBoost.value = worldEmissiveUniforms.uEmissiveBoost.value;
  uWindowGlow.value = windowGlowUniform.value;
  uLocalCount.value = worldLocalLightUniforms.uLocalCount.value;
  syncPoolBounds();
}

/** Transparent setup: texture alpha drives opacity — beams also fold in their per-vertex cone alpha, and stay
 *  blended (no alpha-test: the cone alpha is ~0.2 max; a 0.5 test would clip the whole beam). */
function applyAlpha(material: MeshBasicNodeMaterial, map: null | Texture, beam: boolean): void {
  material.transparent = true;
  const mapAlpha = map ? texture(map).a : null;
  const beamAlpha = beam && mat04Enabled() ? attribute<'vec4'>('color', 'vec4').a : null;
  const opacity = mapAlpha && beamAlpha ? mapAlpha.mul(beamAlpha) : (mapAlpha ?? beamAlpha);
  if (opacity) {
    material.opacityNode = opacity;
  }
  if (!beam) {
    material.alphaTest = 0.5;
  }
}

/** Cache ON by default (`?matcache=0` disables for A/B). On three r177 sharing produced a stretched-geometry
 *  anomaly: the render-object cache key didn't distinguish a count-1 InstancedMesh from a plain Mesh, so shared
 *  materials collided across object kinds. r185 fixed the key upstream (`isInstancedMesh || count > 1`) and the
 *  anomaly is confirmed gone — sharing is safe again, and it cuts per-material node builds on cell appearance. */
function cacheEnabled(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('matcache') !== '0';
}

/** The cache bucket + key for a material: per-texture (keyed by flags) or the untextured pool (colour + flags). */
function cacheSlot(
  map: null | Texture,
  rw: RWMaterial,
  flagsKey: string,
): [Map<string, MeshBasicNodeMaterial>, string] {
  if (!map) {
    return [untexturedCache, `${rw.color[0]},${rw.color[1]},${rw.color[2]},${rw.color[3]}|${flagsKey}`];
  }
  let byFlags = texturedCache.get(map);
  if (!byFlags) {
    byFlags = new Map();
    texturedCache.set(map, byFlags);
  }

  return [byFlags, flagsKey];
}

/** Local-light pool ON by default (`?pool=0` disables for perf A/B — see the modern-term note). */
function poolEnabled(): boolean {
  return typeof window === 'undefined' || new URLSearchParams(window.location.search).get('pool') !== '0';
}

let poolWasActive = false;
/** Recompute the pool bounding sphere from the active slots (centroid + max reach). Count 0 → radius 0:
 *  the fragment loop is skipped EVERYWHERE (the whole day case costs one compare per pixel). */
function syncPoolBounds(): void {
  const count = worldLocalLightUniforms.uLocalCount.value;
  syncPoolTexture(count);
  const center = uPoolCenter.value;
  center.set(0, 0, 0);
  if (count === 0) {
    uPoolRadiusSq.value = 0;

    return;
  }
  const positions = worldLocalLightUniforms.uLocalPos.value;
  for (let index = 0; index < count; index += 1) {
    const pos = positions[index];
    center.x += pos.x;
    center.y += pos.y;
    center.z += pos.z;
  }
  center.divideScalar(count);
  let radius = 0;
  for (let index = 0; index < count; index += 1) {
    const pos = positions[index];
    const dx = pos.x - center.x;
    const dy = pos.y - center.y;
    const dz = pos.z - center.z;
    radius = Math.max(radius, Math.hypot(dx, dy, dz) + pos.w); // + the lamp's own reach
  }
  uPoolRadiusSq.value = radius * radius;
}

/** Copy the engine's pool slots into the pool texture (one 576-byte upload per frame while lights are on). */
function syncPoolTexture(count: number): void {
  if (count === 0 && !poolWasActive) {
    return; // day steady state: nothing to upload
  }
  poolWasActive = count > 0;
  const positions = worldLocalLightUniforms.uLocalPos.value;
  const directions = worldLocalLightUniforms.uLocalDir.value;
  const colors = worldLocalLightUniforms.uLocalColor.value;
  for (let index = 0; index < LOCAL_LIGHT_POOL; index += 1) {
    positions[index].toArray(poolData, index * 4);
    directions[index].toArray(poolData, (LOCAL_LIGHT_POOL + index) * 4);
    const colorBase = (LOCAL_LIGHT_POOL * 2 + index) * 4;
    colors[index].toArray(poolData, colorBase);
    poolData[colorBase + 3] = 1;
  }
  poolTexture.needsUpdate = true;
}
