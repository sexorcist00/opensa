import type { Texture } from 'three';

import { Color, DoubleSide, FrontSide, Matrix4, MeshBasicMaterial, Vector2, Vector3, Vector4 } from 'three';

import type { RWGeometry, RWMaterial } from '../parsers/binary/types';

import { isVertexAlphaBeam } from '../mesh/prepare-clump';
import { GeometryFlag } from '../parsers/binary/constants';

/**
 * SA prelit world material (plan 038): the static map rendered the way SA's
 * `CCustomBuildingDNPipeline` does — **unlit**, `texture × mix(day prelit, night prelit, dnBalance)
 * × world tint`. Vertex normals are never read (they stay in the geometry for SSAO's normal
 * prepass); the sun/ambient lights only affect dynamic objects, which keep the lit path.
 */

/** Day↔night prelit balance (0 day → 1 night), the SA DNBalance. Driven each frame by the game from
 *  the shared wall-clock fade (`clockNightFactor`) — the same clock the lit windows/tonemap ride. */
export const dnBalanceUniform = { value: 0 };

/** Global world tint for **no-night-prelit** models (most LODs): follows the sun through the day
 *  (white at noon → warm dim at dawn/dusk) and continues into the dark timecyc ambient at night.
 *  Mapping is a calibration knob (plan 038 §2). */
export const worldTintUniform = { value: new Color(1, 1, 1) };

/** Day tint for **night-prelit** models: the same sun-following day dim, but relaxing to WHITE as
 *  dnBalance → 1 — at night their own night prelit set is the final look (tinting it would
 *  double-darken; see the night-blend note below). Keeps dawn/dusk in sync across both variants. */
export const worldDayTintUniform = { value: new Color(1, 1, 1) };

/** Additive glow strength for night-lit timed window overlays — they must glow over the dark night
 *  blend, not just be tinted by it. Driven by the game (base 1.2 × the `night.windowGlow` knob). */
export const windowGlowUniform = { value: 1.2 };

/**
 * Manual shadow-receive for the unlit world (plan 038 iteration 3): the renderer's shadow plumbing
 * only feeds lit materials, so the world material samples the sun's (dynamic-casters-only) shadow
 * map itself. Driven by the game each frame: `uWorldShadowMap`/`uWorldShadowMatrix`/`...MapSize`
 * from the sun's `DirectionalLightShadow`, `uWorldShadowStrength` = day factor × shadow config
 * (0 disables the whole term — also the inert default in 'dynamic' mode).
 */
export const worldShadowUniforms = {
  // Tiny: receivers never cast here (no self-shadow acne possible), and the shadow camera's depth
  // range is long (~900 world units), so 1e-4 ≈ 9 cm — keeps wheel contact shadows tight.
  uWorldShadowBias: { value: 0.0001 },
  /** Debug (`?shadowdebug=1`): paint the shadowed term bright red to isolate it from AO/baking. */
  uWorldShadowDebug: { value: 0 },
  uWorldShadowMap: { value: null as null | Texture },
  uWorldShadowMapSize: { value: new Vector2(2048, 2048) },
  uWorldShadowMatrix: { value: new Matrix4() },
  uWorldShadowStrength: { value: 0 },
};

/**
 * Hybrid world lighting (plan 064): prelit re-read as the INDIRECT term + a real timecyc-driven sun on top —
 * `colour = albedo × (prelit × tint × uIndirectScale + uSunColor × NdotL × shadow × uDirectScale)`.
 * Uniform-gated, not a program variant: `uPipelineMix` 0 renders the classic 038 path bit-exact (the modern
 * term is mixed out), 1 the hybrid — toggling `graphics.pipeline` never rebuilds the scene or recompiles.
 * Driven per frame by the game from {@link sunSplit} curves; all values inert at their defaults.
 */
export const worldSunUniforms = {
  /** Multiplier on the sun NdotL term (0 = classic). From the {@link sunSplit} curves × config. */
  uDirectScale: { value: 0 },
  /** Multiplier on the prelit term (1 = classic). From the {@link sunSplit} curves. */
  uIndirectScale: { value: 1 },
  /** Master 0 = classic (exact 038) → 1 = modern hybrid; follows `graphics.pipeline`. */
  uPipelineMix: { value: 0 },
  /** Sun colour (linear), from the timecyc `dir` sample. */
  uSunColor: { value: new Color(1, 1, 1) },
  /** Sun direction in three world space (towards the sun), from SkyPlugin. */
  uSunDir: { value: new Vector3(0, 1, 0) },
  /** NdotL fallback for degenerate/missing normals — the sun-elevation flat response (plan 064 §3). */
  uSunFlat: { value: 0 },
};

/** Vertex: project the (instanced) world position into the sun's shadow map space, and compute the
 *  world-space sun NdotL (plan 064) with a degenerate-normal guard (`inversesqrt(max(…))` — NaN-free;
 *  near-zero normals fall back to the flat elevation response instead). */
const SHADOW_VERTEX =
  '#include <project_vertex>\n' +
  'vec4 wsWorldPos = vec4( transformed, 1.0 );\n' +
  'vec3 wsN = normal;\n' +
  '#ifdef USE_INSTANCING\n' +
  '\twsWorldPos = instanceMatrix * wsWorldPos;\n' +
  '\twsN = mat3( instanceMatrix ) * wsN;\n' +
  '#endif\n' +
  'wsWorldPos = modelMatrix * wsWorldPos;\n' +
  'vWorldShadowCoord = uWorldShadowMatrix * wsWorldPos;\n' +
  'vWsPos = wsWorldPos.xyz;\n' +
  'vViewDepth = -mvPosition.z;\n' +
  'wsN = mat3( modelMatrix ) * wsN;\n' +
  'float wsNLen = dot( wsN, wsN );\n' +
  'vec3 wsNormal = wsN * inversesqrt( max( wsNLen, 1e-8 ) );\n' +
  'vWsNormal = wsNormal;\n' +
  'vSunNdl = mix( uSunFlat, max( dot( wsNormal, uSunDir ), 0.0 ), step( 0.25, wsNLen ) );';

/**
 * Cascaded shadows (plan 065): three view-sliced maps replace the single 45 m one on the modern pipeline.
 * Slot 0 mirrors the sun's own (per-frame, dynamics + near HD) map; slots 1–2 are the static mid/far
 * cascades the CSM plugin re-renders on its sun-delta/camera-move schedule. Uniform-gated by `uCsmMix`
 * (0 = the classic single-map term, untouched); the game flips it only when all three maps exist.
 */
export const worldCsmUniforms = {
  /** Constant depth bias (receivers now self-cast — the classic-tiny bias would acne). */
  uCsmBias: { value: 0.0012 },
  uCsmMaps: { value: [null, null, null] as (null | Texture)[] },
  uCsmMapSize: { value: new Vector2(2048, 2048) },
  uCsmMatrices: { value: [new Matrix4(), new Matrix4(), new Matrix4()] },
  /** 0 = classic single-map shadow term; 1 = the cascaded term. */
  uCsmMix: { value: 0 },
  /** Slope-scaled bias term × (1 − NdotL) — grazing surfaces need more depth margin. */
  uCsmSlopeBias: { value: 0.002 },
  /** Cascade far bounds (view-space distance, world units). */
  uCsmSplits: { value: new Vector3(45, 250, 800) },
};

/**
 * Unified fog (plan 068, modern pipeline): the world's fog colour comes from the 067 horizon LUT — per
 * fragment, by view AZIMUTH — so fully-fogged geometry always dissolves into the exact sky behind it
 * (sun-side warm, anti-sun cool; the dawn "glowing silhouettes" die here). A clamped smoothstep tail forces
 * the factor to 1.0 at the cut distance — geometry at the far plane resolves to PURE sky colour (the
 * ocean-through-haze horizon artefact dies by construction). `uFogMix` 0 = three's stock FogExp2 untouched.
 */
export const worldFogUniforms = {
  /** Distance (world units) where fog reaches EXACTLY 1.0 (the horizon cut). timecyc-driven (plan 068). */
  uFogCutDistance: { value: 1200 },
  /** Height-fog falloff (1/world-units): haze hugs sea level, mountains poke out. */
  uFogHeightK: { value: 1 / 180 },
  /** Floor of the height attenuation — high geometry keeps at least this much distance fog. */
  uFogHeightMin: { value: 0.4 },
  /** 512×32 sky LUT from the SkyPlugin (azimuth × elevation → sky colour). */
  uFogLut: { value: null as null | Texture },
  /** 0 = stock scene FogExp2; 1 = the directional LUT fog + horizon cut. */
  uFogMix: { value: 0 },
  /** Distance where fog starts ramping (timecyc `fogStart` × scale; 0 = classic exp² shape). */
  uFogStartDistance: { value: 0 },
};

/** Local-light pool size (plan 070): the world shader iterates this fixed array — vehicle lamps now,
 *  street lamps join later. Count 0 (day / no lights) exits immediately. */
export const LOCAL_LIGHT_POOL = 8;

/**
 * Local lights on the world (plan 070, modern pipeline): a fixed pool of point/spot lights evaluated
 * per fragment inside the world shader — real projected light on roads/walls (headlight beams, brake
 * pools), which three's own lights can never give the manual prelit material. Slots are filled by the
 * game (vehicle lamps first; the street-lamp registry arrives with the full 070). Position/direction in
 * three WORLD space; colour premultiplied by intensity; `uLocalDir[i].w` = cone cosine (2.0 = point).
 */
export const worldLocalLightUniforms = {
  uLocalColor: { value: Array.from({ length: LOCAL_LIGHT_POOL }, () => new Color(0, 0, 0)) },
  uLocalCount: { value: 0 },
  uLocalDir: { value: Array.from({ length: LOCAL_LIGHT_POOL }, () => new Vector4(0, 0, 1, 2)) },
  uLocalPos: { value: Array.from({ length: LOCAL_LIGHT_POOL }, () => new Vector4(0, 0, 0, 1)) },
};

/** Fragment: the pool term — smooth radius falloff × optional cone × N·L (beams climb walls correctly). */
const LOCAL_LIGHTS_FRAGMENT_PARS =
  'uniform int uLocalCount;\n' +
  'uniform vec4 uLocalPos[ 8 ];\n' +
  'uniform vec3 uLocalColor[ 8 ];\n' +
  'uniform vec4 uLocalDir[ 8 ];\n' +
  'varying vec3 vWsNormal;\n' +
  'vec3 saLocalLight() {\n' +
  '\tvec3 acc = vec3( 0.0 );\n' +
  '\tfor ( int i = 0; i < 8; i++ ) {\n' +
  '\t\tif ( i >= uLocalCount ) break;\n' +
  '\t\tvec3 toL = uLocalPos[ i ].xyz - vWsPos;\n' +
  '\t\tfloat d = length( toL );\n' +
  '\t\tfloat radius = uLocalPos[ i ].w;\n' +
  '\t\tif ( d >= radius ) continue;\n' +
  '\t\ttoL /= max( d, 0.001 );\n' +
  '\t\tfloat atten = 1.0 - d / radius;\n' +
  '\t\tatten *= atten;\n' +
  // Cone falloff is SQUARED toward the rim: a flat plateau reads as a hard-edged searchlight blob.
  '\t\tfloat cone = 1.0;\n' +
  '\t\tif ( uLocalDir[ i ].w < 1.5 ) {\n' +
  '\t\t\tcone = smoothstep( uLocalDir[ i ].w, min( uLocalDir[ i ].w + 0.30, 1.0 ), dot( -toL, uLocalDir[ i ].xyz ) );\n' +
  '\t\t\tcone *= cone;\n' +
  '\t\t}\n' +
  // WRAP lighting: a headlight grazes the road almost tangentially, so a hard N·L collapses the beam to
  // nothing (measured: 0.08 at 6 m). Wrapping keeps the road pool readable while walls/kerbs still take
  // more light when they face the lamp — the plan's "ground pool first, wall response too" in one term.
  '\t\tfloat wrap = uLocalDir[ i ].w > 1.5 ? 0.0 : 0.25;\n' +
  '\t\tfloat ndl = clamp( ( dot( vWsNormal, toL ) + wrap ) / ( 1.0 + wrap ), 0.0, 1.0 );\n' +
  '\t\tacc += uLocalColor[ i ] * ( atten * cone * ndl );\n' +
  '\t}\n' +
  '\treturn acc;\n' +
  '}\n';

/** Replaces three's `fog_fragment`: the stock exp² factor (bit-exact classic) upgraded on the modern path
 *  with the LUT colour + the horizon cut. Compiled under USE_FOG like the include it replaces. */
const FOG_FRAGMENT =
  '#ifdef USE_FOG\n' +
  '\tfloat saFogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );\n' +
  '\tvec3 saFogColor = fogColor;\n' +
  '\tif ( uFogMix > 0.5 ) {\n' +
  '\t\tvec3 saFogView = vWsPos - cameraPosition;\n' +
  // RADIAL distance, not view-Z: view-Z shrinks toward the screen edges, so a rotation made distant
  // objects pop in/out of the cut (user report: "боковым зрением видны, прямо — исчезают").
  '\t\tfloat saFogDist = length( saFogView );\n' +
  '\t\tfloat saFogAzimuth = atan( saFogView.z, saFogView.x ) / 6.2831853 + 0.5;\n' +
  '\t\tfloat saFogElev = clamp( saFogView.y / max( saFogDist * 0.7, 1e-3 ), 0.0, 1.0 );\n' +
  '\t\tsaFogColor = texture2D( uFogLut, vec2( saFogAzimuth, saFogElev ) ).rgb;\n' +
  // timecyc-driven exp² over [start, cut] (plan 068): fog distance is a per-weather/hour MOOD.
  '\t\tfloat saFogD = max( saFogDist - uFogStartDistance, 0.0 );\n' +
  '\t\tfloat saFogK = 2.0 / max( uFogCutDistance - uFogStartDistance, 1.0 );\n' +
  '\t\tsaFogFactor = 1.0 - exp( - saFogK * saFogK * saFogD * saFogD );\n' +
  // Height fog: haze hugs the sea level; peaks keep at least uFogHeightMin of the distance term.
  '\t\tfloat saFogHeight = exp( - max( vWsPos.y, 0.0 ) * uFogHeightK );\n' +
  '\t\tsaFogFactor *= mix( uFogHeightMin, 1.0, saFogHeight );\n' +
  // The horizon CUT stays absolute — nothing renders past full fog, whatever the height.
  '\t\tsaFogFactor = max( saFogFactor, smoothstep( uFogCutDistance * 0.85, uFogCutDistance, saFogDist ) );\n' +
  '\t}\n' +
  '\tgl_FragColor.rgb = mix( gl_FragColor.rgb, saFogColor, saFogFactor );\n' +
  '#endif';

/** Fragment: the cascaded receive — per-cascade 4-tap PCF, split select by view depth, blend bands at the
 *  boundaries, and a fade-out tail at the far end. Sampler arrays must be indexed by CONSTANTS in GLSL ES,
 *  hence the if-chain. `csmDebugTint` feeds the `?shadowdebug` cascade visualization (R/G/B per cascade). */
const CSM_FRAGMENT_PARS =
  'uniform sampler2D uCsmMaps[ 3 ];\n' +
  'uniform mat4 uCsmMatrices[ 3 ];\n' +
  'uniform vec2 uCsmMapSize;\n' +
  'uniform vec3 uCsmSplits;\n' +
  'uniform float uCsmMix;\n' +
  'uniform float uCsmBias;\n' +
  'uniform float uCsmSlopeBias;\n' +
  'varying vec3 vWsPos;\n' +
  'varying float vViewDepth;\n' +
  'vec3 csmDebugTint = vec3( 1.0, 0.05, 0.05 );\n' +
  'float csmPcf( sampler2D map, vec4 coord, float bias ) {\n' +
  '\tvec3 sc = coord.xyz / coord.w;\n' +
  '\tif ( sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0 ) return 1.0;\n' +
  '\tfloat d = sc.z - bias;\n' +
  '\tvec2 t = 0.75 / uCsmMapSize;\n' +
  '\treturn 0.25 * ( step( d, unpackRGBAToDepth( texture2D( map, sc.xy + vec2( -t.x, -t.y ) ) ) )\n' +
  '\t\t+ step( d, unpackRGBAToDepth( texture2D( map, sc.xy + vec2( t.x, -t.y ) ) ) )\n' +
  '\t\t+ step( d, unpackRGBAToDepth( texture2D( map, sc.xy + vec2( -t.x, t.y ) ) ) )\n' +
  '\t\t+ step( d, unpackRGBAToDepth( texture2D( map, sc.xy + vec2( t.x, t.y ) ) ) ) );\n' +
  '}\n' +
  'float csmShadow( float ndl ) {\n' +
  '\tfloat bias = uCsmBias + uCsmSlopeBias * ( 1.0 - ndl );\n' +
  '\tfloat s = 1.0;\n' +
  // Cascade coords are computed HERE, only for the branch taken — 3 mat4×vec4 per VERTEX (7 M-triangle
  // scenes are vertex-bound) turned out far pricier than 1–2 per fragment.
  '\tvec4 wsP = vec4( vWsPos, 1.0 );\n' +
  // Static world shadows: cascade 1 covers the whole near/mid range, cascade 2 the far ring.
  '\tif ( vViewDepth < uCsmSplits.y ) {\n' +
  '\t\tcsmDebugTint = vec3( 0.1, 1.0, 0.1 );\n' +
  '\t\ts = csmPcf( uCsmMaps[ 1 ], uCsmMatrices[ 1 ] * wsP, bias );\n' +
  '\t\tfloat f = smoothstep( uCsmSplits.y * 0.85, uCsmSplits.y, vViewDepth );\n' +
  '\t\tif ( f > 0.0 ) s = mix( s, csmPcf( uCsmMaps[ 2 ], uCsmMatrices[ 2 ] * wsP, bias ), f );\n' +
  '\t} else if ( vViewDepth < uCsmSplits.z ) {\n' +
  '\t\tcsmDebugTint = vec3( 0.1, 0.1, 1.0 );\n' +
  '\t\ts = csmPcf( uCsmMaps[ 2 ], uCsmMatrices[ 2 ] * wsP, bias );\n' +
  '\t\ts = mix( s, 1.0, smoothstep( uCsmSplits.z * 0.9, uCsmSplits.z, vViewDepth ) );\n' +
  '\t}\n' +
  // Dynamic casters (cars/peds, the sun's own per-frame map) OVERLAY the near range via min().
  '\tif ( vViewDepth < uCsmSplits.x ) {\n' +
  '\t\ts = min( s, csmPcf( uCsmMaps[ 0 ], uCsmMatrices[ 0 ] * wsP, bias ) );\n' +
  '\t}\n' +
  '\treturn s;\n' +
  '}\n';

/** Fragment: 4-tap PCF over the RGBA-packed depth map; 1.0 = lit (outside the frustum = lit). */
const SHADOW_FRAGMENT_PARS =
  '#include <packing>\n' +
  'uniform sampler2D uWorldShadowMap;\n' +
  'uniform vec2 uWorldShadowMapSize;\n' +
  'uniform float uWorldShadowStrength;\n' +
  'uniform float uWorldShadowBias;\n' +
  'uniform float uWorldShadowDebug;\n' +
  'varying vec4 vWorldShadowCoord;\n' +
  'float worldShadowTap( vec2 uv, float depth ) {\n' +
  '\treturn step( depth, unpackRGBAToDepth( texture2D( uWorldShadowMap, uv ) ) );\n' +
  '}\n' +
  'float worldShadow() {\n' +
  '\tvec3 sc = vWorldShadowCoord.xyz / vWorldShadowCoord.w;\n' +
  '\tif ( sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0 ) return 1.0;\n' +
  '\tfloat d = sc.z - uWorldShadowBias;\n' +
  '\tvec2 t = 0.75 / uWorldShadowMapSize;\n' +
  '\treturn 0.25 * ( worldShadowTap( sc.xy + vec2( -t.x, -t.y ), d ) + worldShadowTap( sc.xy + vec2( t.x, -t.y ), d )\n' +
  '\t\t+ worldShadowTap( sc.xy + vec2( -t.x, t.y ), d ) + worldShadowTap( sc.xy + vec2( t.x, t.y ), d ) );\n' +
  '}\n';

/**
 * Patch a night-lit timed window overlay (build-region) to **glow** additively over the night
 * blend: `+ texture × windowGlow`, injected after the (no-night-variant) world tint so the glow is
 * never dimmed. Composes with the material's existing `onBeforeCompile` like `applyNightFill`.
 */
export function applyWorldWindowGlow(material: MeshBasicMaterial): void {
  const previousCompile = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = (): string => `${previousKey()}|windowGlow`;
  material.onBeforeCompile = (shader, renderer): void => {
    previousCompile(shader, renderer);
    shader.uniforms.uWindowGlow = windowGlowUniform;
    shader.fragmentShader =
      'uniform float uWindowGlow;\n' +
      shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        '#ifdef USE_MAP\n\toutgoingLight += texture2D( map, vMapUv ).rgb * uWindowGlow;\n#endif\n#include <opaque_fragment>',
      );
  };
  material.needsUpdate = true;
}

export function buildWorldMaterial(
  rw: RWMaterial,
  geometry: RWGeometry,
  textures?: Map<string, Texture>,
): MeshBasicMaterial {
  const map = rw.texture && textures ? (textures.get(rw.texture.name.toLowerCase()) ?? null) : null;
  const hasVertexColors = (geometry.flags & GeometryFlag.PRELIT) !== 0;
  // SA "floodlight beam" geometry: a `white` placeholder texture whose soft cone is baked into the per-vertex
  // (prelit) ALPHA — the only transparency signal (neither the texture nor the material colour is translucent).
  // Render it alpha-BLENDED, not alpha-tested (the cone alpha is ~0.2 max; a 0.5 test would clip the whole
  // beam). build-clump feeds the vertex alpha as a vec4 `color` attribute for these. SF stadium floodbeams +
  // Vegas East building-site lights; the signature is self-contained (no IDE flag needed) — see plan 032.
  const beam = isVertexAlphaBeam(rw, geometry);
  const transparent = beam || (map ? Boolean(map.userData.hasAlpha) : rw.color[3] < 255);

  const material = new MeshBasicMaterial({
    alphaTest: transparent && !beam ? 0.5 : 0,
    color: map ? 0xffffff : (rw.color[0] << 16) | (rw.color[1] << 8) | rw.color[2],
    depthWrite: !beam,
    map,
    side: transparent ? DoubleSide : FrontSide,
    transparent,
    vertexColors: hasVertexColors,
  });
  material.name = rw.texture?.name ?? 'material';

  // The night blend needs both prelit sets; day-only geometry keeps the stock vColor multiply.
  // Tinting: no-night geometry (LODs etc.) rides `worldTintUniform` (sun-dimmed day → dark night
  // ambient); night-prelit geometry rides `worldDayTintUniform`, which relaxes to WHITE at night —
  // its night prelit set already IS the night picture, tinting it on top double-darkens it to black.
  const nightBlend = hasVertexColors && geometry.nightColors !== null;
  material.customProgramCacheKey = (): string => `${nightBlend ? 'saWorld|night' : 'saWorld'}${beam ? '|beam' : ''}`;
  material.onBeforeCompile = (shader): void => {
    shader.uniforms.uWorldShadowBias = worldShadowUniforms.uWorldShadowBias;
    shader.uniforms.uWorldShadowDebug = worldShadowUniforms.uWorldShadowDebug;
    shader.uniforms.uWorldShadowMap = worldShadowUniforms.uWorldShadowMap;
    shader.uniforms.uWorldShadowMapSize = worldShadowUniforms.uWorldShadowMapSize;
    shader.uniforms.uWorldShadowMatrix = worldShadowUniforms.uWorldShadowMatrix;
    shader.uniforms.uWorldShadowStrength = worldShadowUniforms.uWorldShadowStrength;
    shader.uniforms.uDirectScale = worldSunUniforms.uDirectScale;
    shader.uniforms.uIndirectScale = worldSunUniforms.uIndirectScale;
    shader.uniforms.uPipelineMix = worldSunUniforms.uPipelineMix;
    shader.uniforms.uSunColor = worldSunUniforms.uSunColor;
    shader.uniforms.uSunDir = worldSunUniforms.uSunDir;
    shader.uniforms.uSunFlat = worldSunUniforms.uSunFlat;
    shader.uniforms.uCsmBias = worldCsmUniforms.uCsmBias;
    shader.uniforms.uCsmMaps = worldCsmUniforms.uCsmMaps;
    shader.uniforms.uCsmMapSize = worldCsmUniforms.uCsmMapSize;
    shader.uniforms.uCsmMatrices = worldCsmUniforms.uCsmMatrices;
    shader.uniforms.uCsmMix = worldCsmUniforms.uCsmMix;
    shader.uniforms.uCsmSlopeBias = worldCsmUniforms.uCsmSlopeBias;
    shader.uniforms.uCsmSplits = worldCsmUniforms.uCsmSplits;
    shader.uniforms.uLocalColor = worldLocalLightUniforms.uLocalColor;
    shader.uniforms.uLocalCount = worldLocalLightUniforms.uLocalCount;
    shader.uniforms.uLocalDir = worldLocalLightUniforms.uLocalDir;
    shader.uniforms.uLocalPos = worldLocalLightUniforms.uLocalPos;
    shader.uniforms.uFogCutDistance = worldFogUniforms.uFogCutDistance;
    shader.uniforms.uFogHeightK = worldFogUniforms.uFogHeightK;
    shader.uniforms.uFogHeightMin = worldFogUniforms.uFogHeightMin;
    shader.uniforms.uFogLut = worldFogUniforms.uFogLut;
    shader.uniforms.uFogMix = worldFogUniforms.uFogMix;
    shader.uniforms.uFogStartDistance = worldFogUniforms.uFogStartDistance;

    // Both variants are tinted (the day arc must match across the street); they differ in WHICH
    // uniform feeds the slot — night-prelit models get the day-only tint that relaxes to white.
    shader.uniforms.uWorldTint = nightBlend ? worldDayTintUniform : worldTintUniform;

    let vertexPars =
      'uniform mat4 uWorldShadowMatrix;\nvarying vec4 vWorldShadowCoord;\n' +
      'varying vec3 vWsPos;\nvarying float vViewDepth;\nvarying vec3 vWsNormal;\n' +
      'uniform vec3 uSunDir;\nuniform float uSunFlat;\nvarying float vSunNdl;\n';
    let vertexBody = shader.vertexShader.replace('#include <project_vertex>', SHADOW_VERTEX);
    let fragmentPars =
      `${SHADOW_FRAGMENT_PARS}${CSM_FRAGMENT_PARS}uniform vec3 uWorldTint;\n` +
      'uniform vec3 uSunColor;\nuniform float uDirectScale;\nuniform float uIndirectScale;\n' +
      'uniform float uPipelineMix;\nvarying float vSunNdl;\n' +
      'uniform sampler2D uFogLut;\nuniform float uFogMix;\nuniform float uFogCutDistance;\n' +
      'uniform float uFogStartDistance;\nuniform float uFogHeightK;\nuniform float uFogHeightMin;\n' +
      LOCAL_LIGHTS_FRAGMENT_PARS;
    let fragmentBody = shader.fragmentShader;
    // Classic (038): tint × dynamic-object shadow darkening over the whole term. Modern (064): prelit becomes
    // the INDIRECT term (shadowed areas keep their baked GI) and the real sun × NdotL × shadow is ADDED on the
    // raw albedo — `saTexel`, captured before the prelit multiply. `uPipelineMix` blends the two paths, so the
    // classic look survives bit-exact at 0. The shadow factor comes from the CSM term when the cascades are
    // live (`uCsmMix`, plan 065), else the classic single map. Debug paints the term red (or R/G/B per
    // cascade when CSM is on).
    const opaque =
      'float wsShadow = uCsmMix > 0.5 ? csmShadow( vSunNdl ) : worldShadow();\n' +
      'vec3 saClassic = outgoingLight * uWorldTint * mix( 1.0, wsShadow, uWorldShadowStrength );\n' +
      'vec3 saModern = outgoingLight * uWorldTint * uIndirectScale\n' +
      '\t+ saTexel * ( uSunColor * vSunNdl * wsShadow * uDirectScale + saLocalLight() );\n' +
      'outgoingLight = mix( saClassic, saModern, uPipelineMix );\n' +
      'if ( uWorldShadowDebug > 0.5 ) outgoingLight = mix( csmDebugTint, outgoingLight, wsShadow );\n' +
      '#include <opaque_fragment>';

    if (nightBlend) {
      shader.uniforms.uDnBalance = dnBalanceUniform;
      vertexPars += 'attribute vec3 nightColor;\nvarying vec3 vNightColor;\n';
      vertexBody = vertexBody.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n\tvNightColor = nightColor;',
      );
      fragmentPars += 'uniform float uDnBalance;\nvarying vec3 vNightColor;\n';
      // `vColor.rgb` works whether vColor is vec3 (normal geometry) or vec4 (beam, USE_COLOR_ALPHA); the beam
      // also needs its per-vertex alpha (the cone) carried into the blended alpha. `saTexel` = the albedo
      // before the prelit multiply (the modern direct term lights it, not the prelit product).
      fragmentBody = fragmentBody.replace(
        '#include <color_fragment>',
        `\tvec3 saTexel = diffuseColor.rgb;\n\tdiffuseColor.rgb *= mix( vColor.rgb, vNightColor, uDnBalance );${beam ? '\n\tdiffuseColor.a *= vColor.a;' : ''}`,
      );
    } else {
      fragmentBody = fragmentBody.replace(
        '#include <color_fragment>',
        '\tvec3 saTexel = diffuseColor.rgb;\n#include <color_fragment>',
      );
    }

    shader.vertexShader = vertexPars + vertexBody;
    shader.fragmentShader =
      fragmentPars +
      fragmentBody.replace('#include <opaque_fragment>', opaque).replace('#include <fog_fragment>', FOG_FRAGMENT);
  };

  return material;
}

/**
 * Build the unlit SA world material for one map part. Param parity with `buildMaterial`:
 * texture-alpha → transparent + alphaTest + DoubleSide; untextured → the RW material colour;
 * prelit → vertex colours. When the geometry carries SA night colours (`nightColor` attribute,
 * set by `buildClumpParts`) the day prelit is blended toward them by {@link dnBalanceUniform};
 * everything is then multiplied by {@link worldTintUniform}.
 */
export { isVertexAlphaBeam } from '../mesh/prepare-clump';
