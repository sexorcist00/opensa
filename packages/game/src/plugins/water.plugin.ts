import {
  Color,
  DoubleSide,
  FogExp2,
  type Mesh,
  type MeshBasicMaterial,
  ShaderMaterial,
  type Texture,
  Vector2,
  type Vector3,
} from 'three';

import type { SeaState } from '../water/wave-params';
import type { Plugin, PluginContext } from './plugin';

/** Surface half-thickness for the underwater test (the mesh is a plane; give it a little tolerance). */
const SURFACE_EPSILON = 0.15;
/** Fallback sea when the host supplies no weather-driven state. */
const CALM_SEA: SeaState = { amplitude: 0.12, foam: 0.02, steepness: 0.18, windAngle: 0 };

/** The timecyc colours the water shader reflects/tints with (RGB 0–255). */
export interface WaterSample {
  /** Sky-horizon colour the water reflects at grazing angles. */
  horizon: Rgb;
  /** Sun-disc colour — the specular glint. */
  sun: Rgb;
  /** Deep-water tint seen looking straight down. */
  water: Rgb;
  /** Water opacity 0–1 (timecyc WaterRGBA alpha): high = opaque, the dark tint dominates. */
  waterAlpha: number;
  /** Underwater murk density 0–1 (timecyc `waterFogAlpha`) — how fast the deep tint swallows the view
   *  when the camera is submerged. Authored per hour/weather, parsed but unused until plan 069. */
  waterFogAlpha: number;
}

type Rgb = readonly [number, number, number];

const VERTEX = `
  varying vec3 vWorldPos;
  varying vec2 vUv;
  void main() {
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = `
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uWaterColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uSunColor;
  uniform sampler2D uMap;
  uniform float uGlint;
  uniform float uReflection;
  uniform float uWaterAlpha;
  uniform float uDarkness;
  uniform float uFogDensity;
  uniform sampler2D uFogLut;
  uniform float uFogMix;
  uniform float uFogCut;
  uniform float uFogStart;
  uniform float uAmplitude;
  uniform float uSteepness;
  uniform float uFoam;
  uniform float uWindAngle;
  uniform float uUnderwater;
  uniform sampler2D uDepth;
  uniform vec2 uResolution;
  uniform float uCameraNear;
  uniform float uCameraFar;
  uniform float uShoreDepth;
  uniform float uDepthMix;
  uniform float uSeaLevel;
  uniform float uInlandCalm;
  uniform float uShoreClarity;
  uniform float uWaterFogAlpha;
  varying vec3 vWorldPos;
  varying vec2 vUv;

  const float SWELL_SLOPE = 6.0;

  // Gerstner-style surface normal (plan 069): four wave trains aligned to the wind, summed analytically —
  // we take the SLOPE, not the displacement, because the water.dat quads are far too coarse to displace.
  // The shape reads through the lighting: rolling swell when calm, choppy peaks in a storm.
  vec3 waterNormal(vec2 p, float t, float viewDist, float energy, out float crest) {
    vec2 grad = vec2(0.0);
    float height = 0.0;
    vec2 wind = vec2(cos(uWindAngle), sin(uWindAngle));
    vec2 side = vec2(-wind.y, wind.x);
    vec2 dirs[4];

    dirs[0] = normalize(wind);
    dirs[1] = normalize(wind * 0.8 + side * 0.6);
    dirs[2] = normalize(wind * 0.9 - side * 0.5);
    dirs[3] = normalize(wind * 0.4 + side * 1.0);
    float freqs[4]; freqs[0] = 0.045; freqs[1] = 0.083; freqs[2] = 0.150; freqs[3] = 0.260;
    float speeds[4]; speeds[0] = 0.9; speeds[1] = 1.2; speeds[2] = 1.6; speeds[3] = 2.1;
    float weights[4]; weights[0] = 1.0; weights[1] = 0.62; weights[2] = 0.38; weights[3] = 0.22;
    for (int i = 0; i < 4; i++) {
      // Distance LOD: a high-frequency train aliases into moiré BANDS once a pixel spans many wavelengths.
      // Fade each train out as its wavelength drops below the pixel footprint — the classic ocean-shader fix.
      float wavelength = 6.2831853 / freqs[i];
      float fade = smoothstep(wavelength * 55.0, wavelength * 12.0, viewDist);
      if (fade <= 0.001) continue;
      float phase = dot(p, dirs[i]) * freqs[i] + t * speeds[i];
      float s = sin(phase);
      float c = cos(phase);
      // Steepness sharpens crests and flattens troughs (the Gerstner look) without moving vertices.
      float sharp = mix(1.0, 1.0 - 0.55 * (0.5 - 0.5 * s), uSteepness);
      grad += dirs[i] * c * freqs[i] * weights[i] * sharp * uAmplitude * 22.0 * fade * energy;
      height += s * weights[i] * fade;
    }
    // Close-up detail: the authored waterclear256 ripple (particle.txd), scrolled in two directions and read
    // as a slope — real texture detail near the camera, where the analytic trains are too smooth. Always on
    // (even in a dead calm the surface must shimmer), so the water never looks frozen.
    float dScale = 0.09;
    float near = smoothstep(200.0, 20.0, viewDist);
    if (near > 0.001) {
      vec2 duv = p * dScale;
      float e = 0.06;
      vec2 flow = wind * t * 0.004;
      float h0 = texture2D(uMap, duv + flow).r + texture2D(uMap, duv * 1.7 - flow * 1.3).r;
      float hx = texture2D(uMap, duv + vec2(e, 0.0) + flow).r + texture2D(uMap, (duv + vec2(e, 0.0)) * 1.7 - flow * 1.3).r;
      float hy = texture2D(uMap, duv + vec2(0.0, e) + flow).r + texture2D(uMap, (duv + vec2(0.0, e)) * 1.7 - flow * 1.3).r;
      grad += vec2(hx - h0, hy - h0) * (1.5 * near * max(energy, 0.3));
    }
    // Slow cross-swell keeps the far water alive even when the trains are calm.
    float cs = 0.5 * 0.022 * cos((p.x + p.y) * 0.022 + t * 0.9);
    grad.x += (0.015 * cos(p.x * 0.015 + t * 0.7) + cs) * SWELL_SLOPE;
    grad.y += (0.8 * 0.011 * cos(p.y * 0.011 - t * 0.6) + cs) * SWELL_SLOPE;
    crest = smoothstep(0.35, 1.1, height); // whitecaps ride the tops only
    return normalize(vec3(-grad.x, 1.0, -grad.y));
  }

  // three's unpackRGBAToDepth (we can't #include chunks in a raw ShaderMaterial).
  const vec4 UNPACK = vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0);
  float unpackDepth(vec4 rgba) { return dot(rgba, UNPACK); }

  // GGX specular — a physical highlight that tightens/loosens with the sea state, not a fixed power.
  float ggx(vec3 n, vec3 v, vec3 l, float rough) {
    vec3 h = normalize(v + l);
    float a = max(rough * rough, 1e-3);
    float ndh = max(dot(n, h), 0.0);
    float d = a / (3.14159265 * pow(ndh * ndh * (a - 1.0) + 1.0, 2.0));
    return d * max(dot(n, l), 0.0);
  }

  // The sky reflected along the given direction, from the 067 sky LUT (azimuth x elevation) — the same
  // texture the fog already binds, so this reflection is free.
  vec3 skyReflection(vec3 dir) {
    float azimuth = atan(dir.z, dir.x) / 6.2831853 + 0.5;
    float elev = clamp(dir.y / 0.7, 0.0, 1.0);
    return texture2D(uFogLut, vec2(azimuth, elev)).rgb;
  }

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float viewDist = distance(cameraPosition, vWorldPos);
    vec2 wind2 = vec2(cos(uWindAngle), sin(uWindAngle));
    // Inland water (pools, lakes on hills) must not run an ocean swell — only the sea (at sea level) does.
    // A pool sits well above uSeaLevel, so its wave energy collapses to a gentle shimmer.
    float energy = mix(uInlandCalm, 1.0, 1.0 - smoothstep(0.4, 3.0, abs(vWorldPos.y - uSeaLevel)));
    float crest = 0.0;
    vec3 n = waterNormal(vWorldPos.xz, uTime, viewDist, energy, crest);
    if (uUnderwater > 0.5) {
      n = -n; // from below, the surface shows the murk, not the sky
    }

    // Shore depth (plan 069 §2): the depth pass renders the world WITHOUT the water, so the distance from
    // this fragment down to the sea floor is readable. Shallow water is clear (the floor shows through),
    // deep water is the timecyc tint — the biggest realism jump per ms, and foam rides the shoreline.
    // The DepthPass writes RGBA-PACKED depth (MeshDepthMaterial, RGBADepthPacking) — reading .x gives
    // garbage, which made every fragment read as "shallow" (glass water, no foam).
    vec2 screenUv = gl_FragCoord.xy / uResolution;
    float floorDepth = unpackDepth(texture2D(uDepth, screenUv));
    float floorView = uCameraFar * uCameraNear / ((uCameraFar - uCameraNear) * floorDepth - uCameraFar);
    float surfaceView = -(viewMatrix * vec4(vWorldPos, 1.0)).z;
    float waterDepth = max(floorView - surfaceView, 0.0); // metres of water under this fragment
    // Gate the shore term to the NEAR field: past ~130 m the far-plane depth precision is mush and any
    // submerged geometry (pier piles, the far shore) reads as "shallow" → phantom foam rings/bands. Far
    // water is just deep tint + fog, which is correct at that distance anyway.
    float nearShore = smoothstep(160.0, 90.0, viewDist);
    // Thin vertical geometry (pier piles) makes waterDepth jump between neighbouring pixels; that flicker
    // drove the foam/clarity halo around the piles. fwidth() detects the discontinuity and kills the shore
    // effects right there — a smooth sea floor has a small gradient and is unaffected.
    float floorEdge = 1.0 - smoothstep(0.6, 3.0, fwidth(waterDepth));
    float shallow = uDepthMix * nearShore * floorEdge * (1.0 - smoothstep(0.0, uShoreDepth, waterDepth));

    // Fresnel: grazing angles reflect the sky, top-down shows the (darkened) deep-water tint.
    float fres = pow(1.0 - max(dot(viewDir, n), 0.0), 5.0);
    vec3 deep = uWaterColor * (1.0 - uDarkness);
    vec3 refl = reflect(-viewDir, n);
    vec3 skyCol = uFogMix > 0.5 ? skyReflection(refl) : uHorizonColor;
    vec3 base = mix(deep, skyCol, clamp(fres * uReflection, 0.0, 1.0));
    float tex = texture2D(uMap, vUv).r; // a hint of the original water texture (caustic detail)
    base *= 0.5 + 0.4 * tex; // darken-only detail (<=1) — the timecyc water tint shouldn't be brightened

    // Sun glint: GGX against the real sun direction; a rougher sea shatters it into a long sparkling path.
    float rough = mix(0.06, 0.30, uSteepness);
    vec3 col = base + uSunColor * ggx(n, viewDir, uSunDir, rough) * uGlint;

    // SURF run-up: the waterline surges up the sand and draws back — a slow swell moves the shallow
    // threshold in and out, so the edge is alive instead of a frozen line. The band of foam rides the
    // moving edge; whitecaps ride the crests.
    float surge = 0.5 + 0.5 * sin(uTime * 0.6 + dot(vWorldPos.xz, wind2) * 0.02);
    float waterline = mix(0.62, 0.9, surge);           // where the "edge" sits this instant
    float edge = smoothstep(waterline - 0.12, waterline + 0.04, shallow) * (1.0 - smoothstep(waterline + 0.04, 1.0, shallow));
    float wash = smoothstep(0.4, waterline - 0.1, shallow) * 0.3;   // thin retreating wash behind the surf
    float foam = clamp(crest * uFoam * energy + (edge * 1.4 + wash) * uFoam, 0.0, 1.0);
    col = mix(col, vec3(0.92, 0.95, 0.97), foam);

    // Alpha: the timecyc water alpha runs low for many weathers (~0.27), reading as GLASS. Floor the deep
    // water at a believable opacity; the shallows lift transparency only part of the way (and only where the
    // shore term is active), so a beach is clear but open water is solid.
    float deepAlpha = max(uWaterAlpha, 0.72);
    float alpha = mix(deepAlpha, 1.0, fres);
    alpha = mix(alpha, mix(alpha, 0.45, uShoreClarity), shallow * (1.0 - foam));
    if (uUnderwater > 0.5) {
      // Submerged: the authored timecyc waterFogAlpha decides how murky the water reads.
      col = mix(col, deep, clamp(0.35 + 0.6 * uWaterFogAlpha, 0.0, 1.0));
      alpha = 1.0;
    }


    // Distance fog (the map's FogExp2 doesn't reach this custom shader): fade the far ocean into the
    // horizon colour so it dissolves like the terrain. Modern path (plan 068): the colour comes from the
    // horizon LUT by view azimuth and a smoothstep tail forces fog = 1.0 at the cut distance — the sea/sky
    // seam at the horizon dies by construction (the reported ocean-through-haze artefact).
    float fogDist = distance(cameraPosition, vWorldPos);
    float fogFactor = 1.0 - exp(-fogDist * fogDist * uFogDensity * uFogDensity);
    vec3 fogCol = uHorizonColor;
    if (uFogMix > 0.5) {
      vec3 fogView = vWorldPos - cameraPosition;
      float fogAzimuth = atan(fogView.z, fogView.x) / 6.2831853 + 0.5;
      float fogElev = clamp(fogView.y / max(length(fogView) * 0.7, 1e-3), 0.0, 1.0);
      fogCol = texture2D(uFogLut, vec2(fogAzimuth, fogElev)).rgb;
      float fogD = max(fogDist - uFogStart, 0.0);
      float fogK = 2.0 / max(uFogCut - uFogStart, 1.0);
      fogFactor = 1.0 - exp(-fogK * fogK * fogD * fogD);
      fogFactor = max(fogFactor, smoothstep(uFogCut * 0.85, uFogCut, fogDist));
    }
    col = mix(col, fogCol, fogFactor);
    alpha = mix(alpha, 1.0, fogFactor);

    gl_FragColor = vec4(col, alpha);
  }
`;

/**
 * Water surface upgrade: swaps the flat textured water mesh's material for a
 * `ShaderMaterial` with animated ripple normals + a slow swell (drifting highlights),
 * a fresnel sky reflection (deep water → horizon colour at grazing angles) and a
 * specular **sun glint** along the sun direction. Colours come from timecyc each frame;
 * the glint pairs with bloom. Renderware-free (the mesh/geometry is built in the adapter
 * and passed in).
 */
export class WaterPlugin implements Plugin {
  readonly name = 'water';

  private readonly getDepth?: () => null | { height: number; texture: null | Texture; width: number };
  private readonly getFog?: () => { cut: number; lut: null | Texture; mix: number; start: number };
  private readonly getHour: () => number;
  private readonly getSeaState: () => SeaState;
  private readonly getSunDir: () => Vector3;
  private material: null | ShaderMaterial = null;
  private readonly mesh: Mesh;
  private readonly sample: (hour: number) => WaterSample;

  private readonly scratch2 = new Vector2();

  constructor(
    mesh: Mesh,
    sample: (hour: number) => WaterSample,
    getHour: () => number,
    getSunDir: () => Vector3,
    getFog?: () => { cut: number; lut: null | Texture; mix: number; start: number },
    getSeaState?: () => SeaState,
    getDepth?: () => null | { height: number; texture: null | Texture; width: number },
  ) {
    this.getFog = getFog;
    this.getSeaState = getSeaState ?? ((): SeaState => CALM_SEA);
    this.getDepth = getDepth;
    this.mesh = mesh;
    this.sample = sample;
    this.getHour = getHour;
    this.getSunDir = getSunDir;
  }

  dispose(): void {
    this.material?.dispose();
  }

  install(context: PluginContext): void {
    const previous = this.mesh.material as MeshBasicMaterial;
    const map = previous.map;
    this.material = new ShaderMaterial({
      depthWrite: false,
      fragmentShader: FRAGMENT,
      side: DoubleSide,
      transparent: true,
      uniforms: {
        uAmplitude: { value: 0.12 },
        uCameraFar: { value: 100000 },
        uCameraNear: { value: 0.1 },
        uDarkness: { value: context.config.graphics.water.darkness },
        uDepth: { value: null },
        uDepthMix: { value: 0 },
        uFoam: { value: 0.02 },
        uFogCut: { value: 1200 },
        uFogDensity: { value: 0 },
        uFogLut: { value: null },
        uFogMix: { value: 0 },
        uFogStart: { value: 0 },
        uGlint: { value: context.config.graphics.water.glint },
        uHorizonColor: { value: new Color() },
        uInlandCalm: { value: 0.12 },
        uMap: { value: map },
        uReflection: { value: context.config.graphics.water.reflection },
        uResolution: { value: new Vector2(1, 1) },
        uSeaLevel: { value: 0 },
        uShoreClarity: { value: 0.55 },
        uShoreDepth: { value: 6 },
        uSteepness: { value: 0.18 },
        uSunColor: { value: new Color() },
        uSunDir: { value: this.getSunDir().clone() },
        uTime: { value: 0 },
        uUnderwater: { value: 0 },
        uWaterAlpha: { value: 0.9 },
        uWaterColor: { value: new Color() },
        uWaterFogAlpha: { value: 0.5 },
        uWindAngle: { value: 0 },
      },
      vertexShader: VERTEX,
    });
    this.mesh.material = this.material;
    previous.dispose();
  }

  update(context: PluginContext): void {
    if (!this.material) {
      return;
    }
    const sky = this.sample(this.getHour());
    const waterCfg = context.config.graphics.water;
    const u = this.material.uniforms;
    u.uTime.value = context.clock.elapsed;
    // Match the scene fog the FogPlugin set (FogExp2 density; 0 when off, e.g. map viewer).
    u.uFogDensity.value = context.scene.fog instanceof FogExp2 ? context.scene.fog.density : 0;
    const fog = this.getFog?.();
    if (fog) {
      u.uFogCut.value = fog.cut;
      u.uFogLut.value = fog.lut;
      u.uFogMix.value = fog.mix;
      u.uFogStart.value = fog.start;
    }
    u.uDarkness.value = context.config.graphics.water.darkness;
    u.uGlint.value = context.config.graphics.water.glint;
    u.uReflection.value = context.config.graphics.water.reflection;
    u.uWaterAlpha.value = sky.waterAlpha;
    u.uWaterFogAlpha.value = sky.waterFogAlpha;
    // Sea state (plan 069): the weather drives wave height/steepness/foam and a stable wind heading.
    const sea = this.getSeaState();
    u.uAmplitude.value = sea.amplitude * waterCfg.waves;
    u.uSteepness.value = sea.steepness;
    u.uFoam.value = sea.foam * waterCfg.foam;
    u.uWindAngle.value = sea.windAngle;
    u.uShoreDepth.value = waterCfg.shoreDepth;
    // Shore depth needs the scene depth WITHOUT the water — the DepthPass (postfx) renders it for us.
    const depth = this.getDepth?.();
    u.uDepth.value = depth?.texture ?? null;
    u.uDepthMix.value = depth?.texture ? 1 : 0; // no depth pass → no shore term at all (classic path)
    // The depth RT is HALF-res, but its UVs are [0,1] — so gl_FragCoord (full-res) must divide by the
    // FULL drawing-buffer size, not the RT size (dividing by half-res sent the UV off-screen → the shader
    // read random geometry depth: scattered foam blobs, no shoreline, glassy water).
    context.renderer.getDrawingBufferSize(this.scratch2);
    (u.uResolution.value as Vector2).copy(this.scratch2);
    // Sea level: the ocean surface. Inland pools/lakes sit above it and get a calm, gentle shimmer only.
    u.uSeaLevel.value = this.mesh.position.y;
    u.uShoreClarity.value = waterCfg.shoreClarity;
    u.uCameraNear.value = context.camera.near;
    u.uCameraFar.value = context.camera.far;
    // Underwater: the camera below the surface flips the normal and drowns the sky in the deep tint.
    u.uUnderwater.value = context.camera.position.y < this.mesh.position.y + SURFACE_EPSILON ? 1 : 0;
    (u.uSunDir.value as Vector3).copy(this.getSunDir());
    // Raw sRGB (ShaderMaterial output isn't colorspace-converted) so the water matches the sky dome.
    (u.uWaterColor.value as Color).setRGB(sky.water[0] / 255, sky.water[1] / 255, sky.water[2] / 255);
    (u.uHorizonColor.value as Color).setRGB(sky.horizon[0] / 255, sky.horizon[1] / 255, sky.horizon[2] / 255);
    (u.uSunColor.value as Color).setRGB(sky.sun[0] / 255, sky.sun[1] / 255, sky.sun[2] / 255);
  }
}
