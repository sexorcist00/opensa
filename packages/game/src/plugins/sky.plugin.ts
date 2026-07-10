import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  CanvasTexture,
  Color,
  DirectionalLight,
  type DirectionalLightShadow,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PCFSoftShadowMap,
  type PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  type Texture,
  Vector3,
  WebGLRenderTarget,
} from 'three';

import type { MoonConfig, NightConfig, SkyConfig } from '../interfaces/config.interface';
import type { Plugin, PluginContext } from './plugin';

import { pbrSkyParams } from '../sky/sky-params';
import { sunElevationAt } from './sun-position';

/** The timecyc values the sky/sun need (RGB 0–255 + sun floats). Grows as graphics expand. */
export interface SkySample {
  amb: Rgb;
  /** Object ambient (timecyc ambObj) — SA's warm, bright fill that actually lights world objects (the plain
   *  `amb` is near-black). Drives the day AmbientLight colour so the day reads warm, not flat grey/white. */
  ambObj: Rgb;
  /** Raw timecyc cloudAlpha 0–255 — the per-hour/weather opacity arc (modulates, never drives coverage:
   *  it is too noisy for that — see cloud-profile.ts). */
  cloudAlpha: number;
  /** Cloud underside / shadowed colour (timecyc bottomClouds). */
  cloudBottom: Rgb;
  /** Cloud cover 0–1 for this weather (curated per-weather profile, not raw cloudAlpha). */
  cloudCover: number;
  /** Cloud heaviness 0–1: thin/low-density cloud reads darker (heavier weather). */
  cloudDark: number;
  /** Cloud lit / top colour (timecyc lowClouds). */
  cloudTop: Rgb;
  dir: Rgb;
  /** timecyc draw/fog range (plan 068): world units; the modern fog derives its cut/start from these. */
  farClip: number;
  fogStart: number;
  skyBot: Rgb;
  skyTop: Rgb;
  spriteBright: number;
  spriteSize: number;
  sunCore: Rgb;
  sunCorona: Rgb;
  sunSize: number;
}

type Rgb = readonly [number, number, number];

/** Sky-dome radius and how far along its direction the sun sprite sits (both < camera.far). */
const RADIUS = 4000;
const SUN_DISTANCE = 3500;

/** Render layer the sky (dome + sun) is *also* on, so a reflection cube probe can render sky-only. */
export const SKY_PROBE_LAYER = 1;

/** Sun shadow map: resolution, ortho half-extent (world units around the view), light distance + far plane.
 *  The half-extent is tight (plan 038): only dynamics (vehicles/peds near the view) cast — the unlit map
 *  neither casts nor receives through the renderer — so a small frustum keeps the 2048 map sharp. */
const SHADOW_MAP = 2048;
const SHADOW_SIZE = 45;
const SHADOW_DISTANCE = 400;
const SHADOW_FAR = 900;

/** Reusable vectors for the shadow-frustum texel snapping (light-space basis). */
const WORLD_UP = new Vector3(0, 1, 0);
const WORLD_X = new Vector3(1, 0, 0);
const shadowForward = new Vector3();
const shadowRight = new Vector3();
const shadowUp = new Vector3();
const shadowFocus = new Vector3();

// The sun's day window (rise → set) is NOT hardcoded — it tracks the `litFade` dawn/dusk window
// (config.graphics.night.litFade), so it stays in sync with the world darkening and custom timecyc setups:
// rise begins at `dawnStart`, fully below the horizon by `duskEnd`. The arc math lives in `sunElevationAt`
// (pure, unit-tested in sun-position.test.ts).

/** Light tuning (timecyc dir/dirMult are ~constant for EXTRASUNNY, so day/night rides the sun height). */
const SUN_INTENSITY = 2.2; // directional at peak
/** Ambient base fill: a small WARM uniform term (the hemisphere skylight below carries most of the day fill +
 *  form), near-zero at night where the baked **night vertex colours** take over. NB SA's timecyc `amb` is tiny
 *  (~0.03 — it leans on the directional + prelit), so using it directly left day shadows pitch black. */
const AMBIENT_DAY = 1.5; // scales the timecyc object-ambient (ambObj) colour into the day AmbientLight intensity
const AMBIENT_NIGHT = 0.04;
/** Skylight (hemisphere fill): by DAY a warm sky from above + a tan ground bounce from below — gives buildings
 *  form and warmth on the shadow side (a flat white ambient looked grey/cold/flat once night vertex faded). By
 *  NIGHT it cross-fades to a moonlit blue (near-black ground). Day strength is constant; night rides
 *  `night.skylight` × the night factor. */
const DAY_SKY_COLOR = new Color(1.0, 0.95, 0.86);
const DAY_GROUND_COLOR = new Color(0.5, 0.42, 0.32);
const DAY_SKYLIGHT = 0.4; // lower now that the warm timecyc object-ambient carries most of the day fill
const NIGHT_SKY_COLOR = new Color(0.42, 0.52, 0.8);
const NIGHT_GROUND_COLOR = new Color(0.08, 0.09, 0.13);
/** Heavy overcast: how much the direct sun is dimmed. */
const OVERCAST_DIM = 0.8;
/** Corona (glow) size relative to the sun core. */
const CORONA_RATIO = 4.5;

/** Static moon: its compass direction (horizontal, x/z); the height comes from config (`elevationDeg`).
 *  `MOON_DISTANCE` = how far along the resulting direction the sprite sits (< camera.far). */
const MOON_AZIMUTH = new Vector3(0.35, 0, 0.4).normalize();
const MOON_DISTANCE = 3400;

/**
 * Shared sky-base GLSL (plan 067): the classic timecyc gradient + the Preetham physical sky behind
 * `uPbrMix`, blended back to the gradient at night (`uPbrNight` — Preetham is a day model; SA's authored
 * night palette stays). Used VERBATIM by both the dome fragment and the horizon-LUT fragment so the LUT
 * always matches the visible sky. Output stays LDR-scaled (`uSkyExposure`) — the composer buffer is
 * UnsignedByte, values above 1 would clip before the ACES pass (HDR buffers = a later upgrade).
 */
const SKY_BASE_GLSL = `
  uniform vec3 uTop;
  uniform vec3 uBottom;
  uniform float uPbrMix;
  uniform float uPbrNight;
  uniform vec3 uBetaR;
  uniform vec3 uBetaM;
  uniform float uSunE;
  uniform float uMieG;
  uniform vec3 uPbrTint;
  uniform vec3 uSunDirSky;
  uniform float uSkyExposure;

  vec3 pbrSky(vec3 rawDir) {
    vec3 dir = normalize(vec3(rawDir.x, max(rawDir.y, 0.0015), rawDir.z)); // below horizon = horizon colour
    float zenith = acos(min(1.0, dir.y));
    float denom = cos(zenith) + 0.15 * pow(93.885 - degrees(zenith), -1.253);
    vec3 fex = exp(-(uBetaR * (8400.0 / denom) + uBetaM * (1250.0 / denom)));
    float cosTheta = dot(dir, uSunDirSky);
    float rPhase = 0.0596831 * (1.0 + cosTheta * cosTheta);
    float g2 = uMieG * uMieG;
    float mPhase = 0.0795775 * (1.0 - g2) / pow(1.0 - 2.0 * uMieG * cosTheta + g2, 1.5);
    vec3 betaTotal = max(uBetaR + uBetaM, vec3(1e-9));
    vec3 scatter = (uBetaR * rPhase + uBetaM * mPhase) / betaTotal;
    vec3 lin = pow(uSunE * scatter * (1.0 - fex), vec3(1.5));
    lin *= mix(vec3(1.0), pow(uSunE * scatter * fex, vec3(0.5)),
               clamp(pow(1.0 - uSunDirSky.y, 5.0), 0.0, 1.0));
    vec3 l0 = 0.1 * fex;
    return ((lin + l0) * 0.04 + vec3(0.0, 0.0003, 0.00075)) * uSkyExposure * uPbrTint;
  }

  uniform vec3 uCloudTop;
  uniform vec3 uCloudBottom;
  uniform float uTime;
  uniform float uCloudCoverage;
  uniform float uCloudOpacity;
  uniform float uCloudDark;
  uniform vec3 uCloudSunTint; // timecyc sun colour × golden-hour strength — dawn/dusk cloud rims
  uniform vec3 uMoonDirSky;   // moon direction (world) — the night sky's light source
  uniform vec3 uMoonGlow;     // premultiplied cool moon-scatter colour (brightness × phase/cloud fade)
  uniform vec3 uCityGlow;     // premultiplied warm urban skyglow (SA is a city — nights are never black)

  vec3 skyBase(vec3 dir) {
    float t = smoothstep(0.0, 1.0, clamp(dir.y, 0.0, 1.0));
    vec3 grad = mix(uBottom, uTop, t);
    if (uPbrMix < 0.5) return grad;
    vec3 pbr = pbrSky(dir);
    pbr = pbr / (1.0 + pbr); // Reinhard: the composer buffer is LDR — raw HDR would CLIP white before ACES
    // Overcast hands the sky back to the AUTHORED timecyc gradient: under a full deck the atmosphere is
    // invisible anyway — the physical model degenerates into a milky Mie wash that fights the dark deck
    // (user report). Clear skies keep pure Preetham; the blend rides the same coverage the deck uses.
    vec3 res = mix(pbr, grad, max(uPbrNight, uCloudCoverage * 0.85));
    // Night sky glow (the "PBR night"): the authored SA night gradient is near-black — add the moon's
    // cool Rayleigh scatter (halo + a soft lift of its sky hemisphere) and the warm URBAN skyglow band at
    // the horizon (San Andreas is a metropolis; city nights are never black). Rides uPbrNight so it fades
    // in through twilight; also feeds the fog LUT → night fog matches the glowing horizon.
    if (uPbrNight > 0.01) {
      float moonHalo = pow(max(dot(dir, uMoonDirSky), 0.0), 8.0);
      float moonHemi = 0.5 + 0.5 * dot(dir, uMoonDirSky);
      float band = pow(1.0 - clamp(dir.y, 0.0, 1.0), 6.0);
      res += (uMoonGlow * (moonHalo * 0.6 + moonHemi * moonHemi * 0.12) + uCityGlow * band) * uPbrNight;
    }
    return res;
  }


  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + 1.7; a *= 0.5; }
    return v;
  }

  // The cloud layers, shared by the dome AND the sky LUT (plan 068) — fully-fogged geometry must dissolve
  // into the CLOUDY sky it stands against, not a cloudless one. Stage A (plan 067): two layers + sun light.
  vec3 applyClouds(vec3 col, vec3 dir) {
    if (uCloudOpacity <= 0.0 || dir.y <= 0.0) return col;
    float horizon = smoothstep(0.02, 0.30, dir.y);

    // Layer 1 — CIRRUS: thin, high, stretched wisps drifting slowly on their own heading; they belong to
    // clear skies, so coverage suppresses them (overcast hides cirrus behind the cumulus deck anyway).
    vec2 cuv2 = dir.xz / max(dir.y, 0.12) * vec2(0.9, 0.35) + vec2(uTime * 0.0013, uTime * -0.0007) + 31.7;
    float cirrus = smoothstep(0.60, 0.92, fbm(cuv2)) * (1.0 - uCloudCoverage) * 0.55;
    vec3 cirrusCol = mix(uCloudBottom, uCloudTop, 0.85) + uCloudSunTint * 0.2;
    col = mix(col, cirrusCol, cirrus * horizon * uCloudOpacity);

    // Layer 2 — CUMULUS (the weather deck): coverage-thresholded fbm masses, lit tops / dark undersides.
    vec2 cuv = dir.xz / max(dir.y, 0.12) * 0.45 + vec2(uTime * 0.004, uTime * 0.002);
    float n = fbm(cuv);
    float mass = fbm(cuv * 0.4 + 19.0);
    float edge = mix(0.92, -0.25, uCloudCoverage);
    float density = smoothstep(edge, edge + 0.20, n);
    vec3 cloudCol = mix(uCloudBottom, uCloudTop, smoothstep(0.30, 0.80, n));
    float bright = smoothstep(0.20, 0.72, n) * mix(0.35, 1.0, smoothstep(0.30, 0.72, mass));
    float shade = mix(0.16, 1.0, bright);
    cloudCol *= mix(1.0, shade, uCloudDark);
    // Fine detail octave: at full coverage the low-frequency masses degenerate into huge soft smears —
    // one cheap high-frequency noise breaks them into readable cloud texture.
    float det = vnoise(cuv * 5.7 + vec2(uTime * 0.006, 0.0));
    cloudCol *= 0.88 + 0.24 * det;
    // Sun light on the deck (timecyc sun colour): golden-hour rims near the sun, silver lining on the
    // bright cores. Gated by CLEARNESS — an overcast deck blocks the sun, it must not glow through
    // (a red smear over the whole cloudy sky otherwise).
    float toSun = max(dot(dir, uSunDirSky), 0.0);
    float rim = pow(toSun, 5.0);
    float clearness = 1.0 - uCloudCoverage * 0.85;
    cloudCol += uCloudSunTint * rim * (0.25 + 0.75 * bright) * clearness;
    return mix(col, cloudCol, density * horizon * uCloudOpacity);
  }

  // ---- Volumetric clouds (plan 067 Stage B, ultra tier; uCloudVolumetric gates) --------------------
  uniform float uCloudVolumetric;

  float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123); }
  float vnoise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    float a = hash3(i);
    float b = hash3(i + vec3(1.0, 0.0, 0.0));
    float c = hash3(i + vec3(0.0, 1.0, 0.0));
    float d = hash3(i + vec3(1.0, 1.0, 0.0));
    float e = hash3(i + vec3(0.0, 0.0, 1.0));
    float g = hash3(i + vec3(1.0, 0.0, 1.0));
    float h = hash3(i + vec3(0.0, 1.0, 1.0));
    float k = hash3(i + vec3(1.0, 1.0, 1.0));
    return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
  }
  float fbm3(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * vnoise3(p); p = p * 2.13 + 5.7; a *= 0.5; }
    return v;
  }

  // Density in the cloud slab: a 2D weather field (same coverage threshold as the flat deck — the same
  // timecyc/profile drives both) shaped vertically (rounded base, feathered top) and carved by 3D noise.
  float volCloudDensity(vec3 pos) {
    float hNorm = (pos.y - 500.0) / 500.0; // slab: 500..1000 world units
    if (hNorm < 0.0 || hNorm > 1.0) return 0.0;
    float heightProfile = smoothstep(0.0, 0.2, hNorm) * smoothstep(1.0, 0.5, hNorm);
    vec2 wuv = pos.xz * 0.00042 + vec2(uTime * 0.0025, uTime * 0.0012);
    float weather = fbm(wuv);
    float edge = mix(0.92, -0.25, uCloudCoverage);
    float coverage = smoothstep(edge, edge + 0.30, weather);
    float base = fbm3(vec3(pos.x * 0.0011, pos.y * 0.0022, pos.z * 0.0011) + vec3(uTime * 0.012, 0.0, 0.0));
    return coverage * heightProfile * smoothstep(0.32, 0.72, base);
  }

  vec3 applyVolumetricClouds(vec3 col, vec3 dir) {
    if (uCloudOpacity <= 0.0 || dir.y <= 0.02) return col;
    float horizon = smoothstep(0.02, 0.22, dir.y);
    // March the slab [500, 1000] from the (slab-relative) ground: only sky pixels pay this. The slant is
    // CAPPED — at grazing angles the slab stretches to tens of km (huge steps = coarse banding + wasted
    // cost); the horizon fade hides the truncation.
    float t0 = 500.0 / dir.y;
    if (t0 > 14000.0) return col;
    float t1 = min(1000.0 / dir.y, t0 + 5500.0);
    const int STEPS = 24;
    float stepT = (t1 - t0) / float(STEPS);
    // Per-pixel jitter of the ray start: breaks the fixed-step iso-contour "onion rings" into
    // imperceptible grain (the classic raymarch banding fix).
    float jitter = hash(gl_FragCoord.xy + vec2(uTime * 61.7, 0.0));
    float trans = 1.0;
    vec3 acc = vec3(0.0);
    // Lighting: timecyc keeps directing — sun tint (golden hour) + the authored deck colours as ambient.
    vec3 sunCol = uCloudSunTint * 2.0 + uCloudTop * 0.5;
    vec3 ambCol = mix(uCloudBottom, uCloudTop, 0.45);
    float mu = dot(dir, uSunDirSky);
    float g = 0.55;
    float phase = 0.5 + (1.0 - g * g) / (12.566 * pow(1.0 + g * g - 2.0 * g * mu, 1.5)); // HG toward the sun
    for (int i = 0; i < STEPS; i++) {
      vec3 pos = dir * (t0 + (float(i) + jitter) * stepT);
      float den = volCloudDensity(pos);
      if (den <= 0.002) continue;
      // two-tap light march toward the sun: self-shadowed bases, lit tops (Beer's law + a powder-ish lift)
      float lightDen = volCloudDensity(pos + uSunDirSky * 130.0) * 0.65
        + volCloudDensity(pos + uSunDirSky * 320.0) * 0.35;
      float light = exp(-lightDen * 2.4);
      vec3 sample_ = ambCol * (0.5 + 0.28 * light) + sunCol * light * phase;
      sample_ *= mix(1.0, mix(0.25, 1.0, light), uCloudDark); // heavy weather darkens the unlit mass
      float alpha = 1.0 - exp(-den * stepT * 0.010 * uCloudOpacity);
      acc += trans * alpha * sample_;
      trans *= 1.0 - alpha;
      if (trans < 0.04) break;
    }
    return mix(col, col * trans + acc, horizon);
  }
`;

/** Horizon-LUT pass (plan 067): 512×1, azimuth → the sky's colour at eye level. Rendered only when the
 *  sky STATE changes (hour/weather/model quantized), THE shared fog/water colour source from 068 on. */
const LUT_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const LUT_FRAGMENT =
  SKY_BASE_GLSL +
  `
  varying vec2 vUv;
  void main() {
    // u is sampled by the fog shaders as atan(z,x)/2pi + 0.5 — bake the SAME half-turn phase here, or the
    // fog reads the OPPOSITE side of the horizon (white dawn fog against the teal anti-sun sky).
    float phi = (vUv.x - 0.5) * 6.2831853;
    // v: view elevation 0 (eye level) → ~44° (0.7 in dir.y) — tall fogged geometry (skyscrapers) must
    // dissolve into the sky AT ITS OWN ELEVATION, not into the bright horizon haze band.
    float dirY = max(0.035, vUv.y * 0.7);
    float h = sqrt(max(1.0 - dirY * dirY, 1e-4));
    vec3 dir = normalize(vec3(cos(phi) * h, dirY, sin(phi) * h));
    vec3 lutCol = skyBase(dir);
    lutCol = uCloudVolumetric > 0.5 ? applyVolumetricClouds(lutCol, dir) : applyClouds(lutCol, dir);
    gl_FragColor = vec4(lutCol, 1.0);
  }
`;

const VERTEX = `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position); // direction from the dome centre (the view direction)
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT =
  SKY_BASE_GLSL +
  `
  uniform float uNight;  // 0 day → 1 deep night (drives the star fade)
  uniform float uStars;  // master toggle (0 = off, skip)
  uniform float uCloudClear;  // 1 = clear sky → 0 = overcast (fades stars globally, like the moon)
  varying vec3 vDir;

  // Procedural stars on the upper hemisphere: a gnomonic projection of the view direction tiled into
  // cells, ~one star per lit cell with a random brightness + gentle twinkle. Tapers toward the horizon.
  vec3 starField(vec3 dir) {
    if (dir.y <= 0.02) return vec3(0.0);
    vec2 uv = dir.xz / dir.y * 6.0; // project the dome; density scale
    vec2 cell = floor(uv), f = fract(uv);
    float present = step(0.90, hash(cell)); // ~10% of cells hold a star
    vec2 star = vec2(hash(cell + 1.7), hash(cell + 4.3)); // its position within the cell
    float d = length(f - star);
    float dot_ = smoothstep(0.06, 0.0, d) * present; // tight point
    float bright = 0.35 + 0.65 * hash(cell + 8.1);
    float twinkle = 0.6 + 0.4 * sin(uTime * 2.5 + hash(cell) * 90.0);
    float taper = smoothstep(0.02, 0.35, dir.y); // fade out near the horizon haze
    return vec3(dot_ * bright * twinkle * taper);
  }

  void main() {
    vec3 dir = normalize(vDir);
    vec3 col = skyBase(dir); // classic gradient or the Preetham sky (uPbrMix), night-blended back to SA

    // Stars: night-gated, and faded globally by cloud cover (uCloudClear) so overcast hides them like the
    // moon — not just where the procedural cloud noise happens to be dense. The cloud blend below still covers
    // any that remain in clear patches.
    if (uStars > 0.5 && uNight > 0.0) {
      col += starField(dir) * uNight * uCloudClear;
    }

    // Shared with the sky LUT — fog dissolves into the CLOUDY sky. Volumetric (Stage B) replaces the
    // flat deck when enabled; both ride the same timecyc/profile drivers.
    col = uCloudVolumetric > 0.5 ? applyVolumetricClouds(col, dir) : applyClouds(col, dir);

    col += (hash(gl_FragCoord.xy) - 0.5) / 255.0; // dither to break gradient banding
    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * Sky + sun, driven by timecyc for the time of day (phase 1–2 of the graphics work):
 * a gradient sky dome (`skyBot`→`skyTop`), a sun that rises at the east horizon and
 * sets at the west, a sun-tracking directional light (fades to night with the sun
 * height), and an ambient fill. Camera-following; the dome/sun are unlit + unfogged.
 * Renderware-free — it takes a plain colour sampler so it can live in `game/**`.
 */
export class SkyPlugin implements Plugin {
  /**
   * Dedicated light source for the god-rays effect — a separate Mesh sized independently
   * of the visible disc (`godraysSize`), so rays can stay strong while the disc looks small.
   * Not added to the scene; `GodRaysEffect` renders it into its own internal light scene.
   */
  readonly godraysSource: Mesh;

  readonly name = 'sky';
  /** The visible sun disc (a Mesh, not a Sprite). */
  readonly sunSource: Mesh;

  private readonly ambient = new AmbientLight(0xffffff, 1);
  private cloudAlpha = 255; // timecyc per-hour opacity arc (modulation only)
  private cloudCover = 0.5; // weather-driven (timecyc cloudAlpha); the dome's coverage base
  private readonly corona: Sprite;
  private readonly dome: Mesh;
  private readonly getHour: () => number;
  private readonly lutCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly lutMaterial: ShaderMaterial;
  private readonly lutScene = new Scene();
  /** 512×32 sky LUT (plan 067/068): azimuth × view-elevation → sky colour; fog/water sample it. */
  private readonly lutTarget = new WebGLRenderTarget(512, 32, { depthBuffer: false });
  private readonly material: ShaderMaterial;
  private readonly moonDir = new Vector3(0, 1, 0);
  private readonly moonDisc: Sprite;
  private night = 0; // 0 day → 1 deep night (sun height); drives stars, moon, skylight + world tints/shadows
  private readonly sample: (hour: number) => SkySample;
  /** Sky-base uniform entries shared by the dome material and the horizon-LUT material (plan 067). */
  private readonly skyBaseUniforms = {
    uBetaM: { value: new Vector3(1e-7, 1e-7, 1e-7) },
    uBetaR: { value: new Vector3(1e-5, 2e-5, 3e-5) },
    uBottom: { value: new Color() },
    uCityGlow: { value: new Color(0, 0, 0) },
    uCloudBottom: { value: new Color() },
    uCloudCoverage: { value: 0.5 },
    uCloudDark: { value: 0 },
    uCloudOpacity: { value: 0.8 },
    uCloudSunTint: { value: new Color(0, 0, 0) },
    uCloudTop: { value: new Color() },
    uCloudVolumetric: { value: 0 },
    uMieG: { value: 0.8 },
    uMoonDirSky: { value: new Vector3(0, 1, 0) },
    uMoonGlow: { value: new Color(0, 0, 0) },
    uPbrMix: { value: 0 },
    uPbrNight: { value: 0 },
    uPbrTint: { value: new Color(1, 1, 1) },
    uSkyExposure: { value: 0.55 },
    uSunDirSky: { value: new Vector3(0, 1, 0) },
    uSunE: { value: 0 },
    uTime: { value: 0 },
    uTop: { value: new Color() },
  };
  /** Night "skylight" — a hemisphere fill from above, faded in at night for form (intensity set per frame). */
  private readonly skylight = new HemisphereLight(NIGHT_SKY_COLOR, NIGHT_GROUND_COLOR, 0);
  private readonly sun = new DirectionalLight(0xffffff, 1);
  private readonly sunDir = new Vector3();

  constructor(sample: (hour: number) => SkySample, getHour: () => number, moonTexture: null | Texture = null) {
    this.sample = sample;
    this.getHour = getHour;
    this.material = new ShaderMaterial({
      depthWrite: false,
      fragmentShader: FRAGMENT,
      side: BackSide,
      uniforms: {
        uCloudClear: { value: 1 },
        uNight: { value: 0 },
        uStars: { value: 1 },
        ...this.skyBaseUniforms,
      },
      vertexShader: VERTEX,
    });
    this.lutMaterial = new ShaderMaterial({
      depthWrite: false,
      fragmentShader: LUT_FRAGMENT,
      uniforms: this.skyBaseUniforms, // SHARED objects — one update drives the dome AND the LUT
      vertexShader: LUT_VERTEX,
    });
    this.lutScene.add(new Mesh(new PlaneGeometry(2, 2), this.lutMaterial));
    this.dome = new Mesh(new SphereGeometry(RADIUS, 32, 16), this.material);
    this.dome.name = 'Sky';
    this.dome.renderOrder = -1;
    this.dome.frustumCulled = false;

    // Sun disc: a Mesh (god-rays needs a transparent, non-depth-writing Mesh light source).
    this.sunSource = new Mesh(
      new SphereGeometry(1, 16, 12),
      new MeshBasicMaterial({ blending: AdditiveBlending, depthWrite: false, fog: false, transparent: true }),
    );
    this.sunSource.name = 'Sun';
    // A second, invisible-in-scene Mesh whose only job is to be the god-rays light source
    // at its own (larger) scale; GodRaysEffect renders it itself, so it stays out of the scene.
    this.godraysSource = new Mesh(
      this.sunSource.geometry,
      new MeshBasicMaterial({ blending: AdditiveBlending, depthWrite: false, fog: false, transparent: true }),
    );
    this.godraysSource.name = 'SunGodrays';
    this.corona = sunSprite(radialTexture());

    // Moon: a static additive billboard using the SA `coronamoon` texture (alpha-shaped); falls back to a
    // soft radial glow if the texture is missing. Fades in with night; depth-tested so geometry occludes it.
    this.moonDisc = sunSprite(moonTexture ?? radialTexture());
    this.moonDisc.name = 'Moon';

    // Also expose the sky on the probe layer so the vehicle-reflection cube probe can render sky-only.
    for (const object of [this.dome, this.sunSource, this.corona, this.moonDisc]) {
      object.layers.enable(SKY_PROBE_LAYER);
    }
  }

  dispose(): void {
    for (const object of [
      this.dome,
      this.ambient,
      this.sun,
      this.sunSource,
      this.corona,
      this.moonDisc,
      this.skylight,
    ]) {
      object.removeFromParent();
    }
    this.dome.geometry.dispose();
    this.material.dispose();
    this.sunSource.geometry.dispose(); // shared with godraysSource
    (this.sunSource.material as MeshBasicMaterial).dispose();
    (this.godraysSource.material as MeshBasicMaterial).dispose();
    this.corona.material.dispose();
    this.corona.material.map?.dispose();
    this.moonDisc.material.dispose();
    this.moonDisc.material.map?.dispose();
  }

  /** The 512×1 horizon LUT (plan 067): azimuth → sky colour at eye level; fog/water consume it (068+).
   *  Alive in BOTH sky modes (the fog chunk needs one code path); valid from the first frame. */
  getHorizonLut(): Texture {
    return this.lutTarget.texture;
  }

  /** Unit direction toward the moon (three world space) — the world's night light source (plan 071). */
  getMoonDirection(): Vector3 {
    return this.moonDir;
  }

  /** Current sun direction in three world space (unit; points toward the sun). For water glints etc. */
  getSunDirection(): Vector3 {
    return this.sunDir;
  }

  /** The sun's shadow handle (map/matrix/intensity) — the SA world material's manual shadow-receive
   *  (plan 038) is driven from it each frame by the game layer. */
  getSunShadow(): DirectionalLightShadow {
    return this.sun.shadow;
  }

  /** Sine of the sun's elevation (1 zenith → negative below the horizon): the driver of every time band. */
  getSunSin(): number {
    return this.sunDir.y;
  }

  install(context: PluginContext): void {
    context.scene.add(this.dome, this.ambient, this.sun, this.sun.target, this.sunSource, this.corona);
    context.scene.add(this.moonDisc, this.skylight);

    // Directional sun shadows: a view-following orthographic shadow map. shadowMap.enabled stays on; the
    // runtime toggle is `sun.castShadow` (three recompiles materials when the shadow-light count changes).
    context.renderer.shadowMap.enabled = true;
    context.renderer.shadowMap.type = PCFSoftShadowMap;
    const shadowCam = this.sun.shadow.camera;
    shadowCam.left = -SHADOW_SIZE;
    shadowCam.right = SHADOW_SIZE;
    shadowCam.top = SHADOW_SIZE;
    shadowCam.bottom = -SHADOW_SIZE;
    shadowCam.near = 1;
    shadowCam.far = SHADOW_FAR;
    shadowCam.updateProjectionMatrix(); // apply the ortho extents (else it stays the default ±5 box)
    this.sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6; // small — high values bloat thin objects' shadows

    this.apply(
      context.config.graphics.sun.sunSize,
      context.config.graphics.sun.godraysSize,
      context.config.graphics.moon,
      context.config.graphics.night,
      context.config.graphics.sky,
    );
    this.updateShadow(context.camera, context.config.graphics.shadows.enabled);
  }

  update(context: PluginContext): void {
    this.dome.position.copy(context.camera.position); // keep the sky centred on the view
    this.apply(
      context.config.graphics.sun.sunSize,
      context.config.graphics.sun.godraysSize,
      context.config.graphics.moon,
      context.config.graphics.night,
      context.config.graphics.sky,
    ); // sets cloudCover/night
    const clouds = context.config.graphics.clouds;
    this.material.uniforms.uTime.value = context.clock.elapsed;
    // timecyc cloudAlpha modulates the opacity over the hour arc — but ONLY in clear weathers: it is too
    // noisy to drive coverage (see cloud-profile.ts), and Rockstar's CLOUDY rows carry LOW alphas that made
    // the overcast deck translucent (user report). Heavy cover keeps its authored opacity; clear skies breathe.
    this.skyBaseUniforms.uCloudVolumetric.value = clouds.volumetric ? 1 : 0;
    const alphaMod = 0.6 + 0.4 * (this.cloudAlpha / 255);
    const heavy = Math.min(1, this.cloudCover);
    this.material.uniforms.uCloudOpacity.value = clouds.opacity * (heavy + (1 - heavy) * alphaMod);
    // Cover = weather's cloudAlpha × the user multiplier (slider 0.5 = weather as-authored).
    this.material.uniforms.uCloudCoverage.value = Math.min(1, this.cloudCover * clouds.coverage * 2);
    this.material.uniforms.uNight.value = this.night;
    this.material.uniforms.uStars.value = context.config.graphics.stars.enabled ? 1 : 0;
    this.skyBaseUniforms.uPbrMix.value = context.config.graphics.sky.model === 'pbr' ? 1 : 0;
    this.renderHorizonLut(context);
    this.updateShadow(context.camera, context.config.graphics.shadows.enabled);
  }

  /** Push the current time-of-day sky/sun state into the dome, lights and sun/moon sprites. */
  private apply(
    sunScale: number,
    godraysScale: number,
    moon: MoonConfig,
    nightCfg: NightConfig,
    skyCfg: SkyConfig,
  ): void {
    const sky = this.sample(this.getHour());
    // Sky/cloud colours are authored in timecyc as 0–255 sRGB (like the sun colours), so decode them as
    // sRGB (managed) — NOT linear. Treating them as linear gamma-lifts the darks, which washed the near-black
    // night sky (timecyc [9,11,13]) into a bright grey ([53,59,64] on screen). Managed → it stays dark.
    setColor(this.material.uniforms.uTop.value as Color, sky.skyTop, true);
    setColor(this.material.uniforms.uBottom.value as Color, sky.skyBot, true);
    setColor(this.material.uniforms.uCloudTop.value as Color, sky.cloudTop, true);
    setColor(this.material.uniforms.uCloudBottom.value as Color, sky.cloudBottom, true);
    this.material.uniforms.uCloudDark.value = sky.cloudDark;
    this.cloudCover = sky.cloudCover;
    this.cloudAlpha = sky.cloudAlpha;

    // Sun rises at the litFade dawnStart and is fully below the horizon by duskEnd — same window the
    // world darkening uses, so the sun and the night stay in sync (and track a custom timecyc).
    const elevation = this.sunElevation(this.getHour(), nightCfg.litFade.dawnStart, nightCfg.litFade.duskEnd);
    const above = elevation > 0;
    const height = Math.max(0, Math.sin(elevation));
    // Night factor (0 day → 1 deep night), ramping as the sun nears/passes the horizon — drives the star
    // fade and the cool ambient tint. Based on sun height so dusk/dawn cross-fade smoothly.
    this.night = 1 - MathUtils.smoothstep(height, 0, 0.22);
    this.godraysSource.userData.night = this.night; // shared channel → the corona cross-fade reads this
    // Overcast factor: 0 (clear) → 1 (heavy cloud). Direct light dims and shadows soften toward flat,
    // diffuse light, with a little ambient lift so the scene stays bright (an overcast sky is a big soft light).
    const overcast = MathUtils.smoothstep(this.cloudCover, 0.3, 0.95);

    setColor(this.sun.color, sky.dir, true);
    // Sun brightness falls off with height as √(sin elevation), NOT linearly: a linear falloff drives the
    // directional to ~0 at the horizon, so a low rising/setting sun lit nothing — walls facing the sunrise
    // (golden hour) stayed dark. √ lifts the low-sun range while keeping the midday peak and a day arc.
    this.sun.intensity = above ? SUN_INTENSITY * Math.sqrt(height) * (1 - OVERCAST_DIM * overcast) : 0;
    this.sun.position.copy(this.sunDir).multiplyScalar(100); // direction only (it's a directional light)
    this.sun.shadow.intensity = 1 - overcast; // shadows fade out under cloud (no harsh shadow when overcast)
    // Ambient: COLOUR straight from timecyc's object-ambient (ambObj) — SA's warm, bright object fill (the
    // plain `amb` is near-black). So the day reads warm/sunlit (warm at golden hours, neutral at noon) instead
    // of our old flat white. Intensity scales it by day → near-zero at night (the night vertex colours light it).
    setColor(this.ambient.color, sky.ambObj, true);
    this.ambient.intensity = AMBIENT_NIGHT + (AMBIENT_DAY - AMBIENT_NIGHT) * (1 - this.night);
    // Skylight (hemisphere): warm sky + tan ground bounce by DAY (form + warmth on the shadow side, so it isn't
    // flat grey once night vertex fades), cross-fading to the cool moonlit fill at NIGHT. Day strength is
    // constant; the night term rides `night.skylight`.
    this.skylight.color.copy(DAY_SKY_COLOR).lerp(NIGHT_SKY_COLOR, this.night);
    this.skylight.groundColor.copy(DAY_GROUND_COLOR).lerp(NIGHT_GROUND_COLOR, this.night);
    this.skylight.intensity = DAY_SKYLIGHT * (1 - this.night) + nightCfg.skylight * this.night;

    // Cloud cover hides the sun: visible up to ~half cover, fully gone under heavy overcast.
    const cloudFade = 1 - MathUtils.smoothstep(this.cloudCover, 0.45, 0.85);
    this.material.uniforms.uCloudClear.value = cloudFade; // stars fade with overcast, matching the moon below
    const sunVisible = above && cloudFade > 0;
    this.sunSource.visible = sunVisible;
    this.corona.visible = sunVisible;
    this.godraysSource.visible = sunVisible;
    if (sunVisible) {
      this.sunSource.position.copy(this.sunDir).multiplyScalar(SUN_DISTANCE);
      this.corona.position.copy(this.sunSource.position);
      this.godraysSource.position.copy(this.sunSource.position);
      setColor((this.sunSource.material as MeshBasicMaterial).color, sky.sunCore, true);
      setColor((this.godraysSource.material as MeshBasicMaterial).color, sky.sunCore, true);
      setColor(this.corona.material.color, sky.sunCorona, true);
      (this.sunSource.material as MeshBasicMaterial).opacity = cloudFade;
      (this.godraysSource.material as MeshBasicMaterial).opacity = cloudFade;
      this.corona.material.opacity = sky.spriteBright * cloudFade;
      const core = sunScale * sky.sunSize;
      this.sunSource.scale.setScalar(core);
      this.corona.scale.setScalar(core * CORONA_RATIO * sky.spriteSize);
      this.godraysSource.scale.setScalar(godraysScale * sky.sunSize);
      // godraysSource isn't in the scene (GodRaysEffect renders it itself with matrixAutoUpdate
      // off), so nothing else refreshes its matrix — bake it here or the source stays at the origin.
      this.godraysSource.updateMatrix();
    }

    // Moon: a static sprite at a fixed sky direction, fading in as night falls (× cloud cover so heavy
    // overcast hides it). `brightness` scales the additive contribution.
    const moonFade = this.night * cloudFade;
    // Night sky glow (modern sky): the moon's cool scatter follows the sprite's direction & fade; the warm
    // urban skyglow gets BRIGHTER under cloud (the deck reflects the city light — real light pollution).
    const cosElGlow = Math.cos(MathUtils.degToRad(moon.elevationDeg));
    this.moonDir
      .set(MOON_AZIMUTH.x * cosElGlow, Math.sin(MathUtils.degToRad(moon.elevationDeg)), MOON_AZIMUTH.z * cosElGlow)
      .normalize();
    this.skyBaseUniforms.uMoonDirSky.value.copy(this.moonDir);
    this.skyBaseUniforms.uMoonGlow.value
      .setRGB(0.45, 0.62, 1.0)
      .multiplyScalar(0.055 * moon.brightness * moonFade * nightCfg.skyGlow);
    this.skyBaseUniforms.uCityGlow.value
      .setRGB(1.0, 0.58, 0.3)
      .multiplyScalar(0.03 * nightCfg.skyGlow * (1 + this.cloudCover * 1.2));
    this.moonDisc.visible = moonFade > 0.01;
    if (this.moonDisc.visible) {
      const cosEl = Math.cos(MathUtils.degToRad(moon.elevationDeg)); // height set by config (tuned in-browser)
      this.moonDisc.position
        .set(MOON_AZIMUTH.x * cosEl, Math.sin(MathUtils.degToRad(moon.elevationDeg)), MOON_AZIMUTH.z * cosEl)
        .multiplyScalar(MOON_DISTANCE);
      this.moonDisc.material.color.setScalar(moon.brightness);
      this.moonDisc.material.opacity = moonFade;
      this.moonDisc.scale.setScalar(moon.size);
    }

    // Preetham inputs (plan 067): timecyc stays the art director — cheap pure math, recomputed per frame;
    // inert while `sky.model` is 'classic' (uPbrMix 0 skips the branch in the shader).
    const pbr = pbrSkyParams({
      cloudCover: sky.cloudCover,
      cloudDark: sky.cloudDark,
      mood: skyCfg.mood,
      skyTop: sky.skyTop,
      sunElevation: height,
    });
    this.skyBaseUniforms.uSkyExposure.value = skyCfg.pbrExposure;
    this.skyBaseUniforms.uBetaR.value.set(pbr.betaR[0], pbr.betaR[1], pbr.betaR[2]);
    this.skyBaseUniforms.uBetaM.value.set(pbr.betaM[0], pbr.betaM[1], pbr.betaM[2]);
    this.skyBaseUniforms.uSunE.value = pbr.sunE;
    this.skyBaseUniforms.uPbrTint.value.setRGB(pbr.tint[0], pbr.tint[1], pbr.tint[2]);
    // Blend back to the SA gradient only once the sun is BELOW the horizon (twilight → night). The star/
    // tint night factor ramps during golden hour — using it here killed the Preetham sunset (the whole
    // point of the model), which is exactly what the first user A/B reported.
    const sinElevation = Math.sin(elevation);
    this.skyBaseUniforms.uPbrNight.value = 1 - MathUtils.smoothstep(sinElevation, -0.12, -0.02);
    this.skyBaseUniforms.uSunDirSky.value.copy(this.sunDir);
    // Sun light on the clouds (timecyc sunCorona): strongest at golden hour (low sun → orange/pink rims),
    // a quarter-strength white lift at noon, off below the horizon.
    const goldenStrength = above ? 0.25 + 0.65 * (1 - height) : 0;
    setColor(this.skyBaseUniforms.uCloudSunTint.value, sky.sunCorona, true);
    this.skyBaseUniforms.uCloudSunTint.value.multiplyScalar(goldenStrength);
  }

  /** Re-render the LUT every frame: 512×32 (≈16 k px) is trivial, and any quantized refresh key STEPS —
   *  a SA game minute is ~1 real second, so heavily-fogged distant objects visibly popped each step while
   *  the dome moved smoothly (user-reported flicker). Continuous = seamless. */
  private renderHorizonLut(context: PluginContext): void {
    const previous = context.renderer.getRenderTarget();
    context.renderer.setRenderTarget(this.lutTarget);
    context.renderer.render(this.lutScene, this.lutCamera);
    context.renderer.setRenderTarget(previous);
  }

  /** Sun elevation (radians) for the hour over [`sunrise`, `sunset`] (= litFade dawnStart/duskEnd);
   *  copies the computed direction into the reused {@link sunDir}. Math in {@link sunElevationAt}. */
  private sunElevation(hour: number, sunrise: number, sunset: number): number {
    const { dir, elevation } = sunElevationAt(hour, sunrise, sunset);
    this.sunDir.set(dir[0], dir[1], dir[2]);

    return elevation;
  }

  /** Aim the sun's shadow map at the view: centre the ortho frustum on the camera, light up-sun from it.
   *  The focus is **snapped to texel increments** so the shadows don't crawl/shimmer as the camera moves. */
  private updateShadow(camera: PerspectiveCamera, enabled: boolean): void {
    const lit = this.sun.intensity > 0 && this.sun.shadow.intensity > 0.01; // sun actually casting now
    // Keep `castShadow` stable across day↔night: toggling it recompiles every shadow-receiving material
    // (a dusk/dawn hitch — worse now the vehicle-headlight spotlights enlarge those shaders). Instead skip
    // the shadow *render* at night/overcast via `autoUpdate` (no recompile); the frozen map is invisible
    // anyway since the sun then lights nothing.
    this.sun.castShadow = enabled;
    this.sun.shadow.autoUpdate = enabled && lit;
    if (!enabled || !lit) {
      return;
    }
    // Snap the focus to the shadow-map texel grid **in the light's right/up basis** (world-axis snapping
    // doesn't match the rotated texel grid, so the shadows kept crawling). This stops the shimmer.
    shadowForward.copy(this.sunDir).negate(); // the shadow camera looks along −sunDir toward the scene
    shadowRight.crossVectors(shadowForward, Math.abs(shadowForward.y) > 0.99 ? WORLD_X : WORLD_UP).normalize();
    shadowUp.crossVectors(shadowRight, shadowForward).normalize();
    const texel = (2 * SHADOW_SIZE) / SHADOW_MAP; // world units per shadow-map texel
    shadowFocus.copy(camera.position);
    const r = Math.round(shadowFocus.dot(shadowRight) / texel) * texel;
    const u = Math.round(shadowFocus.dot(shadowUp) / texel) * texel;
    const f = shadowFocus.dot(shadowForward); // depth along the light — no need to snap
    shadowFocus
      .set(0, 0, 0)
      .addScaledVector(shadowRight, r)
      .addScaledVector(shadowUp, u)
      .addScaledVector(shadowForward, f);
    this.sun.target.position.copy(shadowFocus);
    this.sun.position.copy(shadowFocus).addScaledVector(this.sunDir, SHADOW_DISTANCE);
    this.sun.target.updateMatrixWorld();
  }
}

/** A soft radial glow texture (white centre → transparent) for the additive sun sprites. */
function radialTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  return new CanvasTexture(canvas);
}

/** Set a Color from an 0–255 RGB triple. `managed` converts sRGB→linear (lights/sprites); the
 *  unlit sky shader outputs raw, so it passes its colours through as-is. */
function setColor(color: Color, [r, g, b]: Rgb, managed: boolean): void {
  color.setRGB(r / 255, g / 255, b / 255, managed ? SRGBColorSpace : undefined);
}

function sunSprite(map: Texture): Sprite {
  return new Sprite(
    new SpriteMaterial({ blending: AdditiveBlending, depthWrite: false, fog: false, map, transparent: true }),
  );
}
