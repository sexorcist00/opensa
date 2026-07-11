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
import { attribute, mix, normalWorld, texture, uniform, vec3 } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

import type { RWGeometry, RWMaterial } from '../parsers/binary/types';

import { isVertexAlphaBeam } from '../mesh/prepare-clump';
import { GeometryFlag } from '../parsers/binary/constants';
import { dnBalanceUniform, worldDayTintUniform, worldSunUniforms, worldTintUniform } from './world-material';

// Shared TSL uniform nodes — one set for every world material; the engine drives them via syncWorldTsl().
const uDn = uniform(0);
const uTint = uniform(new Color(1, 1, 1));
const uDayTint = uniform(new Color(1, 1, 1));
const uSunDir = uniform(new Vector3(0, 1, 0));
const uSunColor = uniform(new Color(1, 1, 1));
const uDirect = uniform(0);
const uIndirect = uniform(1);
const uPipelineMix = uniform(0);

/** The TSL twin of {@link buildWorldMaterial}: same texture/flags rules, colour authored as a node graph. */
export function buildWorldMaterialTsl(
  rw: RWMaterial,
  geometry: RWGeometry,
  textures?: Map<string, Texture>,
): MeshBasicNodeMaterial {
  const map = rw.texture && textures ? (textures.get(rw.texture.name.toLowerCase()) ?? null) : null;
  const hasVertexColors = (geometry.flags & GeometryFlag.PRELIT) !== 0;
  const beam = isVertexAlphaBeam(rw, geometry);
  const transparent = beam || (map ? Boolean(map.userData.hasAlpha) : rw.color[3] < 255);
  const nightBlend = hasVertexColors && geometry.nightColors !== null;

  const texel = map ? texture(map).rgb : vec3(rw.color[0] / 255, rw.color[1] / 255, rw.color[2] / 255);
  const prelit = hasVertexColors
    ? nightBlend
      ? mix(attribute('color', 'vec3'), attribute('nightColor', 'vec3'), uDn)
      : attribute('color', 'vec3')
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
    material.transparent = true;
    if (map) {
      material.opacityNode = texture(map).a;
    }
    if (!beam) {
      material.alphaTest = 0.5;
    }
  }

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
