import type { MeshBasicMaterial } from 'three';

import { readFileSync } from 'node:fs';
import { DoubleSide, FrontSide, Texture } from 'three';
import { describe, expect, it } from 'vitest';

import type { RWGeometry, RWMaterial } from '../parsers/binary/types';

import { GeometryFlag } from '../parsers/binary/constants';
import { parseDff } from '../parsers/binary/dff';
import { toArrayBuffer } from '../test-utils';
import {
  applyWorldWindowGlow,
  buildWorldMaterial,
  dnBalanceUniform,
  isVertexAlphaBeam,
  setWorldWindowGlowTslApplier,
  windowGlowUniform,
  worldCsmUniforms,
  worldDayTintUniform,
  worldEmissiveUniforms,
  worldFogUniforms,
  worldLocalLightUniforms,
  worldMoonUniforms,
  worldShadowUniforms,
  worldSunUniforms,
  worldTintUniform,
} from './world-material';

/** The onBeforeCompile parameter type (three renamed the old `Shader` type). */
type CompileShader = Parameters<MeshBasicMaterial['onBeforeCompile']>[0];

function geometry(partial: Partial<RWGeometry> = {}): RWGeometry {
  return {
    flags: GeometryFlag.POSITIONS | GeometryFlag.PRELIT | GeometryFlag.TEXTURED,
    lights: [],
    materials: [],
    nightColors: null,
    normals: null,
    numUVLayers: 1,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    prelitColors: new Uint8Array(12),
    triangles: [{ a: 0, b: 1, c: 2, materialIndex: 0 }],
    uvLayers: [new Float32Array(6)],
    ...partial,
  };
}

function material(partial: Partial<RWMaterial> = {}): RWMaterial {
  return { color: [255, 255, 255, 255], texture: null, textured: false, ...partial };
}

/** Minimal shader stub holding the three.js chunk anchors the material injects around. */
function shaderStub(): CompileShader {
  return {
    fragmentShader: '#include <color_fragment>\n#include <opaque_fragment>\n#include <fog_fragment>',
    uniforms: {},
    vertexShader: '#include <begin_vertex>\n#include <project_vertex>',
  } as unknown as CompileShader;
}

function textureMap(hasAlpha = false): Map<string, Texture> {
  const tex = new Texture();
  tex.name = 'wall';
  tex.userData.hasAlpha = hasAlpha;

  return new Map([['wall', tex]]);
}

describe('buildWorldMaterial', () => {
  describe('negative cases', () => {
    it('keeps the RW colour and opaque front-side rendering when untextured', () => {
      const built = buildWorldMaterial(material({ color: [200, 100, 50, 255] }), geometry());
      expect(built.color.getHex()).toBe((200 << 16) | (100 << 8) | 50);
      expect(built.map).toBeNull();
      expect(built.transparent).toBe(false);
      expect(built.side).toBe(FrontSide);
    });

    it('skips the night blend when the geometry has no night colours', () => {
      const built = buildWorldMaterial(material(), geometry());
      expect(built.customProgramCacheKey()).toBe('saWorld');
      const shader = shaderStub();
      built.onBeforeCompile(shader, undefined as never);
      expect(shader.uniforms.uDnBalance).toBeUndefined();
      expect(shader.fragmentShader).toContain('#include <color_fragment>'); // stock day prelit multiply
      expect(shader.uniforms.uWorldTint).toBe(worldTintUniform); // tint still applies
    });

    it('does not treat a white-textured part with opaque prelit (alpha 255) as a beam', () => {
      const built = buildWorldMaterial(
        material({ texture: { maskName: '', name: 'white' } }),
        geometry({ prelitColors: new Uint8Array(12).fill(255) }),
      );
      expect(built.transparent).toBe(false);
      expect(built.customProgramCacheKey()).not.toContain('beam');
    });

    it('does not apply the GLSL window glow when a TSL applier is registered (WebGPU mode delegates)', () => {
      const built = buildWorldMaterial(material({ texture: { maskName: '', name: 'wall' } }), geometry(), textureMap());
      const applied: MeshBasicMaterial[] = [];
      setWorldWindowGlowTslApplier((m) => applied.push(m));
      try {
        applyWorldWindowGlow(built);
      } finally {
        setWorldWindowGlowTslApplier(null);
      }
      expect(applied).toEqual([built]); // delegated…
      expect(built.customProgramCacheKey()).toBe('saWorld'); // …and the GLSL patch never landed
    });
  });

  describe('positive cases', () => {
    it('uses the texture (forced white) with alpha-driven transparency settings', () => {
      const built = buildWorldMaterial(
        material({ texture: { maskName: '', name: 'wall' } }),
        geometry(),
        textureMap(true),
      );
      expect(built.map?.name).toBe('wall');
      expect(built.color.getHex()).toBe(0xffffff);
      expect(built.transparent).toBe(true);
      expect(built.alphaTest).toBe(0.5);
      expect(built.side).toBe(DoubleSide);
      expect(built.vertexColors).toBe(true);
    });

    it('blends day prelit toward night colours, tinted by the DAY-ONLY tint (relaxes to white at night)', () => {
      const built = buildWorldMaterial(material(), geometry({ nightColors: new Uint8Array(12) }));
      expect(built.customProgramCacheKey()).toBe('saWorld|night');
      const shader = shaderStub();
      built.onBeforeCompile(shader, undefined as never);
      expect(shader.uniforms.uDnBalance).toBe(dnBalanceUniform);
      expect(shader.vertexShader).toContain('vNightColor = nightColor');
      expect(shader.fragmentShader).toContain('mix( vColor.rgb, vNightColor, uDnBalance )');
      // The night prelit set already encodes the night look, so this variant rides the day-only tint
      // (driven to white as dnBalance → 1) — NOT the no-night tint that darkens into the night ambient.
      expect(shader.uniforms.uWorldTint).toBe(worldDayTintUniform);
      expect(shader.fragmentShader).toContain('outgoingLight = mix( saClassic, saModern, uPipelineMix )');
    });

    it('applyWorldWindowGlow adds the additive map glow after the (no-night) tint', () => {
      const built = buildWorldMaterial(material({ texture: { maskName: '', name: 'wall' } }), geometry(), textureMap());
      applyWorldWindowGlow(built);
      expect(built.customProgramCacheKey()).toBe('saWorld|windowGlow');
      const shader = shaderStub();
      built.onBeforeCompile(shader, undefined as never);
      expect(shader.uniforms.uWindowGlow).toBe(windowGlowUniform);
      expect(shader.uniforms.uWorldTint).toBe(worldTintUniform); // composed, not clobbered
      const glowAt = shader.fragmentShader.indexOf('uWindowGlow;\n#endif');
      const tintAt = shader.fragmentShader.indexOf('mix( saClassic, saModern, uPipelineMix )');
      expect(glowAt).toBeGreaterThan(-1);
      expect(tintAt).toBeGreaterThan(-1);
      expect(glowAt).toBeGreaterThan(tintAt); // glow injected after the tint → not dimmed by it
    });

    it('receives the dynamic-only sun shadow in both variants (manual sampling)', () => {
      for (const nightColors of [null, new Uint8Array(12)]) {
        const built = buildWorldMaterial(material(), geometry({ nightColors }));
        const shader = shaderStub();
        built.onBeforeCompile(shader, undefined as never);
        expect(shader.uniforms.uWorldShadowMap).toBe(worldShadowUniforms.uWorldShadowMap);
        expect(shader.uniforms.uWorldShadowMatrix).toBe(worldShadowUniforms.uWorldShadowMatrix);
        expect(shader.uniforms.uWorldShadowStrength).toBe(worldShadowUniforms.uWorldShadowStrength);
        expect(shader.vertexShader).toContain('vWorldShadowCoord = uWorldShadowMatrix * wsWorldPos');
        expect(shader.fragmentShader).toContain('mix( 1.0, wsShadow, uWorldShadowStrength )');
      }
    });

    it('applyWorldWindowGlow composes with the night blend variant too', () => {
      const built = buildWorldMaterial(
        material({ texture: { maskName: '', name: 'wall' } }),
        geometry({ nightColors: new Uint8Array(12) }),
        textureMap(),
      );
      applyWorldWindowGlow(built);
      expect(built.customProgramCacheKey()).toBe('saWorld|night|windowGlow');
      const shader = shaderStub();
      built.onBeforeCompile(shader, undefined as never);
      expect(shader.uniforms.uWindowGlow).toBe(windowGlowUniform);
      expect(shader.uniforms.uDnBalance).toBe(dnBalanceUniform); // composed, not clobbered
      expect(shader.fragmentShader).toContain('uWindowGlow');
    });

    it('injects the hybrid sun split (plan 064) into both variants, inert at classic defaults', () => {
      for (const nightColors of [null, new Uint8Array(12)]) {
        const built = buildWorldMaterial(material(), geometry({ nightColors }));
        const shader = shaderStub();
        built.onBeforeCompile(shader, undefined as never);
        // shared live uniforms (single pump updates every cell material)
        expect(shader.uniforms.uSunDir).toBe(worldSunUniforms.uSunDir);
        expect(shader.uniforms.uDirectScale).toBe(worldSunUniforms.uDirectScale);
        expect(shader.uniforms.uIndirectScale).toBe(worldSunUniforms.uIndirectScale);
        expect(shader.uniforms.uPipelineMix).toBe(worldSunUniforms.uPipelineMix);
        // vertex: world-space NdotL with the NaN-free degenerate-normal guard
        expect(shader.vertexShader).toContain('inversesqrt( max( wsNLen, 1e-8 ) )');
        expect(shader.vertexShader).toContain('vSunNdl = mix( uSunFlat,');
        // fragment: albedo captured BEFORE the prelit multiply feeds the direct term
        expect(shader.fragmentShader).toContain('vec3 saTexel = diffuseColor.rgb;');
        expect(shader.fragmentShader).toContain('uSunColor * vSunNdl * wsShadow * uDirectScale');
      }
      // classic defaults keep the modern term mixed out entirely
      expect(worldSunUniforms.uPipelineMix.value).toBe(0);
      expect(worldSunUniforms.uDirectScale.value).toBe(0);
      expect(worldSunUniforms.uIndirectScale.value).toBe(1);
    });

    it('injects the cascaded shadow receive (plan 065), classic single-map term selectable by uCsmMix', () => {
      const built = buildWorldMaterial(material(), geometry());
      const shader = shaderStub();
      built.onBeforeCompile(shader, undefined as never);
      expect(shader.uniforms.uCsmMaps).toBe(worldCsmUniforms.uCsmMaps);
      expect(shader.uniforms.uCsmMatrices).toBe(worldCsmUniforms.uCsmMatrices);
      expect(shader.uniforms.uCsmMix).toBe(worldCsmUniforms.uCsmMix);
      expect(shader.uniforms.uCsmSplits).toBe(worldCsmUniforms.uCsmSplits);
      // vertex: one world-pos varying + the view depth; cascade projection happens per-FRAGMENT
      expect(shader.vertexShader).toContain('vWsPos = wsWorldPos.xyz');
      expect(shader.vertexShader).toContain('vViewDepth = -mvPosition.z');
      expect(shader.fragmentShader).toContain('uCsmMatrices[ 1 ] * wsP');
      // fragment: slope-biased cascaded term, selected over the classic single map by uCsmMix
      expect(shader.fragmentShader).toContain('uCsmBias + uCsmSlopeBias * ( 1.0 - ndl )');
      expect(shader.fragmentShader).toContain('uCsmMix > 0.5 ? csmShadow( vSunNdl ) : worldShadow()');
      // classic default keeps the cascades mixed out
      expect(worldCsmUniforms.uCsmMix.value).toBe(0);
    });

    it('replaces the stock fog include with the LUT fog + horizon cut (plan 068), classic-exact at mix 0', () => {
      const built = buildWorldMaterial(material(), geometry());
      const shader = shaderStub();
      built.onBeforeCompile(shader, undefined as never);
      expect(shader.uniforms.uFogLut).toBe(worldFogUniforms.uFogLut);
      expect(shader.uniforms.uFogMix).toBe(worldFogUniforms.uFogMix);
      expect(shader.fragmentShader).not.toContain('#include <fog_fragment>'); // replaced, not doubled
      expect(shader.fragmentShader).toContain('texture2D( uFogLut, vec2( saFogAzimuth, saFogElev ) )');
      expect(shader.fragmentShader).toContain('smoothstep( uFogCutDistance * 0.85, uFogCutDistance, saFogDist )');
      // the classic branch keeps three's exact exp² term
      expect(shader.fragmentShader).toContain('exp( - fogDensity * fogDensity * vFogDepth * vFogDepth )');
      expect(worldFogUniforms.uFogMix.value).toBe(0); // classic default inert
    });

    it('injects the local-light pool (plan 070): headlight/lamp light lands on the world with N·L', () => {
      const built = buildWorldMaterial(material(), geometry());
      const shader = shaderStub();
      built.onBeforeCompile(shader, undefined as never);
      expect(shader.uniforms.uLocalCount).toBe(worldLocalLightUniforms.uLocalCount);
      expect(shader.uniforms.uLocalPos).toBe(worldLocalLightUniforms.uLocalPos);
      expect(shader.vertexShader).toContain('vWsNormal = wsNormal');
      expect(shader.fragmentShader).toContain('saLocalLight()'); // added into the modern direct term
      expect(shader.fragmentShader).toContain('dot( vWsNormal, toL )'); // beams follow geometry (walls/slopes)
      expect(worldLocalLightUniforms.uLocalCount.value).toBe(0); // empty pool → early-out (day cost 0)
    });

    it('adds an un-shadowed wrapped moon term (plan 071), inert at its zero default', () => {
      const built = buildWorldMaterial(material(), geometry());
      const shader = shaderStub();
      built.onBeforeCompile(shader, undefined as never);
      expect(shader.uniforms.uMoonColor).toBe(worldMoonUniforms.uMoonColor);
      expect(shader.uniforms.uMoonDir).toBe(worldMoonUniforms.uMoonDir);
      // wrapped: moonlight is a huge soft source, a hard terminator would read as a second harsh sun
      expect(shader.vertexShader).toContain('( dot( wsNormal, uMoonDir ) + 0.6 ) / 1.6');
      // NOT multiplied by wsShadow — the moon lifts form even inside a building's sun shadow
      expect(shader.fragmentShader).toContain('uMoonColor * vMoonNdl');
      expect(worldMoonUniforms.uMoonColor.value.getHex()).toBe(0x000000); // classic default: no moonlight
    });

    it('glows baked night sources (plan 071) only on night-prelit models, inert at boost 0', () => {
      const lit = buildWorldMaterial(material(), geometry({ nightColors: new Uint8Array(12) }));
      const litShader = shaderStub();
      lit.onBeforeCompile(litShader, undefined as never);
      expect(litShader.uniforms.uEmissiveBoost).toBe(worldEmissiveUniforms.uEmissiveBoost);
      // the uniform + luma constant MUST be declared in the pars, or the program fails to compile
      expect(litShader.fragmentShader).toContain('uniform float uEmissiveBoost;');
      expect(litShader.fragmentShader).toContain('const vec3 SA_LUMA =');
      // mask = night↔day luminance delta → only lit windows/neon glow, and only as night falls
      expect(litShader.fragmentShader).toContain('dot( vNightColor, SA_LUMA ) - dot( vColor.rgb, SA_LUMA )');
      expect(litShader.fragmentShader).toContain('smoothstep( 0.05, 0.32, saDelta ) * uEmissiveBoost * uDnBalance');

      // day-only models carry no baked night sources: the term compiles to a constant zero
      const plain = buildWorldMaterial(material(), geometry());
      const plainShader = shaderStub();
      plain.onBeforeCompile(plainShader, undefined as never);
      expect(plainShader.fragmentShader).toContain('vec3 saGlow = vec3( 0.0 );');
      expect(plainShader.fragmentShader).toContain('uniform float uEmissiveBoost;'); // declared in both variants
      expect(worldEmissiveUniforms.uEmissiveBoost.value).toBe(0); // classic default: no glow
    });

    it('captures saTexel before the night prelit multiply (the direct term lights raw albedo)', () => {
      const built = buildWorldMaterial(material(), geometry({ nightColors: new Uint8Array(12) }));
      const shader = shaderStub();
      built.onBeforeCompile(shader, undefined as never);
      const texelAt = shader.fragmentShader.indexOf('vec3 saTexel = diffuseColor.rgb;');
      const prelitAt = shader.fragmentShader.indexOf('mix( vColor.rgb, vNightColor, uDnBalance )');
      expect(texelAt).toBeGreaterThan(-1);
      expect(prelitAt).toBeGreaterThan(-1);
      expect(texelAt).toBeLessThan(prelitAt);
    });

    it('renders a floodlight beam (white texture + prelit vertex alpha) alpha-blended with the cone alpha', () => {
      const built = buildWorldMaterial(
        material({ texture: { maskName: '', name: 'white' } }),
        geometry({ nightColors: new Uint8Array(12) }), // real floodbeams carry night colours
      );
      expect(built.transparent).toBe(true);
      expect(built.alphaTest).toBe(0); // NOT 0.5 — the cone alpha (~0.2) would be clipped away
      expect(built.depthWrite).toBe(false);
      expect(built.side).toBe(DoubleSide);
      expect(built.customProgramCacheKey()).toBe('saWorld|night|beam');
      const shader = shaderStub();
      built.onBeforeCompile(shader, undefined as never);
      expect(shader.fragmentShader).toContain('diffuseColor.a *= vColor.a'); // cone alpha → blended alpha
    });

    it('detects + alpha-blends the real SF stadium floodbeam DFF', () => {
      // Real model (SF stadium floodlights) — its lamp material uses the `white` placeholder texture with the
      // beam cone baked into the prelit vertex alpha. See tests/dff/floodbeams/ws_floodbeams.dff.
      const clump = parseDff(
        toArrayBuffer(new Uint8Array(readFileSync('tests/original/dff/floodbeams/ws_floodbeams.dff'))),
      );
      const geom = clump.geometries[0];
      const beamMaterial = geom.materials.find((m) => isVertexAlphaBeam(m, geom));
      if (!beamMaterial) {
        throw new Error('expected a vertex-alpha beam material in ws_floodbeams.dff');
      }
      const built = buildWorldMaterial(beamMaterial, geom);
      expect(built.transparent).toBe(true);
      expect(built.alphaTest).toBe(0);
      expect(built.depthWrite).toBe(false);
      expect(built.side).toBe(DoubleSide);
    });
  });
});
