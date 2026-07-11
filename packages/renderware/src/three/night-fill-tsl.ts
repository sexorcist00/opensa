/**
 * WebGPU/TSL twin of the dynamics material path (plan 073/02). Under `?webgpu=1` dynamics need NODE materials:
 * the night-fill (plan 034) is a GLSL `onBeforeCompile` patch that `WebGPURenderer` never runs, and a
 * `.emissiveNode` only exists on node materials. {@link buildDynamicMaterialTsl} replaces `buildMaterial`'s
 * class choice (registered via `setDynamicMaterialTslFactory`), {@link applyNightFillTsl} replaces the GLSL
 * patch (via `setNightFillTslApplier`) with the same math on `emissiveNode`. The shared uniform nodes mirror
 * the plain night-fill uniform objects; {@link syncNightFillTsl} copies them once per frame.
 *
 * Deferred from this slice (plan 073/02): the vehicle env-map/clearcoat reflection — the plugin is skipped
 * under WebGPU and `installSaReflection`'s GLSL patch is inert on node materials; paint stays matte for now.
 */
import type { MeshStandardMaterial } from 'three';

import { Color } from 'three';
import { diffuseColor, mix, positionViewDirection, renderGroup, transformedNormalView, uniform } from 'three/tsl';
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';

import type { DynamicMaterialParams } from './build-clump';

import { nightFillGround, nightFillRim, nightFillSky, nightFillUniform } from './night-fill';

// Shared TSL uniform nodes — one set for every dynamics material; driven via syncNightFillTsl().
// `renderGroup`: updated once per render for ALL objects (dynamics are never bundle-frozen, but the shared
// group keeps them on the same cheap update path as the world uniforms).
const uNightFill = uniform(0).setGroup(renderGroup);
const uFillSky = uniform(new Color()).setGroup(renderGroup);
const uFillGround = uniform(new Color()).setGroup(renderGroup);
const uFillRim = uniform(0.1).setGroup(renderGroup);

// The GLSL night-fill as a node graph (see night-fill.ts for the idea): a camera-relative hemisphere of
// "moonlight" modulating the object's OWN albedo (diffuseColor = texture × colour, resolved before emissive
// in NodeMaterial.setup), plus a faint additive fresnel rim. Built once — every material shares the graph.
const hemi = transformedNormalView.y.mul(0.5).add(0.5);
const moon = mix(uFillGround, uFillSky, hemi).mul(uNightFill);
const rim = transformedNormalView.dot(positionViewDirection).oneMinus().clamp(0, 1).pow(3);
const nightFillNode = moon.mul(diffuseColor.rgb).add(uFillSky.mul(rim).mul(uFillRim).mul(uNightFill));

/** TSL replacement for the GLSL night-fill patch — same term, on the node material's `emissiveNode`. */
export function applyNightFillTsl(material: MeshStandardMaterial): void {
  // The factory below guarantees dynamics materials are node materials under WebGPU.
  (material as unknown as MeshStandardNodeMaterial).emissiveNode = nightFillNode;
}

/** The node-material twin of `buildMaterial`'s class choice (same params; reflective keeps the physical tier
 *  so the deferred reflection work lands on the right class). Cast: 0.185's types don't relate node materials
 *  to their classic counterparts; runtime-compatible for every property the engine touches. */
export function buildDynamicMaterialTsl(params: DynamicMaterialParams, reflective: boolean): MeshStandardMaterial {
  const material = reflective
    ? new MeshPhysicalNodeMaterial({ ...params, clearcoat: 0 })
    : new MeshStandardNodeMaterial(params);

  return material as unknown as MeshStandardMaterial;
}

/** Copy the per-frame night-fill uniforms into the shared TSL nodes (call once per frame, WebGPU). */
export function syncNightFillTsl(): void {
  uNightFill.value = nightFillUniform.value;
  uFillSky.value.copy(nightFillSky.value);
  uFillGround.value.copy(nightFillGround.value);
  uFillRim.value = nightFillRim.value;
}
