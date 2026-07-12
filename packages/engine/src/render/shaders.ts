/**
 * WGSL module store (plan 074/01): named modules resolved through `#include <name>` at boot — variants are
 * ENUMERATED (each resolved source is snapshot-testable), never string-patched at runtime. The M0 set: the
 * world shader (opaque/cutout share one source; the cutout difference is pipeline state — alpha-to-coverage).
 *
 * naga/Metal guardrails (073 scars, enforced by `assertGuardrails`): no dynamically-indexed uniform-space
 * arrays, no unbounded loops.
 */

const MODULES: Record<string, string> = {
  frame: /* wgsl */ `
struct Frame {
  viewProj: mat4x4f,
  invViewProj: mat4x4f,
  camera: vec4f,
  // Environment (plan 074/06): sun direction (unit, towards the sun), sun colour,
  // params  = [dn (0 day → 1 night), indirectScale, directScale, emissiveBoost],
  // skyTop / skyHorizon = LINEAR sky gradient colours (row 4 v1 — the PBR LUT replaces them later),
  // fog     = [cutDistance, startDistance, heightK, heightMin] (row 5 — the 068 shape),
  // params2 = [aoStrength (074/07 baked skyVis → indirect), sunVisStrength (074/07 baked sun shadows),
  //            time seconds (the wind clock), windStrength (074/06 row 10)],
  // moonDir/moonColor = the night light (074/06 row 6; colour is BLACK by day — the CPU arc gates it).
  sunDir: vec4f,
  sunColor: vec4f,
  params: vec4f,
  skyTop: vec4f,
  skyHorizon: vec4f,
  fog: vec4f,
  params2: vec4f,
  moonDir: vec4f,
  moonColor: vec4f,
};
@group(0) @binding(0) var<uniform> frame: Frame;

// Shared sky colour by view direction (the sky pass AND the world fog sample the same gradient — fully
// fogged geometry dissolves into exactly the sky behind it, the 068 invariant).
fn skyColorFor(dir: vec3f) -> vec3f {
  let elevation = clamp(dir.y, 0.0, 1.0);
  let base = mix(frame.skyHorizon.rgb, frame.skyTop.rgb, pow(elevation, 0.55));
  // Sun glow: a soft forward-scatter blob around the sun direction (day only — sunColor premultiplied
  // by the day arc on the CPU side).
  let sunDot = max(dot(dir, frame.sunDir.xyz), 0.0);
  let glow = frame.sunColor.rgb * (pow(sunDot, 256.0) * 0.9 + pow(sunDot, 8.0) * 0.06);
  // Moon disc + faint halo (074/06 row 6): moonColor is BLACK by day, so this whole term dies with it;
  // the disc lives in the shared sky so fogged geometry dissolves into the moon behind it (068 invariant).
  let moonDot = max(dot(dir, frame.moonDir.xyz), 0.0);
  // Wide soft halo (pow 96) marks the spot in the horizon band; the disc itself stays small and bright.
  let moon = frame.moonColor.rgb * (smoothstep(0.9985, 0.9993, moonDot) * 14.0 + pow(moonDot, 96.0) * 2.2);
  return base + glow + moon;
}
`,
  sky: /* wgsl */ `
#include <frame>

// Fullscreen sky (074/06 row 4 v1): a big triangle at far depth; depth-test LESS-EQUAL against 1.0 keeps it
// behind everything drawn. The gradient + sun glow live in <frame> (shared with the world fog).
struct SkyOut {
  @builtin(position) clip: vec4f,
  @location(0) ndc: vec2f,
};

@vertex
fn vsSky(@builtin(vertex_index) index: u32) -> SkyOut {
  var out: SkyOut;
  let x = f32(i32(index & 1u) * 4 - 1);
  let y = f32(i32(index >> 1u) * 4 - 1);
  out.clip = vec4f(x, y, 1.0, 1.0);
  out.ndc = vec2f(x, y);
  return out;
}

@fragment
fn fsSky(in: SkyOut) -> @location(0) vec4f {
  let far = frame.invViewProj * vec4f(in.ndc, 1.0, 1.0);
  let dir = normalize(far.xyz / far.w - frame.camera.xyz);
  return vec4f(skyColorFor(dir), 1.0);
}
`,
  world: /* wgsl */ `
#include <frame>

// origin.w = per-cell channel flag bits: bit 0 = baked sunVis (normal.w meaningful), bit 1 = baked
// emissive mask (high channels byte meaningful). Zero = neither (old paks render unchanged).
struct Cell {
  origin: vec4f,
};
@group(1) @binding(0) var<uniform> cell: Cell;

@group(2) @binding(0) var worldTexture: texture_2d_array<f32>;
@group(2) @binding(1) var worldSampler: sampler;

struct VsIn {
  @location(0) position: vec3f,
  @location(1) uv: vec2f,
  @location(2) dayPrelit: vec4f,
  @location(3) layerChannels: vec2u,
  @location(4) normal: vec4f,
  @location(5) nightPrelit: vec4f,
};

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) prelit: vec3f,
  @location(2) @interpolate(flat) layer: u32,
  @location(3) sunNdl: f32,
  @location(4) world: vec3f,
  @location(5) glow: vec3f,
  @location(6) ao: f32,
  @location(7) cone: f32,
  @location(8) moonNdl: f32,
};

@vertex
fn vsWorld(in: VsIn) -> VsOut {
  var out: VsOut;
  var world = in.position + cell.origin.xyz;
  // Wind sway (074/06 row 10, the plan-039 model baked offline): nightPrelit.a = amplitude in METRES
  // (0 for everything rigid — the displacement is a data-driven no-op there). Phase rides world-space
  // position with LOW frequency so one canopy moves nearly as a unit but a row of palms doesn't lockstep.
  let sway = in.nightPrelit.a * frame.params2.w;
  let swayT = frame.params2.z * 1.2 + world.x * 0.05 + world.z * 0.04;
  world.x += sin(swayT) * sway;
  world.z += cos(swayT * 0.7) * sway * 0.6;
  out.clip = frame.viewProj * vec4f(world, 1.0);
  out.world = world;
  out.uv = in.uv;
  // Day↔night prelit blend (074/06 row 1): cells without an authored night set carry a converter-synthesized
  // night (day × ambient) — one formula for the whole world, per vertex.
  out.prelit = mix(in.dayPrelit.rgb, in.nightPrelit.rgb, frame.params.x);
  // Night emissives (074/06 rows 8-9, the 071 model): a vertex much brighter at night than by day IS a lit
  // window / neon / sign — it GLOWS instead of being merely tinted. The BAKED mask (07, high channels byte)
  // replaces the runtime luma-delta heuristic when the cell carries it; dn fades either in.
  let cellFlags = u32(cell.origin.w + 0.5);
  let luma = vec3f(0.2126, 0.7152, 0.0722);
  let delta = dot(in.nightPrelit.rgb, luma) - dot(in.dayPrelit.rgb, luma);
  let heuristic = smoothstep(0.05, 0.32, delta);
  let baked = f32(in.layerChannels.y >> 8u) / 255.0;
  let emissive = mix(heuristic, baked, f32((cellFlags >> 1u) & 1u));
  out.glow = in.nightPrelit.rgb * (emissive * frame.params.w * frame.params.x);
  out.layer = in.layerChannels.x;
  // Sun N·L per vertex (074/06 row 3) — GTA geometry is low-poly; per-vertex matches the shipped look.
  // Baked sun visibility (074/07, 066/03 v1 scalar): normal.w = arc-averaged sun occlusion — the STATIC
  // shadow term (under bridges / canyons the direct sun dies), smooth by construction, no shadow map.
  let sunVis = mix(1.0, clamp(in.normal.w, 0.0, 1.0), f32(cellFlags & 1u) * frame.params2.y);
  let worldNormal = normalize(in.normal.xyz);
  out.sunNdl = max(dot(worldNormal, frame.sunDir.xyz), 0.0) * sunVis;
  // Moon N·L, WRAPPED (074/06 row 6, the 073 model): moonlight is a huge soft source — a hard terminator
  // reads as a second harsh sun. The baked sunVis gates it too: static occlusion blocks moonlight as well.
  out.moonNdl = clamp((dot(worldNormal, frame.moonDir.xyz) + 0.6) / 1.6, 0.0, 1.0) * sunVis;
  // Baked AO/skyVis (074/07): low byte of channels; 0 means UNBAKED (old paks) → fully open, not black.
  let aoByte = in.layerChannels.y & 0xffu;
  let aoVis = select(f32(aoByte) / 255.0, 1.0, aoByte == 0u);
  out.ao = mix(1.0, aoVis, frame.params2.x);
  // Beam cone alpha (074/06 row 11): dayPrelit.a — 1 everywhere except floodlight-cone geometry.
  out.cone = in.dayPrelit.a;
  return out;
}

@fragment
fn fsWorld(in: VsOut) -> @location(0) vec4f {
  // Textures ship PREMULTIPLIED (074/02): filtering is correct by construction, transparent texels
  // contribute nothing — the alpha-edge fix. Alpha feeds coverage on the cutout pipeline (A2C).
  let texel = textureSample(worldTexture, worldSampler, in.uv, in.layer);
  // Hybrid lighting (074/06 row 3, the shipped 064 model): prelit is the INDIRECT term, the sun adds a real
  // direct term on the raw albedo. indirect/direct ride frame params — day arcs are a CPU concern.
  // Baked AO modulates ONLY the indirect term (074/07) — sun shadowing is the separate sunVis bake.
  let lit = in.prelit * (frame.params.y * in.ao) +
    frame.sunColor.rgb * (in.sunNdl * frame.params.z) +
    frame.moonColor.rgb * in.moonNdl;
  var color = texel.rgb * (lit + in.glow);
  // Unified fog (074/06 row 5, the 068 shape): RADIAL distance (view-Z pops at screen edges), exp² over
  // [start, cut], height attenuation (haze hugs the ground), hard horizon cut — and the fog colour is the
  // SKY at this direction, so distant geometry dissolves into exactly what's behind it.
  let toCamera = in.world - frame.camera.xyz;
  let dist = length(toCamera);
  let viewDir = toCamera / max(dist, 0.001);
  let fogD = max(dist - frame.fog.y, 0.0);
  let fogK = 2.0 / max(frame.fog.x - frame.fog.y, 1.0);
  var fogFactor = 1.0 - exp(-(fogK * fogD) * (fogK * fogD));
  let heightAtten = mix(frame.fog.w, 1.0, exp(-max(in.world.y, 0.0) * frame.fog.z));
  fogFactor = fogFactor * heightAtten;
  fogFactor = max(fogFactor, smoothstep(frame.fog.x * 0.85, frame.fog.x, dist));
  // Sky term scaled by texel.a: colour is PREMULTIPLIED, so the blend pipelines (074/06 rows 9/11) stay
  // premult-correct in fog; opaque/cutout (a ≈ 1) are unchanged.
  color = mix(color, skyColorFor(viewDir) * texel.a, fogFactor);
  return vec4f(color, texel.a);
}

@fragment
fn fsBeam(in: VsOut) -> @location(0) vec4f {
  // Floodlight cones (074/06 row 11, plan 032): 'white'-textured geometry whose soft cone lives in the
  // per-vertex prelit ALPHA. Output is PREMULTIPLIED for the (one, one-minus-src-alpha) blend pipeline.
  // No sun/glow terms — a beam is self-lit, tinted only by the dn-mixed prelit colour.
  let texel = textureSample(worldTexture, worldSampler, in.uv, in.layer);
  let alpha = texel.a * in.cone;
  let color = texel.rgb * in.prelit * in.cone;
  // Fog FADES a beam out (scales the premultiplied pair) — mixing toward the sky would tint thin air.
  let dist = length(in.world - frame.camera.xyz);
  let fogD = max(dist - frame.fog.y, 0.0);
  let fogK = 2.0 / max(frame.fog.x - frame.fog.y, 1.0);
  let fade = exp(-(fogK * fogD) * (fogK * fogD)) * (1.0 - smoothstep(frame.fog.x * 0.85, frame.fog.x, dist));
  return vec4f(color * fade, alpha * fade);
}
`,
};

/** The naga/Metal guardrails as an assertion (unit-tested; runs on every resolve in dev). */
export function assertGuardrails(name: string, wgsl: string): void {
  // Dynamically-indexed uniform-space ARRAYS in fragment code collapsed occupancy on Metal (073: ~250 ms).
  // Uniform structs are fine; `var<uniform>` holding an array type is the banned shape.
  if (/var<uniform>[^;]*:\s*array</.test(wgsl)) {
    throw new Error(`<${name}>: uniform-space array detected — use a texture or storage buffer (073 guardrail)`);
  }
  if (/\bloop\s*\{/.test(wgsl) && !/break/.test(wgsl)) {
    throw new Error(`<${name}>: unbounded loop detected (073 guardrail)`);
  }
}

/** Resolve one module's full WGSL (includes expanded once, cycles rejected). */
export function resolveShader(name: string): string {
  const seen = new Set<string>();
  const expand = (moduleName: string): string => {
    if (seen.has(moduleName)) {
      throw new Error(`shader include cycle at <${moduleName}>`);
    }
    seen.add(moduleName);
    const source = MODULES[moduleName];
    if (!source) {
      throw new Error(`unknown shader module <${moduleName}>`);
    }

    return source.replace(/^#include <(\w+)>$/gm, (_, included: string) => expand(included));
  };
  const resolved = expand(name);
  assertGuardrails(name, resolved);

  return resolved;
}

/** Every module name (golden-snapshot tests iterate this). */
export function shaderModuleNames(): string[] {
  return Object.keys(MODULES).sort();
}
