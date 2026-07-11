/**
 * WebGPU/TSL world material (Phase 1, docs/concepts/webgpu-migration). The SA world material as a TSL node graph
 * for `WebGPURenderer` — three's auto-conversion of the GLSL `MeshBasicMaterial` drops all the custom shading, so
 * under `?webgpu=1` the engine builds this instead (registered via {@link setWorldMaterialTslBuilder}).
 *
 * Slice status: classic path (`texel × mix(day,night,dnBalance) × tint`) + the modern direct-sun term
 * (`+ texel × sunColor × N·L × directScale`), `uPipelineMix`-blended. CSM shadows / fog / emissive / local lights
 * are the next slices. The shared uniform nodes mirror the engine's plain uniform objects; {@link syncWorldTsl}
 * copies them once per frame (all materials share the nodes).
 */
import type { Texture } from 'three';

import { Color, DoubleSide, FrontSide, Vector3 } from 'three';
import { attribute, mix, normalWorld, renderGroup, texture, uniform, vec3 } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

import type { RWGeometry, RWMaterial } from '../parsers/binary/types';

import { isVertexAlphaBeam } from '../mesh/prepare-clump';
import { GeometryFlag } from '../parsers/binary/constants';
import {
  dnBalanceUniform,
  worldDayTintUniform,
  type WorldMaterialVariant,
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

  const texel = map ? texture(map).rgb : vec3(rw.color[0] / 255, rw.color[1] / 255, rw.color[2] / 255);
  // vec3(attribute(…)): 0.185's TSL types return an untyped AttributeNode — the vec3() wrap is the typed conversion.
  const day = attribute<'vec3'>('color', 'vec3');
  const prelit = hasVertexColors
    ? nightBlend
      ? mix(day, attribute<'vec3'>('nightColor', 'vec3'), uDn)
      : day
    : vec3(1, 1, 1);
  const albedo = texel.mul(prelit);
  const tint = nightBlend ? uDayTint : uTint;
  const sunNdl = normalWorld.dot(uSunDir).max(0);

  const classic = albedo.mul(tint);
  const modern = albedo.mul(tint).mul(uIndirect).add(texel.mul(uSunColor).mul(sunNdl).mul(uDirect));

  const material = new MeshBasicNodeMaterial();
  material.name = rw.texture?.name ?? 'material';
  material.colorNode = mix(classic, modern, uPipelineMix);
  material.side = transparent ? DoubleSide : FrontSide;
  material.depthWrite = !beam;
  if (transparent) {
    applyAlpha(material, map, beam);
  }
  byFlags.set(cacheKey, material);

  return material;
}

/** Copy the engine's per-frame world-lighting uniforms into the shared TSL nodes (call once per frame, WebGPU). */
export function syncWorldTsl(): void {
  uDn.value = dnBalanceUniform.value;
  uTint.value.copy(worldTintUniform.value);
  uDayTint.value.copy(worldDayTintUniform.value);
  uSunDir.value.copy(worldSunUniforms.uSunDir.value);
  uSunColor.value.copy(worldSunUniforms.uSunColor.value);
  uDirect.value = worldSunUniforms.uDirectScale.value;
  uIndirect.value = worldSunUniforms.uIndirectScale.value;
  uPipelineMix.value = worldSunUniforms.uPipelineMix.value;
}

/** Transparent setup: texture alpha drives opacity; alpha-TEST except beams (their soft cone alpha is ~0.2 max). */
function applyAlpha(material: MeshBasicNodeMaterial, map: null | Texture, beam: boolean): void {
  material.transparent = true;
  if (map) {
    material.opacityNode = texture(map).a;
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
