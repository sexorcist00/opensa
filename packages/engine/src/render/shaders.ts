/**
 * WGSL module store (plan 074/01): named modules resolved through `#include <name>` at boot — variants are
 * ENUMERATED (each resolved source is snapshot-testable), never string-patched at runtime. The M0 set: the
 * world shader (opaque/cutout share one source; the cutout difference is pipeline state — alpha-to-coverage).
 *
 * naga/Metal guardrails (073 scars, enforced by `assertGuardrails`): no dynamically-indexed uniform-space
 * arrays, no unbounded loops.
 */

const MODULES: Record<string, string> = {
  corona: /* wgsl */ `
#include <frame>

// 2dfx coronas (074/06 row 13 v1): instanced camera-facing quads, PROCEDURAL radial glow (the particle.txd
// sprites arrive with the texture path later), additive premultiplied blending, depth READ (occluders hide
// coronas). Night-gated on the CPU side (dn scales the instance colour before upload).
struct CoronaIn {
  @location(0) corner: vec2f,
  @location(1) center: vec3f,
  @location(2) size: f32,
  @location(3) color: vec4f,
};

struct CoronaOut {
  @builtin(position) clip: vec4f,
  @location(0) offset: vec2f,
  @location(1) color: vec4f,
};

@vertex
fn vsCorona(in: CoronaIn) -> CoronaOut {
  var out: CoronaOut;
  // Camera basis from the inverse view-projection is overkill — build right/up from the view matrix baked
  // into viewProj via the camera position: cheap billboard using the eye-to-center frame.
  let toEye = normalize(frame.camera.xyz - in.center);
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), toEye));
  let up = cross(toEye, right);
  let world = in.center + (right * in.corner.x + up * in.corner.y) * in.size;
  out.clip = frame.viewProj * vec4f(world, 1.0);
  out.offset = in.corner;
  out.color = in.color;
  return out;
}

@fragment
fn fsCorona(in: CoronaOut) -> @location(0) vec4f {
  // The real SA coronastar sprite (particle.txd) — it has the cross flare a procedural blob cannot fake.
  // The host normalises the alpha (SA ships these shape-in-RGB with alpha pinned at 255), so trust it here.
  let uv = in.offset * 0.5 + vec2f(0.5); // the quad spans [-1, 1] — see the particle shader's note
  let texel = textureSample(coronaSprites, skyLutSampler, uv, 0u);
  return vec4f(in.color.rgb * texel.rgb * (texel.a * in.color.a), 0.0);
}
`,
  /**
   * Prop debris (074/08 B7·a step 4) — one draw per break, and NOTHING per frame on the CPU.
   *
   * Every vertex carries its shard's whole flight: centroid, velocity, spin axis x speed, and the age at
   * which the centroid reaches the ground. The shard flies a ballistic arc about its centroid, spins, then
   * FREEZES the moment it lands (translation and spin both) — which is why the arithmetic clamps age at
   * landTime rather than stopping the draw. The three path shipped without a ground probe and its shards sank
   * through the floor; here the host probes the ground, so they come to rest on it.
   */
  debris: /* wgsl */ `
#include <frame>

struct DebrisUniform {
  spawn: vec4f,   // x = spawn time (frame clock), y = lifetime, z = fade seconds, w = gravity
};
@group(1) @binding(0) var<uniform> debris: DebrisUniform;
@group(1) @binding(1) var shards: texture_2d_array<f32>;
@group(1) @binding(2) var shardSampler: sampler;

struct DebrisIn {
  @location(0) position: vec3f,
  @location(1) uv: vec2f,
  @location(2) color: vec4f,
  @location(3) center: vec3f,
  @location(4) velocity: vec3f,
  @location(5) angular: vec3f,
  @location(6) landLayer: vec2f,   // x = land time (s), y = texture layer
};

struct DebrisOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
  @location(2) @interpolate(flat) layer: u32,
  @location(3) fade: f32,
};

/** Rodrigues: rotate v about a unit axis by the given angle. */
fn rotateAxis(v: vec3f, axis: vec3f, angle: f32) -> vec3f {
  let c = cos(angle);
  let s = sin(angle);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

@vertex
fn vsDebris(in: DebrisIn) -> DebrisOut {
  var out: DebrisOut;
  let age = max(frame.params2.z - debris.spawn.x, 0.0);
  // Frozen once it lands: both the arc and the spin stop at the same instant, or a resting shard would
  // keep twitching on the ground.
  let t = min(age, in.landLayer.x);
  let speed = length(in.angular);
  let axis = select(vec3f(0.0, 1.0, 0.0), in.angular / max(speed, 1e-5), speed > 1e-5);
  let spun = rotateAxis(in.position - in.center, axis, speed * t);
  let center = in.center + in.velocity * t + vec3f(0.0, -0.5 * debris.spawn.w, 0.0) * t * t;
  out.clip = frame.viewProj * vec4f(center + spun, 1.0);
  out.uv = in.uv;
  out.color = in.color;
  out.layer = u32(in.landLayer.y);
  out.fade = 1.0 - smoothstep(debris.spawn.y - debris.spawn.z, debris.spawn.y, age);
  return out;
}

@fragment
fn fsDebris(in: DebrisOut) -> @location(0) vec4f {
  let texel = textureSample(shards, shardSampler, in.uv, in.layer);
  let color = texel.rgb * in.color.rgb;
  let alpha = texel.a * in.color.a * in.fade;
  return vec4f(color * alpha, alpha);   // premultiplied, like every other blended pass here
}
`,
  frame: /* wgsl */ `
struct Frame {
  viewProj: mat4x4f,
  invViewProj: mat4x4f,
  // camera.w = cloud dome slot A→B crossfade blend (row 15 weather fade; spare vec4 slot).
  camera: vec4f,
  // Environment (plan 074/06): sun direction (unit, towards the sun; .w = CURRENT ARC ELEVATION 0..1,
  // the sun-vis v2 threshold input — 074/07), sun colour,
  // params  = [dn (0 day → 1 night), indirectScale, directScale, emissiveBoost],
  // skyTop / skyHorizon = LINEAR sky gradient colours (row 4 v1 — the PBR LUT replaces them later),
  // fog     = [cutDistance, startDistance, heightK, heightMin] (row 5 — the 068 shape),
  // params2 = [aoStrength (074/07 baked skyVis → indirect), sunVisStrength (074/07 baked sun shadows),
  //            time seconds (the wind clock), windStrength (074/06 row 10)],
  // moonDir/moonColor = the night light (074/06 row 6; colour is BLACK by day — the CPU arc gates it);
  // moonDir.w = stochastic de-tiling toggle (074/12); moonColor.w = cloud rotation speed rad/s (row 15) —
  // both spare vec4 slots.
  sunDir: vec4f,
  sunColor: vec4f,
  params: vec4f,
  skyTop: vec4f,
  skyHorizon: vec4f,
  fog: vec4f,
  params2: vec4f,
  moonDir: vec4f,
  moonColor: vec4f,
  // params3 = [localLightCount (row 7), cloudLayerOn (row 15), cloudDark, cloudLayerAlpha].
  params3: vec4f,
  // The SUN VISUAL (timecyc columns): sunCore = disc colour (.w = angular core radius, rad, from
  // timecyc sunSize); sunCorona = halo/godray colour (.w = weather cloud COVER 0..1 — prod's uCloudClear
  // source: stars fade GLOBALLY under overcast, not just where the panorama paints a puff — the panoramas
  // leave alpha gaps between clouds and stars leaked through them). env.sunColor above stays the LIGHT.
  sunCore: vec4f,
  sunCorona: vec4f,
  // Water v1 (074/06 row 12): timecyc WaterRGBA — deep tint (linear rgb) + base opacity in .w.
  waterColor: vec4f,
  // params4 = [dynamicLightCount, moonPhase (B6), reflectionStrength (B5r), spare]. The pool is ordered
  // DYNAMIC first, then static 2dfx: the world shades the static half per vertex and the dynamic half per
  // pixel; vehicles and peds take the STATIC half only, so a car is never lit by its own lamps.
  params4: vec4f,
};
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var skyLut: texture_2d<f32>;
@group(0) @binding(2) var skyLutSampler: sampler;
// Cloud dome layer (074/06 row 15): per-weather panorama; sampled ONLY by fsSky (a known v1 deviation
// from the 068 fog invariant — fogged geometry dissolves into the CLOUDLESS dome; clouds sit high, the
// horizon band barely carries them).
@group(0) @binding(4) var cloudDomeA: texture_2d<f32>;
@group(0) @binding(5) var cloudDomeB: texture_2d<f32>;
// SA corona billboards from particle.txd: layer 0 = coronastar (lamps, headlights), layer 1 = coronamoon.
@group(0) @binding(6) var coronaSprites: texture_2d_array<f32>;

// Shared sky colour by view direction (the sky pass AND the world fog sample the same PBR dome — fully
// fogged geometry dissolves into exactly the sky behind it, the 068 invariant). The dome is a CPU-built
// Preetham LUT (074/06 row 4): u = azimuthal angle from the sun (the dome is sun-symmetric), v = elevation.
// The moon's angular radius as a multiple of the sun's (they are famously close in the real sky; SA draws a
// bigger, friendlier moon). MOON_BODY_GAIN keeps the lit disc HDR so it feeds the bloom/godray pass.
const MOON_DISC_SCALE = 3.2;
const MOON_BODY_GAIN = 10.0;

fn skyBaseFor(dir: vec3f) -> vec3f {
  let dirXz = normalize(vec2f(dir.x, dir.z) + vec2f(1e-5, 0.0));
  let sunXz = normalize(vec2f(frame.sunDir.x, frame.sunDir.z) + vec2f(1e-5, 0.0));
  let azimuth = acos(clamp(dot(dirXz, sunXz), -1.0, 1.0)) / 3.14159265;
  let v = clamp((dir.y + 0.05) / 1.05, 0.0, 1.0);
  return textureSampleLevel(skyLut, skyLutSampler, vec2f(azimuth, v), 0.0).rgb;
}

// Sun + moon discs, split from the gradient so the cloud layer can OCCLUDE them (row 15): the disc
// overshoot survives a partial alpha mix, so clouds must attenuate this term, not blend over it.
fn skyCelestialFor(dir: vec3f) -> vec3f {
  // The prod-look sun (field round 3): a FILLED disc in the timecyc sunCore colour (yellow/orange —
  // prod colours its sun mesh with exactly this column) + an exponential warm corona in sunCorona.
  // Angular sizing comes from timecyc sunSize via sunCore.w. The 3–6× overshoot feeds the godrays
  // post pass (bright-pass threshold) and clips to a hot centre in the swapchain.
  let sunDot = clamp(dot(dir, frame.sunDir.xyz), -1.0, 1.0);
  let ang = acos(sunDot);
  let coreR = max(frame.sunCore.w, 1e-4);
  let disc = (1.0 - smoothstep(coreR * 0.75, coreR, ang)) * 6.0;
  let corona = exp(-ang / (coreR * 2.2)) * 2.6;
  let glow = exp(-ang / (coreR * 8.0)) * 0.5;
  let sun = frame.sunCore.rgb * disc + frame.sunCorona.rgb * (corona + glow);
  let moon = moonFor(dir);
  // The sea-horizon line CLIPS the discs (field: the sun used to just fade out at ground level): drivers
  // now let the arcs sink below y=0, and pixels under the horizon drop the disc — the sun/moon visibly
  // set INTO the ocean, upper sliver last. Soft edge = a few arcminutes of waterline shimmer.
  let horizonClip = smoothstep(-0.003, 0.005, dir.y);
  return (sun + moon) * horizonClip;
}

// The cloud dome in a direction (074/06 row 15), factored out of fsSky so a CAR can reflect the clouds too:
// rgb = the lit cloud colour, a = its coverage. Azimuthal-equidistant mapping measured off the mod's sphere
// (uv = 0.5 -/+ dir_horiz*k*theta, k ~ 0.297/rad), slow rotation on the wind clock, brightness following the
// timecyc horizon mood with a night floor. Zero when no dome is bound or below the horizon.
fn cloudLayerFor(dir: vec3f) -> vec4f {
  if (frame.params3.y <= 0.5 || dir.y <= 0.0) {
    return vec4f(0.0);
  }
  let theta = acos(clamp(dir.y, -1.0, 1.0));
  let horiz = normalize(vec2f(dir.x, -dir.z) + vec2f(1e-5, 0.0));
  let spin = frame.params2.z * frame.moonColor.w;
  let rot = mat2x2f(vec2f(cos(spin), sin(spin)), vec2f(-sin(spin), cos(spin)));
  let spun = rot * horiz;
  let radius = theta * 0.297;
  let uv = vec2f(0.5 - spun.x * radius, 0.5 + spun.y * radius);
  let cloud = mix(
    textureSampleLevel(cloudDomeA, skyLutSampler, uv, 0.0),
    textureSampleLevel(cloudDomeB, skyLutSampler, uv, 0.0),
    frame.camera.w,
  );
  let mood = frame.skyHorizon.rgb;
  let brightness = max((mood.r + mood.g + mood.b) / 3.0 * 1.4, 0.10) * (1.0 - frame.params3.z * 0.6);
  let alpha = cloud.a * smoothstep(0.0, 0.12, dir.y);
  return vec4f(cloud.rgb * brightness, alpha);
}

/**
 * The MOON (074/06 row 6, B6): the real SA coronamoon sprite plus a PHASE.
 *
 * Vanilla SA fakes its phases by cropping the sprite, which gives a sliced disc rather than a crescent. We
 * light a sphere instead: the moon's surface normal is reconstructed from the disc coordinates, and the lit
 * fraction follows a phase angle (params4.y, advanced by the host with the in-game days). That yields a real
 * terminator — waxing crescent through full and back — for the cost of a dot product.
 *
 * moonColor is BLACK by day, so this whole term dies with it.
 */
fn moonFor(dir: vec3f) -> vec3f {
  let moonDot = dot(dir, frame.moonDir.xyz);
  // Local disc frame: where in the moon's face this view direction lands, in [-1, 1].
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), frame.moonDir.xyz));
  let up = cross(frame.moonDir.xyz, right);
  let radius = max(frame.sunCore.w * MOON_DISC_SCALE, 1e-4);
  let disc = vec2f(dot(dir, right), dot(dir, up)) / radius;
  let r = length(disc);

  // The sprite across the disc: rgb carries the CRATERS, alpha the round shape (normalised by the host).
  let uv = disc * 0.5 + vec2f(0.5);
  let texel = textureSample(coronaSprites, skyLutSampler, uv, 1u);
  let face = texel.a;

  // Phase: rebuild the surface normal of the sphere at this point and light it from the phase direction.
  let z = sqrt(max(0.0, 1.0 - min(r * r, 1.0)));
  let normal = normalize(right * disc.x + up * disc.y + frame.moonDir.xyz * z);
  let angle = frame.params4.y * 6.2831853;
  let sunward = normalize(right * sin(angle) + frame.moonDir.xyz * (-cos(angle)));
  // A soft terminator: earthshine keeps the dark limb faintly visible, as it is in life.
  let lit = smoothstep(-0.08, 0.12, dot(normal, sunward)) * 0.92 + 0.08;

  let body = texel.rgb * (face * lit * step(r, 1.0) * MOON_BODY_GAIN);
  // A wide soft halo marks the moon's place in the horizon band even when the disc is a thin crescent.
  let halo = pow(max(moonDot, 0.0), 96.0) * 2.2;
  return frame.moonColor.rgb * (body + vec3f(halo));
}

// The sky the WORLD FOG dissolves into (068 invariant): the gradient + only the WIDE sun haze. The hot
// disc/corona must NOT be here — fogged silhouettes picked it up and the sun "shone through buildings"
// (field round 3). Prod's disc is a separate mesh for the same reason.
fn skyFogFor(dir: vec3f) -> vec3f {
  let sunDot = max(dot(dir, frame.sunDir.xyz), 0.0);

  return skyBaseFor(dir) + frame.sunCorona.rgb * pow(sunDot, 8.0) * 0.06;
}

// Local light pool (074/06 row 7): up to 64 point lights (2dfx street lamps + host dynamics — vehicle
// headlights), CPU-filled each frame. The world consumes it in the VERTEX shader (SA is vertex-lit and
// world verts ≪ pixels); small dynamic entities sample it per pixel. Bounded loop (count ≤ 64 — guardrail).
struct LocalLight {
  position: vec4f, // xyz world + radius
  color: vec4f,    // linear RGB × intensity; w spare
  // xyz = the direction a SPOT points, w = the cosine of its half-angle. w >= 1.5 means POINT (no cone) —
  // the same sentinel the three pool uses. Headlights NEED this: as a point light a headlight floods the
  // whole street, the road behind the car included.
  dir: vec4f,
};
@group(0) @binding(3) var<storage, read> localLights: array<LocalLight>;

// A RANGE of the pool, so the world can split it: static lamps per vertex (they never move, and world verts
// ≪ pixels), moving lights per pixel. A headlight shaded per vertex is a disaster — SA's road polygons are
// tens of metres wide, so the beam lands between vertices: it blotches along the mesh normals and disappears
// outright when the car sits mid-polygon.
// NB: "from" is a WGSL RESERVED KEYWORD (so is "meta", which bit the B2 vertex layout) — hence first/last.
// The naga guardrails do not catch reserved words; assertGuardrails now does, so the browser stops being
// the first thing to notice.
fn localLightRange(world: vec3f, normal: vec3f, first: u32, last: u32) -> vec3f {
  var sum = vec3f(0.0);
  let count = min(last, 64u);
  for (var index = first; index < count; index += 1u) {
    let light = localLights[index];
    var toLight = light.position.xyz - world;
    let dist = length(toLight);
    let radius = light.position.w;
    if (dist < radius) {
      toLight = toLight / max(dist, 0.001);
      let spot = light.dir.w < 1.5;
      // Cone falloff SQUARED toward the rim — a flat plateau reads as a hard-edged searchlight blob.
      var cone = 1.0;
      if (spot) {
        cone = smoothstep(light.dir.w, min(light.dir.w + 0.30, 1.0), dot(-toLight, light.dir.xyz));
        cone = cone * cone;
      }
      // WRAP: a headlight grazes the road almost tangentially, so a hard N·L collapses the beam to nothing.
      // Wrapping keeps the road pool readable while walls still take more light when they face the lamp.
      let wrap = select(0.4, 0.25, spot);
      let ndl = clamp((dot(normal, toLight) + wrap) / (1.0 + wrap), 0.0, 1.0);
      let falloff = 1.0 - dist / radius;
      sum += light.color.rgb * (ndl * cone * falloff * falloff);
    }
  }
  return sum;
}

/** Dynamic half only — the world's PER-PIXEL term. */
fn localLightDynamic(world: vec3f, normal: vec3f) -> vec3f {
  return localLightRange(world, normal, 0u, u32(frame.params4.x));
}

/** Static 2dfx half only — the world's PER-VERTEX term. */
fn localLightStatic(world: vec3f, normal: vec3f) -> vec3f {
  return localLightRange(world, normal, u32(frame.params4.x), u32(frame.params3.x));
}
`,
  particle: /* wgsl */ `
#include <frame>

// 2dfx PARTICLES (074/06 row 13, B6). The FX system's keyframed tracks are BAKED by the host into a small
// per-system record; the whole lifecycle then loops in the VERTEX shader, so a hundred smoke plumes cost
// zero CPU per frame. One draw per blend mode for the entire map (the system index rides per instance).
//
// A particle's life: it is born at its emitter, is thrown by its velocity, is pulled by the system's force
// (gravity for sparks, buoyancy for smoke), and grows/fades along piecewise-linear envelopes sampled at
// age 0 / 0.5 / 1 — exactly the shape the prod path bakes out of effects.fxp.
struct ParticleSystem {
  // xyz = force (gravity/buoyancy), w = texture layer.
  force: vec4f,
  // Size envelope at age 0 / 0.5 / 1, w = draw distance.
  size: vec4f,
  color0: vec4f, // rgb at age 0, a = alpha at age 0
  color1: vec4f, // rgb at age 0.5, a = alpha at 0.5
  color2: vec4f, // rgb at age 1, a = alpha at 1
};
@group(1) @binding(0) var<storage, read> systems: array<ParticleSystem>;
@group(1) @binding(1) var fxTexture: texture_2d_array<f32>;
@group(1) @binding(2) var fxSampler: sampler;

struct ParticleIn {
  @location(0) corner: vec2f,
  @location(1) spawn: vec3f,
  @location(2) velocity: vec3f,
  // x = lifetime seconds, y = phase offset (so a plume is a continuous stream, not a pulse), z = system.
  @location(3) params: vec3f,
};

struct ParticleOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
  @location(2) @interpolate(flat) layer: u32,
};

/** Piecewise-linear envelope through three keys at age 0 / 0.5 / 1. */
fn envelope3(k0: f32, k1: f32, k2: f32, age: f32) -> f32 {
  return select(mix(k1, k2, (age - 0.5) * 2.0), mix(k0, k1, age * 2.0), age < 0.5);
}

fn envelope3v(k0: vec3f, k1: vec3f, k2: vec3f, age: f32) -> vec3f {
  return select(mix(k1, k2, (age - 0.5) * 2.0), mix(k0, k1, age * 2.0), age < 0.5);
}

@vertex
fn vsParticle(in: ParticleIn) -> ParticleOut {
  let system = systems[u32(in.params.z)];
  let life = max(in.params.x, 0.01);
  // The phase staggers the stream: every particle of a plume is at a different point of the SAME loop.
  let age = fract((frame.params2.z + in.params.y) / life);
  let t = age * life;
  let world = in.spawn + in.velocity * t + system.force.xyz * (0.5 * t * t);
  let size = envelope3(system.size.x, system.size.y, system.size.z, age);
  let rgb = envelope3v(system.color0.rgb, system.color1.rgb, system.color2.rgb, age);
  let alpha = envelope3(system.color0.a, system.color1.a, system.color2.a, age);

  // Camera-facing quad, like the coronas. The quad spans [-1, 1], and the authored size is a DIAMETER (prod
  // projects it as a point-sprite width) — so the half-extent is size*0.5. Scaling by the full size makes
  // every particle twice as wide as authored, and a fire turns into a soft glowing cloud.
  let toEye = normalize(frame.camera.xyz - world);
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), toEye));
  let up = cross(toEye, right);
  let corner = world + (right * in.corner.x + up * in.corner.y) * (size * 0.5);

  var out: ParticleOut;
  out.clip = frame.viewProj * vec4f(corner, 1.0);
  // The unit quad spans [-1, 1], so the UV is corner*0.5 + 0.5. Using corner + 0.5 sends it to [-0.5, 1.5],
  // and the clamp-to-edge sampler then smears the sprite's border texels into a SQUARE of solid colour.
  out.uv = in.corner * 0.5 + vec2f(0.5);
  // Distance cull: collapse the quad rather than branch (a degenerate triangle costs nothing).
  let dist = length(world - frame.camera.xyz);
  let visible = f32(dist < system.size.w && size > 0.0);
  out.clip = select(vec4f(0.0, 0.0, -1.0, 1.0), out.clip, visible > 0.5);
  out.color = vec4f(rgb, alpha * visible);
  out.layer = u32(system.force.w);
  return out;
}

@fragment
fn fsParticle(in: ParticleOut) -> @location(0) vec4f {
  let texel = textureSample(fxTexture, fxSampler, in.uv, in.layer);
  let a = texel.a * in.color.a;
  // PREMULTIPLIED: one pipeline blends (one, 1-src-a) for smoke, the other (one, one) for fire/sparks.
  return vec4f(texel.rgb * in.color.rgb * a, a);
}
`,
  ped: /* wgsl */ `
#include <frame>

// Skinning probe (074/08 B1): one skinned entity through the intended dynamics path — matrices in a
// STORAGE buffer (slot 0 = the model matrix carrying the GTA→engine axis change, bone palettes follow),
// 4-bone vertex blend, textured sun/indirect lighting + the shared fog. No prelit — peds are dynamically
// lit (the plan-034 night fill joins in M3).
struct PedVsIn {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) joints: vec4<u32>,
  @location(4) weights: vec4f,
};

struct PedVsOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) normal: vec3f,
  @location(2) world: vec3f,
};

@group(1) @binding(0) var<storage, read> pedMatrices: array<mat4x4f>;
@group(1) @binding(1) var pedTexture: texture_2d<f32>;
@group(1) @binding(2) var pedSampler: sampler;

@vertex
fn vsPed(in: PedVsIn) -> PedVsOut {
  let source = vec4f(in.position, 1.0);
  let skinned =
    (pedMatrices[1u + in.joints.x] * source) * in.weights.x +
    (pedMatrices[1u + in.joints.y] * source) * in.weights.y +
    (pedMatrices[1u + in.joints.z] * source) * in.weights.z +
    (pedMatrices[1u + in.joints.w] * source) * in.weights.w;
  let sourceNormal = vec4f(in.normal, 0.0);
  let skinnedNormal =
    (pedMatrices[1u + in.joints.x] * sourceNormal) * in.weights.x +
    (pedMatrices[1u + in.joints.y] * sourceNormal) * in.weights.y +
    (pedMatrices[1u + in.joints.z] * sourceNormal) * in.weights.z +
    (pedMatrices[1u + in.joints.w] * sourceNormal) * in.weights.w;
  let world = pedMatrices[0] * vec4f(skinned.xyz, 1.0);
  var out: PedVsOut;
  out.clip = frame.viewProj * world;
  out.uv = in.uv;
  out.normal = normalize((pedMatrices[0] * vec4f(skinnedNormal.xyz, 0.0)).xyz);
  out.world = world.xyz;
  return out;
}

@fragment
fn fsPed(in: PedVsOut) -> @location(0) vec4f {
  let texel = textureSample(pedTexture, pedSampler, in.uv);
  if (texel.a < 0.5) {
    discard;
  }
  let normal = normalize(in.normal);
  let sunNdl = max(dot(normal, frame.sunDir.xyz), 0.0);
  let moonNdl = clamp((dot(normal, frame.moonDir.xyz) + 0.6) / 1.6, 0.0, 1.0);
  // STATIC lamps only, like the vehicles: the driver sits a metre in FRONT of his own tail lights, and the
  // dynamic pool would wash him red from behind every time he brakes.
  let lit = vec3f(frame.params.y) + frame.sunColor.rgb * (sunNdl * frame.params.z) + frame.moonColor.rgb * moonNdl +
    localLightStatic(in.world, normal);
  var color = texel.rgb * lit;
  // Same unified fog shape as fsWorld (068 invariant: distant peds dissolve into the sky behind them).
  let toCamera = in.world - frame.camera.xyz;
  let dist = length(toCamera);
  let viewDir = toCamera / max(dist, 0.001);
  let fogD = max(dist - frame.fog.y, 0.0);
  let fogK = 2.0 / max(frame.fog.x - frame.fog.y, 1.0);
  var fogFactor = 1.0 - exp(-(fogK * fogD) * (fogK * fogD));
  let heightAtten = mix(frame.fog.w, 1.0, exp(-max(in.world.y, 0.0) * frame.fog.z));
  fogFactor = fogFactor * heightAtten;
  fogFactor = max(fogFactor, smoothstep(frame.fog.x * 0.85, frame.fog.x, dist));
  color = mix(color, skyFogFor(viewDir), fogFactor);
  return vec4f(color, 1.0);
}
`,
  post: /* wgsl */ `
// Godrays composite (074/09 stage 1): the scene renders into a LINEAR rgba16float target (the sun disc's
// 3–6× overshoot survives), and this fullscreen pass radial-blurs the thresholded brightness toward the
// sun's screen position — occlusion is inherent (geometry in front of the sun leaves no bright pixels, so
// rays only stream through gaps: the prod GodRaysEffect look). Output goes to the sRGB swapchain view.
struct Post {
  // sun = [uv.x, uv.y, intensity (0 = off), decay per tap]; tint = [rgb godray colour, brightness threshold].
  sun: vec4f,
  tint: vec4f,
};
@group(0) @binding(0) var<uniform> post: Post;
@group(0) @binding(1) var scene: texture_2d<f32>;
@group(0) @binding(2) var sceneSampler: sampler;

struct PostOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vsPost(@builtin(vertex_index) index: u32) -> PostOut {
  // One oversized triangle covers the viewport (no vertex buffer).
  var corners = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  let corner = corners[index];
  var out: PostOut;
  out.clip = vec4f(corner, 0.0, 1.0);
  out.uv = vec2f(corner.x * 0.5 + 0.5, 0.5 - corner.y * 0.5);
  return out;
}

const GODRAY_TAPS = 20u;

@fragment
fn fsPost(in: PostOut) -> @location(0) vec4f {
  var col = textureSampleLevel(scene, sceneSampler, in.uv, 0.0).rgb;
  if (post.sun.z > 0.0) {
    let delta = (post.sun.xy - in.uv) / f32(GODRAY_TAPS);
    var uv = in.uv;
    var weight = 1.0;
    var acc = vec3f(0.0);
    for (var tap = 0u; tap < GODRAY_TAPS; tap += 1u) {
      uv += delta;
      let sample_ = textureSampleLevel(scene, sceneSampler, uv, 0.0).rgb;
      acc += max(sample_ - vec3f(post.tint.w), vec3f(0.0)) * weight;
      weight *= post.sun.w;
    }
    col += acc * post.tint.rgb * (post.sun.z / f32(GODRAY_TAPS));
  }
  return vec4f(col, 1.0);
}
`,
  rigid: /* wgsl */ `
#include <frame>

// Rigid-part dynamics (074/08 B2→B5): vehicle-style entities — CPU-flattened part matrices in a storage
// buffer, parts drawn with firstInstance = slot × partCount + part (instance_index reads the matrix).
// slots.x = texture-array layer, slots.y = the lamps-on twin, slots.z = the carcols PAINT slot (resolved
// per instance — B5 shares one model across differently-painted cars). fsRigid = opaque (alpha forced 1),
// fsRigidBlend = premultiplied glass on the blend pipeline.
struct RigidVsIn {
  @builtin(instance_index) instance: u32,
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) color: vec4f,
  @location(4) slots: vec4<u32>,
  // Reflection slots straight from the DFF material-effect plugins (B5r): env layer, env coefficient,
  // SA reflection intensity, SA specular level. x = 0 means the material is simply not reflective.
  @location(5) reflect: vec4<u32>,
};

struct RigidVsOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) normal: vec3f,
  @location(2) world: vec3f,
  @location(3) color: vec4f,
  @location(4) @interpolate(flat) layer: u32,
  @location(5) @interpolate(flat) nightLayer: u32,
  // slots.w: 0 = body, 1 = head lamp, 2 = tail lamp; lamps = [headlights, brakes, config intensity].
  @location(6) @interpolate(flat) lampTag: u32,
  @location(7) @interpolate(flat) lamps: vec3f,
  @location(8) @interpolate(flat) envLayer: u32,
  // [env coefficient, SA reflection intensity, SA specular level] — all 0..1, all authored per material.
  @location(9) @interpolate(flat) reflect: vec3f,
  // MODEL-space position: the flake hash is anchored to the CAR, so the sparkle rides with it. A world-space
  // hash would make the flakes crawl across the paint as the car drives.
  @location(10) local: vec3f,
};

@group(1) @binding(0) var<storage, read> rigidMatrices: array<mat4x4f>;
@group(1) @binding(1) var rigidTexture: texture_2d_array<f32>;
@group(1) @binding(2) var rigidSampler: sampler;
// Carcols paint (074/08 B5), 4 colours per matrix ROW — indexed by instance_index exactly like the
// matrices, so one uploaded model paints a whole street of differently-coloured cars. slots.z picks:
// 0 = the material's own colour, 1..4 = primary/secondary/tertiary/quaternary.
@group(1) @binding(3) var<storage, read> rigidPaint: array<vec4f>;
// Per-instance lamp state (074/08 B5 step 5): x = headlights on, y = braking. Was a GLOBAL day/night gate,
// which lit every parked car in the city at once; only the DRIVEN car should light up.
@group(1) @binding(4) var<storage, read> rigidLamp: array<vec4f>;

@vertex
fn vsRigid(in: RigidVsIn) -> RigidVsOut {
  let model = rigidMatrices[in.instance];
  let world = model * vec4f(in.position, 1.0);
  var out: RigidVsOut;
  out.clip = frame.viewProj * world;
  out.uv = in.uv;
  out.normal = normalize((model * vec4f(in.normal, 0.0)).xyz);
  out.world = world.xyz;
  var color = in.color;
  if (in.slots.z > 0u) {
    color = vec4f(rigidPaint[in.instance * 4u + (in.slots.z - 1u)].rgb, in.color.a);
  }
  out.color = color;
  out.layer = in.slots.x;
  out.nightLayer = in.slots.y;
  out.lampTag = in.slots.w;
  out.lamps = rigidLamp[in.instance].xyz;
  out.envLayer = in.reflect.x;
  out.reflect = vec3f(in.reflect.yzw) / 255.0;
  out.local = in.position;
  return out;
}

// Lamp materials carry a lamps-on TWIN layer (SA's vehiclelights → vehiclelightson swap): pick it when THIS
// car's headlights are on — a per-vehicle state, not the global day/night blend.
fn rigidTexel(in: RigidVsOut) -> vec4f {
  let lampsOn = in.lamps.x > 0.5 && in.nightLayer != 0u;
  let layer = select(in.layer, in.nightLayer, lampsOn);
  return textureSample(rigidTexture, rigidSampler, in.uv, layer);
}

// A lit lamp SELF-ILLUMINATES: shading it like painted metal leaves it a dull grey patch at night. Tails run
// dim and go bright on the brakes — the one cue that reads as a car stopping ahead of you.
fn rigidLampGlow(in: RigidVsOut) -> f32 {
  if (in.lampTag == 0u || in.lamps.x <= 0.5) {
    return 0.0;
  }
  if (in.lampTag == 2u) {
    return select(LAMP_TAIL_RUN, LAMP_TAIL_BRAKE, in.lamps.y > 0.5) * in.lamps.z;
  }
  return LAMP_HEAD_GLOW * in.lamps.z;
}

const LAMP_HEAD_GLOW = 2.4;
const LAMP_TAIL_RUN = 1.0;
const LAMP_TAIL_BRAKE = 4.0;

// Vehicle reflections (B5r). SA's env maps are BAKED DAYTIME IMAGES — a painted horizon (xvehicleenv128) for
// paint, a sunset photograph (vehicleenvmap128) for glass. Sampling them raw means a car reflects a sunset at
// midnight. So the DFF gives us the SHAPE and the SETTINGS (which texture, coefficient, intensity, specular
// level) and the LIVE SKY gives the colour: the same Preetham LUT the sky pass and the fog already share, so
// the reflection tracks the hour, the sun and the weather for free.
/**
 * AUTOMOTIVE PAINT (B5r round 2). The first two attempts read as matte, and the reasons are worth keeping:
 *
 *  1. OUR SKY IS LDR. A physically-honest Fresnel (F0 ~ 0.05) times a sky that peaks near 0.3 in linear is
 *     ~0.015 — invisible. Real paint mirrors because the real sky is TENS of times brighter than the paint's
 *     own diffuse. So the reflected environment gets a real HDR gain here; blown-out sky on a wing is not a
 *     bug, it is what a car looks like.
 *  2. NOTHING SWEPT ACROSS THE PANEL. A reflection with no dark ground and no horizon LINE has no contrast to
 *     move — it reads as a tint. The environment now has a hard horizon and a dark road under it.
 *  3. SA PANELS ARE FLAT. On a flat quad the mirror direction is CONSTANT, so a perfect mirror still paints a
 *     constant colour. AAA cars are dense and curved and carry normal maps. Our stand-in is METALLIC FLAKE:
 *     a per-pixel micro-normal, anchored in MODEL space so it rides with the car instead of crawling. It is
 *     what makes a flat SA bonnet sparkle under a street lamp — and it is what real car paint actually is.
 */
const REFLECT_HDR = 4.5; // the sky's missing dynamic range, restored where it matters
const REFLECT_GROUND = 0.10; // the road under the car: dark, so the horizon reads as a hard line
const CLEARCOAT_F0 = 0.05; // dielectric lacquer — barely mirrors head-on, near-mirror at grazing
const PAINT_ROUGHNESS = 0.35; // paint blurs its reflection; glass does not (see rigidClearcoat)
const PATTERN_MIX = 0.30; // how much of SA's painted env texture rides on top of the live sky
const FLAKE_SCALE = 220.0;
const FLAKE_AMOUNT = 0.22;
const SPEC_POWER = 120.0;
const SPEC_LAMP_POWER = 220.0; // street lamps and headlights make TIGHTER highlights than the sun
const SPEC_GAIN = 6.0;

/** Cheap 3D hash -> a unit-ish vector, for the flake micro-normals. */
fn flakeHash(p: vec3f) -> vec3f {
  let h = fract(sin(vec3f(dot(p, vec3f(127.1, 311.7, 74.7)), dot(p, vec3f(269.5, 183.3, 246.1)), dot(p, vec3f(113.5, 271.9, 124.6)))) * 43758.5453);
  return h * 2.0 - vec3f(1.0);
}

/**
 * Metallic flake: perturb the normal per pixel with a stable, model-space hash. Anchored to the CAR, not the
 * world — a world-space hash would make the flakes crawl across the paint as the car drives.
 */
fn flakeNormal(normal: vec3f, local: vec3f) -> vec3f {
  let cell = floor(local * FLAKE_SCALE);
  return normalize(normal + flakeHash(cell) * FLAKE_AMOUNT);
}

/**
 * The world a car reflects: the LIVE sky with its sun/moon discs AND the cloud dome above, the dark road
 * below, split by a hard horizon. The discs are the point — a gradient alone gives a dull sheen; it is the
 * bright blob and the horizon line sliding across a wing as you turn that read as polished lacquer. HDR, so
 * it also feeds the bloom/godray pass for free.
 */
fn reflectedWorld(dir: vec3f) -> vec3f {
  let sky = skyBaseFor(dir) + skyCelestialFor(dir);
  let cloud = cloudLayerFor(dir);
  let above = mix(sky, cloud.rgb, cloud.a * frame.params3.w) * REFLECT_HDR;
  // The road: the ambient sky bounced off asphalt. Dark on purpose — the CONTRAST with the sky is what makes
  // a reflection look like a reflection instead of a tint.
  let ground = skyBaseFor(vec3f(dir.x, 0.15, dir.z)) * REFLECT_GROUND;
  return mix(ground, above, smoothstep(-0.03, 0.03, dir.y));
}

/**
 * The SA env texture, sampled the SA way: a sphere map indexed by the VIEW-SPACE normal, so the highlight
 * band sweeps across the bodywork as the car turns. We keep only its LUMINANCE — the streaks and the horizon
 * band, i.e. the "hand-painted studio" character — and let the sky supply the colour.
 */
fn envPattern(in: RigidVsOut, normal: vec3f) -> f32 {
  let toEye = normalize(frame.camera.xyz - in.world);
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), toEye));
  let up = cross(toEye, right);
  let uv = vec2f(dot(normal, right), dot(normal, up)) * 0.5 + vec2f(0.5);
  let texel = textureSample(rigidTexture, rigidSampler, uv, in.envLayer);
  return dot(texel.rgb, vec3f(0.2126, 0.7152, 0.0722));
}

/**
 * The full reflection term. NB the env tap happens BEFORE the reflective/matte branch: textureSample needs
 * UNIFORM control flow (implicit derivatives), and the coefficient is a per-material varying — the same rule
 * the stochastic world sampler had to obey.
 */
fn rigidClearcoat(in: RigidVsOut, normal: vec3f) -> vec3f {
  let flaked = flakeNormal(normal, in.local);
  let pattern = mix(1.0, envPattern(in, normal) * 2.0, PATTERN_MIX);
  let coefficient = in.reflect.x;
  // The flakes ride the SPECULAR lobes only — they are microscopic mirrors, not a bumpy body.
  let specular = rigidSpecular(in, flaked, in.reflect.z * frame.params4.z);
  if (coefficient <= 0.0 || frame.params4.z <= 0.0) {
    return specular; // tyres, rubber, matte trim — SA leaves the plugin on them with a coefficient of 0
  }
  let toEye = normalize(frame.camera.xyz - in.world);
  let mirror = reflect(-toEye, flaked);
  // Prefiltered-IBL stand-in: paint blurs what it reflects, so blend the sharp mirror tap toward the sky in
  // the NORMAL direction (a maximally blurred sample). Roughness 0 would be chrome; glass keeps it sharper.
  let sharp = reflectedWorld(mirror);
  let blurred = reflectedWorld(normalize(mix(mirror, normal, 0.65)));
  let env = mix(sharp, blurred, PAINT_ROUGHNESS);
  let fresnel = CLEARCOAT_F0 + (1.0 - CLEARCOAT_F0) * pow(1.0 - max(dot(flaked, toEye), 0.0), 5.0);
  let strength = coefficient * frame.params4.z * fresnel * pattern;
  return env * strength + specular;
}

/**
 * Specular highlights. The sun/moon give the broad sheen; the LIGHT POOL gives the tight ones that slide
 * along a bonnet as you drive under street lamps — which is what actually makes a car read as glossy at
 * night, when the sky reflection has almost nothing left to give.
 */
fn rigidSpecular(in: RigidVsOut, normal: vec3f, level: f32) -> vec3f {
  if (level <= 0.0) {
    return vec3f(0.0);
  }
  let toEye = normalize(frame.camera.xyz - in.world);
  let sun = pow(max(dot(normal, normalize(frame.sunDir.xyz + toEye)), 0.0), SPEC_POWER);
  let moon = pow(max(dot(normal, normalize(frame.moonDir.xyz + toEye)), 0.0), SPEC_POWER);
  var sum = (frame.sunColor.rgb * sun + frame.moonColor.rgb * moon) * SPEC_GAIN;
  // The sky itself is a light: a sheen along the whole upper surface, which is what keeps a roof from
  // reading as flat paint even with no sun in frame.
  sum += skyBaseFor(normal) * (pow(max(normal.y, 0.0), 3.0) * 0.35);
  // Bounded loop over the WHOLE pool — a car should catch its own headlights' bounce off a wall as much as
  // the street lamp overhead, and the pool is where both live.
  let count = min(u32(frame.params3.x), 64u);
  for (var index = 0u; index < count; index += 1u) {
    let light = localLights[index];
    let toLight = light.position.xyz - in.world;
    let dist = length(toLight);
    if (dist < light.position.w) {
      let halfway = normalize(toLight / max(dist, 0.001) + toEye);
      let falloff = 1.0 - dist / light.position.w;
      sum += light.color.rgb * (pow(max(dot(normal, halfway), 0.0), SPEC_LAMP_POWER) * falloff * falloff);
    }
  }
  return sum * level;
}



fn rigidShade(in: RigidVsOut, texel: vec4f) -> vec3f {
  let normal = normalize(in.normal);
  let sunNdl = max(dot(normal, frame.sunDir.xyz), 0.0);
  let moonNdl = clamp((dot(normal, frame.moonDir.xyz) + 0.6) / 1.6, 0.0, 1.0);
  let base = texel.rgb * in.color.rgb;
  // A LIT lamp is a SOURCE, not a surface: it emits, and its diffuse response is irrelevant. Shading it like
  // painted metal is what "cropped" the tail lights — the lens wraps around the car's corner, so its normal
  // swings ~90° across the lens, and a nearby street lamp painted that swing straight onto the glass as a
  // hard gradient broken at the triangle edge. Prod never showed it because its lamp glass is emissive-
  // dominant (emissiveMap × 1..4), which drowns the diffuse term. Ambient keeps the unlit texel detail alive.
  let glow = rigidLampGlow(in);
  if (glow > 0.0) {
    return base * (frame.params.y + glow);
  }
  // STATIC lamps only. A car must not be lit by its OWN headlights (the tail lamp sits a metre behind its own
  // lens); prod has the same rule by construction — its pool lives in the WORLD material only.
  let lit = vec3f(frame.params.y) + frame.sunColor.rgb * (sunNdl * frame.params.z) + frame.moonColor.rgb * moonNdl +
    localLightStatic(in.world, normal);
  return base * lit;
}

fn rigidFog(world: vec3f) -> f32 {
  let toCamera = world - frame.camera.xyz;
  let dist = length(toCamera);
  let fogD = max(dist - frame.fog.y, 0.0);
  let fogK = 2.0 / max(frame.fog.x - frame.fog.y, 1.0);
  var fogFactor = 1.0 - exp(-(fogK * fogD) * (fogK * fogD));
  fogFactor = fogFactor * mix(frame.fog.w, 1.0, exp(-max(world.y, 0.0) * frame.fog.z));
  return max(fogFactor, smoothstep(frame.fog.x * 0.85, frame.fog.x, dist));
}

@fragment
fn fsRigid(in: RigidVsOut) -> @location(0) vec4f {
  let fog = rigidFog(in.world);
  let viewDir = normalize(in.world - frame.camera.xyz);
  let color = mix(rigidShade(in, rigidTexel(in)), skyFogFor(viewDir), fog);
  return vec4f(color, 1.0);
}

@fragment
fn fsRigidBlend(in: RigidVsOut) -> @location(0) vec4f {
  // Premultiplied for the (one, 1−src-α) pipeline; fog scales the pair (068 semantics for blends).
  // The alpha is BOTH sources: glass carries it in the material colour, body decals (scratch/crack overlays)
  // carry it in the TEXEL. Taking only the material's would render a decal opaque — its transparent black
  // texels then paint a black panel over the door.
  let texel = rigidTexel(in);
  let fog = rigidFog(in.world);
  let viewDir = normalize(in.world - frame.camera.xyz);
  let normal = normalize(in.normal);
  // Glass turns MIRROR at grazing angles — that is what glass does, and a windscreen you can see straight
  // through from every angle looks like a hole in the car. The clearcoat fresnel drives the opacity itself.
  let fresnel = pow(1.0 - max(dot(normal, -viewDir), 0.0), 5.0);
  let alpha = clamp(texel.a * in.color.a + fresnel * in.reflect.x * frame.params4.z, 0.0, 1.0);
  let color = mix(rigidShade(in, texel) * alpha, skyFogFor(viewDir) * alpha, fog);
  return vec4f(color, alpha);
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
  // Reversed-Z: the far plane is depth 0.
  out.clip = vec4f(x, y, 0.0, 1.0);
  out.ndc = vec2f(x, y);
  return out;
}

// Procedural night starfield (074/06 row 16, the prod sky.plugin port): gnomonic-projected cell hash —
// ~one star per 10 % of cells, random brightness, gentle twinkle, horizon taper. SKY PASS ONLY: fog and
// world fragments share skyFogFor and must NOT twinkle.
fn hash21(cell: vec2f) -> f32 {
  return fract(sin(dot(cell, vec2f(127.1, 311.7))) * 43758.5453);
}

fn starField(dir: vec3f) -> f32 {
  if (dir.y <= 0.02) {
    return 0.0;
  }
  let uv = dir.xz / dir.y * 6.0;
  let cell = floor(uv);
  let f = fract(uv);
  let present = step(0.90, hash21(cell));
  let star = vec2f(hash21(cell + 1.7), hash21(cell + 4.3));
  let d = length(f - star);
  let point = smoothstep(0.06, 0.0, d) * present;
  let bright = 0.35 + 0.65 * hash21(cell + 8.1);
  let twinkle = 0.6 + 0.4 * sin(frame.params2.z * 2.5 + hash21(cell) * 90.0);
  let taper = smoothstep(0.02, 0.35, dir.y);
  return point * bright * twinkle * taper;
}

@fragment
fn fsSky(in: SkyOut) -> @location(0) vec4f {
  let far = frame.invViewProj * vec4f(in.ndc, 1.0, 1.0);
  let dir = normalize(far.xyz / far.w - frame.camera.xyz);
  var col = skyBaseFor(dir);
  // Cloud dome (074/06 row 15, the RealSkybox model without the mesh): azimuthal-equidistant mapping
  // measured off the mod's sphere (uv = 0.5 ∓ dir_horiz·k·θ, k ≈ 0.297/rad), slow rotation on the wind
  // clock (moonColor.w = rad/s from env.cloudSpeed), brightness follows the sky horizon (timecyc mood)
  // with a night floor, dark from env. Two slots crossfaded by camera.w (weather change fade);
  // params3.y = cloud layer enable (0 = no texture bound).
  var occl = 0.0;
  let sunDot = max(dot(dir, frame.sunDir.xyz), 0.0);
  if (frame.params3.y > 0.5 && dir.y > 0.0) {
    let theta = acos(clamp(dir.y, -1.0, 1.0));
    let horiz = normalize(vec2f(dir.x, -dir.z) + vec2f(1e-5, 0.0));
    let spin = frame.params2.z * frame.moonColor.w;
    let rot = mat2x2f(vec2f(cos(spin), sin(spin)), vec2f(-sin(spin), cos(spin)));
    let spun = rot * horiz;
    let radius = theta * 0.297;
    let uv = vec2f(0.5 - spun.x * radius, 0.5 + spun.y * radius);
    let cloud = mix(
      textureSampleLevel(cloudDomeA, skyLutSampler, uv, 0.0),
      textureSampleLevel(cloudDomeB, skyLutSampler, uv, 0.0),
      frame.camera.w,
    );
    // Luminance-scaled by the horizon colour so clouds live in the timecyc mood; night floor keeps them
    // from black; cloudDark flattens storm layers.
    let mood = frame.skyHorizon.rgb;
    let brightness = max((mood.r + mood.g + mood.b) / 3.0 * 1.4, 0.10) * (1.0 - frame.params3.z * 0.6);
    let horizonFade = smoothstep(0.0, 0.12, dir.y);
    let alpha = cloud.a * horizonFade;
    col = mix(col, cloud.rgb * brightness, alpha * frame.params3.w);
    // Celestial occlusion uses the TEXTURE alpha, only gated (not scaled) by the layer-alpha knob: an
    // opaque overcast deck must fully hide the discs (field: the moon glowed through CLOUDY at 0.85).
    occl = alpha * clamp(frame.params3.w * 1.6, 0.0, 1.0);
    // Forward scatter through the deck (godrays proper land with plan 09's HDR chain): a silver lining
    // where half-opaque cloud edges sit near the sun + a milky diffuse blob through thick cover.
    let scatter = pow(sunDot, 12.0) * occl * (1.0 - occl) * 1.6 +
      pow(sunDot, 24.0) * occl * 0.35 * (1.0 - frame.params3.z);
    col += frame.sunCorona.rgb * scatter * horizonFade;
  }
  // Sun/moon discs and stars sit BEHIND the cloud layer: squared falloff kills the disc overshoot under
  // thick cover while thin wisps still let a dimmed disc through (prod's uCloudClear analogue).
  let clear = (1.0 - occl) * (1.0 - occl);
  col += skyCelestialFor(dir) * clear;
  // Stars fade GLOBALLY with the weather's cloud cover (prod uCloudClear; sunCorona.w) — the panoramas
  // leave alpha gaps between painted puffs, and per-pixel occlusion alone let stars leak through them.
  let cloudClear = 1.0 - clamp(frame.sunCorona.w * 1.15, 0.0, 1.0);
  col += vec3f(starField(dir)) * frame.params.x * clear * cloudClear;
  return vec4f(col, 1.0);
}
`,
  water: /* wgsl */ `
#include <frame>

// Water v1 (074/06 row 12; plan 069's look, RUNTIME-ONLY — no converter bake): flat water.dat quads +
// the ocean frame, Gerstner SLOPES only (prod's approach — the quads are far too coarse to displace),
// fresnel between the timecyc deep tint and the shared sky dome, sun glint off the wave normal, and the
// 068 fog — the sea dissolves into the horizon exactly like land does.
// group(1): the authored textures (particle.txd, runtime-parsed by the host): waterclear256 = the
// close-up ripple (real detail where the analytic trains are too smooth), waterwake = the shore foam.
@group(1) @binding(0) var waterRipple: texture_2d<f32>;
@group(1) @binding(1) var waterSampler: sampler;
@group(1) @binding(2) var waterFoam: texture_2d<f32>;

struct WaterOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) shore: f32,
  @location(2) swell: f32,
};

// The two LONGEST trains DISPLACE the tessellated grid (074/06 row 12 v2 — the baked ~16 u mesh finally
// moves); the short trains stay slope-only in the fragment normal. Damped to a calm sheet at the beach
// by the baked shore field.
fn swellHeight(p: vec2f, t: f32) -> f32 {
  let wind = vec2f(0.825, 0.565);
  let side = vec2f(-wind.y, wind.x);
  let d1 = normalize(wind * 0.8 + side * 0.6);
  return sin(dot(p, wind) * 0.045 + t * 0.9) * 1.0 + sin(dot(p, d1) * 0.083 + t * 1.2) * 0.62;
}

// The BREAKING wave (074/06 row 12 v3): a front running toward the beach along the DEPTH field
// (phase = depth·k − t·speed → crests follow depth contours, parallel to the visual waterline — the
// reference look), peaked in the surf band (0.3–4 m) and dying right at the waterline.
fn surfPhase(depth: f32, t: f32) -> f32 {
  // +t: the constant-phase contour moves toward depth 0 — the front runs AT the beach (field round 5:
  // −t read as waves leaving the shore).
  return sin(depth * 1.4 + t * 1.6);
}

@vertex
fn vsWater(@location(0) position: vec3f, @location(1) depth: f32) -> WaterOut {
  var out: WaterOut;
  let damp = smoothstep(1.0, 9.0, depth);
  let swell = swellHeight(vec2f(position.x, position.z), frame.params2.z) * damp;
  // The lower gate keeps the WAVE trains out of the swash zone (field round 7: short-wavelength
  // displacement tore a jagged waterline) — but the SURGE below is smooth and constant there, so it
  // moves the waterline cleanly.
  let surf = surfPhase(depth, frame.params2.z) *
    (1.0 - smoothstep(1.8, 6.0, depth)) * smoothstep(0.5, 1.5, depth);
  // Swash SURGE (round 12 — "move the ocean itself back and forth"): a flat plane's edge only moves via
  // HEIGHT, so the whole shore zone breathes ±0.25 m on the foam clock. The waterline physically runs
  // metres up the sand exactly when the foam front lands (same runup), then pulls back out. The water
  // quads extend under the beach with baked depth 0 there — the revealed strip arrives pre-foamed and
  // near-transparent: the swash sheet on the sand for free.
  let surgeRunup = 0.5 + 0.5 * sin(frame.params2.z * 0.85);
  let surge = (surgeRunup - 0.5) * 0.5 * (1.0 - smoothstep(0.5, 3.0, depth));
  var displaced = position;
  displaced.y += swell * 0.32 + surf * 0.45 + surge;
  out.clip = frame.viewProj * vec4f(displaced, 1.0);
  out.world = displaced;
  out.shore = depth;
  out.swell = swell;
  return out;
}

// Four analytic wave trains (the prod waterNormal port, slopes only) + the same distance-LOD fade:
// a high-frequency train aliases into moiré bands once a pixel spans many wavelengths.
// Field round 1 fixes: a large-scale DOMAIN WARP breaks the fixed-frequency interference grid (the water
// read as tiled rows), gentler slope amplitude kills the bright "pillow" bands, and the LOD fade range is
// wider so train transitions smear instead of banding by camera distance.
fn waveGradient(p0: vec2f, t: f32, viewDist: f32) -> vec2f {
  let p = p0 + vec2f(sin(p0.y * 0.013 + t * 0.26), sin(p0.x * 0.011 - t * 0.21)) * 9.0;
  let wind = vec2f(0.825, 0.565); // fixed wind heading in v1 (prod exposes uWindAngle — config later)
  let side = vec2f(-wind.y, wind.x);
  var dirs = array<vec2f, 4>(
    wind,
    normalize(wind * 0.8 + side * 0.6),
    normalize(wind * 0.9 - side * 0.5),
    normalize(wind * 0.4 + side * 1.0),
  );
  var freqs = array<f32, 4>(0.045, 0.083, 0.150, 0.260);
  var speeds = array<f32, 4>(0.9, 1.2, 1.6, 2.1);
  var weights = array<f32, 4>(1.0, 0.62, 0.38, 0.22);
  var grad = vec2f(0.0);
  for (var i = 0u; i < 4u; i += 1u) {
    let wavelength = 6.2831853 / freqs[i];
    let fade = smoothstep(wavelength * 90.0, wavelength * 10.0, viewDist);
    let phase = dot(p, dirs[i]) * freqs[i] + t * speeds[i];
    // The two LONG (displaced) trains barely tilt the LIGHTING normal (0.3×): their slopes reflected the
    // bright horizon sky as wide colour bands mid-distance (field round 3); their job is the silhouette.
    let slopeWeight = select(3.5, 1.0, i < 2u);
    grad += dirs[i] * cos(phase) * freqs[i] * weights[i] * slopeWeight * fade;
  }
  // Slow cross-swell keeps the far water alive when the trains have LOD-faded out.
  grad += vec2f(0.011) * cos((p.x + p.y) * 0.022 + t * 0.9);
  return grad;
}

@fragment
fn fsWater(in: WaterOut) -> @location(0) vec4f {
  let toEye = frame.camera.xyz - in.world;
  let dist = length(toEye);
  let view = toEye / max(dist, 1e-4);
  // The wave field lives on the horizontal plane: GTA xy == engine xz.
  let p = vec2f(in.world.x, in.world.z);
  let t = frame.params2.z;
  var grad = waveGradient(p, t, dist);
  // Close-up detail from the authored waterclear256 ripple (prod's term): two scrolled taps read as a
  // slope — always on, so the surface shimmers even in a dead calm. Sampled UNCONDITIONALLY (implicit-LOD
  // textureSample is illegal in non-uniform control flow) and weighted by the near fade.
  let near = smoothstep(200.0, 20.0, dist);
  let duv = p * 0.09;
  let flow = vec2f(0.825, 0.565) * t * 0.022; // field fix: 0.004 read as frozen
  let e = 0.06;
  let h0 = textureSample(waterRipple, waterSampler, duv + flow).r +
    textureSample(waterRipple, waterSampler, duv * 1.7 - flow * 1.3).r;
  let hx = textureSample(waterRipple, waterSampler, duv + vec2f(e, 0.0) + flow).r +
    textureSample(waterRipple, waterSampler, (duv + vec2f(e, 0.0)) * 1.7 - flow * 1.3).r;
  let hy = textureSample(waterRipple, waterSampler, duv + vec2f(0.0, e) + flow).r +
    textureSample(waterRipple, waterSampler, (duv + vec2f(0.0, e)) * 1.7 - flow * 1.3).r;
  grad += vec2f(hx - h0, hy - h0) * (1.1 * near);
  // Far-field FLATTEN (field round 2 — swell faces mirrored the bright fog horizon as huge white bands):
  // distant water reads as a calm mirror; the swell survives in the silhouette via the displacement.
  var normal = normalize(vec3f(-grad.x, 1.0, -grad.y));
  normal = normalize(mix(normal, vec3f(0.0, 1.0, 0.0), smoothstep(120.0, 500.0, dist)));
  let fresnel = pow(1.0 - clamp(dot(normal, view), 0.0, 1.0), 5.0);
  var refl = reflect(-view, normal);
  refl.y = abs(refl.y); // the sky dome has no below-horizon content
  let sky = skyBaseFor(refl);
  var color = mix(frame.waterColor.rgb, sky, 0.2 + 0.55 * fresnel);
  // Sun glint: TIGHT Blinn toward the sun, whitened (field round 1: raw sunCorona painted pink patches;
  // a real glitter path is near-white with only a warm cast) and modulated by the fine ripple so it
  // sparkles instead of pooling on the smooth train slopes.
  let h = normalize(view + frame.sunDir.xyz);
  let glint = pow(max(dot(normal, h), 0.0), 650.0);
  color += mix(frame.sunCorona.rgb, vec3f(1.0), 0.55) * glint * (0.25 + 0.45 * near);
  var alpha = clamp(frame.waterColor.a + fresnel * 0.25, 0.0, 1.0);
  // Shore water (074/06 row 12 v3, the baked DEPTH field): shallow = brighter and MUCH more
  // transparent (the sand reads through the last metre — the wet-swash look of the reference).
  let shallow = 1.0 - smoothstep(0.0, 4.0, in.shore);
  color = mix(color, color * 1.2 + vec3f(0.01, 0.03, 0.03), shallow * 0.35);
  alpha *= mix(1.0, 0.4, shallow * shallow);
  // waterwake is a WHITE sprite with the shape in ALPHA (field: .r alone painted solid white bands) —
  // shape = a·r. Foam lives in TWO places (the reference look): the WASH at the waterline (depth < 0.8 m,
  // pulsing with the surf runup) and the BREAKING LINE offshore — the crest of the incoming front in the
  // 0.8–3.5 m band, a bright irregular stripe travelling shoreward.
  // Foam, round 8 — TWO synchronized actors on one clock (t·1.6):
  //  · the INCOMING crest carries foam from 3.5 m down to the landing depth (~0.9 m), continuous;
  //  · the SWASH SHEET: its leading edge PHYSICALLY oscillates between 1.4 m and 0.1 m of depth,
  //    delayed to pick up where the crest lands — foam visibly runs up the beach AND pulls back out
  //    (the field ask), dimming on the retreat.
  // Shape mixes waterwake with the waterclear ripple for organic, non-repeating edges.
  let foamUv = p * 0.15 + flow * 6.0;
  let tapA = textureSample(waterFoam, waterSampler, foamUv);
  let tapB = textureSample(waterFoam, waterSampler, foamUv * 0.57 + vec2f(0.37));
  let foamNoise = textureSample(waterRipple, waterSampler, p * 0.045 - flow * 2.0).r;
  let foamShape = clamp(max(tapA.a * tapA.r, tapB.a * tapB.r) * (0.55 + 0.75 * foamNoise), 0.0, 1.0);
  // ONE foam front, round 10 (the field kept seeing TWO events — a crest dying mid-way and a separate
  // shore sheet). A single wave: its FRONT POSITION travels the whole 3 m → 0.08 m and back on one slow
  // clock; the foam mass trails ~1.5–3 m of depth behind the front. Envelopes per the user's spec:
  //  · intensity fades IN as the front leaves deep water (soft birth) and dims on the retreat;
  //  · hardness peaks exactly when the front reaches the edge, melts back to milky as it withdraws.
  // Round 11: BOTH envelopes ride the front POSITION only — no phase-direction terms. The old advancing
  // dimmer killed the foam exactly at the turning point ("reaches the edge and dies"); now brightness
  // stays FULL at the edge and through the retreat, dissolving only once the front is back out deep,
  // and hardness decays purely with distance from the edge (hard at the sand, melting on the way out).
  let cycle = t * 0.85;
  let runup = 0.5 + 0.5 * sin(cycle);
  let front = mix(3.0, 0.08, runup);
  let mass = smoothstep(front - 0.2, front + 0.15, in.shore) *
    (1.0 - smoothstep(front + 1.5, front + 3.2, in.shore));
  let intensity = smoothstep(0.02, 0.3, runup);
  let rim = (1.0 - smoothstep(0.05, 0.3, in.shore)) * 0.35;
  let crest = smoothstep(1.15, 1.55, in.swell) * 0.12;
  let soft = clamp(foamShape * (mass * intensity + rim) * 1.5 + foamShape * crest, 0.0, 1.0);
  let hard = smoothstep(0.35, 0.6, soft);
  let hardness = smoothstep(0.45, 0.97, runup);
  let foam = mix(soft * 0.85, max(soft, hard), hardness);
  color = mix(color, vec3f(0.95, 0.97, 0.97), foam);
  alpha = max(alpha, foam * 0.95);
  // Unified fog (the 068 shape — identical math to the world shaders).
  let fogD = max(dist - frame.fog.y, 0.0);
  let fogK = 2.0 / max(frame.fog.x - frame.fog.y, 1.0);
  var fogFactor = 1.0 - exp(-(fogK * fogD) * (fogK * fogD));
  fogFactor = fogFactor * mix(frame.fog.w, 1.0, exp(-max(in.world.y, 0.0) * frame.fog.z));
  fogFactor = max(fogFactor, smoothstep(frame.fog.x * 0.85, frame.fog.x, dist));
  color = mix(color, skyFogFor(-view), fogFactor);
  // Fully fogged water must MATCH the sky behind it — fade the surface out with the fog so the horizon
  // line dissolves instead of drawing a hard sea edge (the ocean-horizon regression view).
  alpha = mix(alpha, 1.0, fogFactor);
  return vec4f(color * alpha, alpha);
}
`,
  world: /* wgsl */ `
#include <frame>

// origin.w = per-cell channel flag bits: bit 0 = baked sunVis (normal.w meaningful), bit 1 = baked
// emissive mask (high channels byte meaningful). Zero = neither (old paks render unchanged).
// uvAnim (B7·c / plan 074/18) = the UV-scroll transform applied to every vertex: uv·uvAnim.zw + uvAnim.xy.
// IDENTITY (0,0,1,1) for ordinary cells (a uniform-gated no-op); a kind-4 objectTable draw binds a per-object
// cell buffer whose uvAnim the host advances each frame (the LV skull sign's crawling neon).
struct Cell {
  origin: vec4f,
  uvAnim: vec4f,
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
  @location(9) localLight: vec3f,
  // World-space normal — the world is vertex-lit (sunNdl/moonNdl are precomputed), but a MOVING light must
  // be shaded per pixel, and that needs the normal here.
  @location(10) normal: vec3f,
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
  // UV-scroll (B7·c): identity for ordinary geometry; a kind-4 draw's per-object cell buffer carries the
  // animated transform. Applied here so it composes with the far-outside-[0,1] GTA UVs the world tiles.
  out.uv = in.uv * cell.uvAnim.zw + cell.uvAnim.xy;
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
  // Sun-vis SCALAR (074/07 v1, the accepted look): normal.w = arc-averaged sun visibility — soft static
  // occlusion (dark under bridges/canyons), does NOT track the moving sun. The directional v2 is PARKED
  // until the converter can subdivide large receiver polys (see plan 07).
  let sunGate = f32(cellFlags & 1u) * frame.params2.y;
  let sunVis = mix(1.0, clamp(in.normal.w, 0.0, 1.0), sunGate);
  let worldNormal = normalize(in.normal.xyz);
  out.sunNdl = max(dot(worldNormal, frame.sunDir.xyz), 0.0) * sunVis;
  // Moon N·L, WRAPPED (074/06 row 6): the same static occlusion gates moonlight.
  out.moonNdl = clamp((dot(worldNormal, frame.moonDir.xyz) + 0.6) / 1.6, 0.0, 1.0) * sunVis;
  // Baked AO/skyVis (074/07): low byte of channels; 0 means UNBAKED (old paks) → fully open, not black.
  let aoByte = in.layerChannels.y & 0xffu;
  let aoVis = select(f32(aoByte) / 255.0, 1.0, aoByte == 0u);
  out.ao = mix(1.0, aoVis, frame.params2.x);
  // Beam cone alpha (074/06 row 11): dayPrelit.a — 1 everywhere except floodlight-cone geometry.
  out.cone = in.dayPrelit.a;
  // Local light pool (074/06 row 7): VERTEX-lit like everything else in SA.
  out.localLight = localLightStatic(world, worldNormal);
  out.normal = worldNormal;
  return out;
}

// Stochastic de-tiling (074/12, the skygfx 3-tap tiling-and-blend): UVs skew into a triangular grid, each
// grid vertex hashes to a random UV offset, 3 taps blend by barycentric weights — macro-repetition dies,
// micro-detail stays. Explicit grads are mandatory twice over: the offsets are DISCONTINUOUS at grid seams
// (implicit gradients pick garbage mips there), and this runs in a non-uniform branch.
fn hash2D2D(s: vec2f) -> vec2f {
  return fract(sin(vec2f(dot(s, vec2f(127.1, 311.7)), dot(s, vec2f(269.5, 183.3))) % 3.14159) * 43758.5453);
}

fn stochasticTexel(uv: vec2f, layer: u32, uvDx: vec2f, uvDy: vec2f) -> vec4f {
  let skew = mat2x2f(vec2f(1.0, -0.57735027), vec2f(0.0, 1.15470054)) * (uv * 3.464);
  let vxID = floor(skew);
  let fracts = fract(skew);
  let bz = 1.0 - fracts.x - fracts.y;
  var v0 = vxID + vec2f(1.0, 1.0);
  var v1 = vxID + vec2f(1.0, 0.0);
  var v2 = vxID + vec2f(0.0, 1.0);
  var w = vec3f(-bz, 1.0 - fracts.y, 1.0 - fracts.x);
  if (bz > 0.0) {
    v0 = vxID;
    v1 = vxID + vec2f(0.0, 1.0);
    v2 = vxID + vec2f(1.0, 0.0);
    w = vec3f(bz, fracts.y, fracts.x);
  }
  return textureSampleGrad(worldTexture, worldSampler, uv + hash2D2D(v0), layer, uvDx, uvDy) * w.x +
    textureSampleGrad(worldTexture, worldSampler, uv + hash2D2D(v1), layer, uvDx, uvDy) * w.y +
    textureSampleGrad(worldTexture, worldSampler, uv + hash2D2D(v2), layer, uvDx, uvDy) * w.z;
}

fn worldShade(in: VsOut, cutout: bool) -> vec4f {
  // Textures ship PREMULTIPLIED (074/02): filtering is correct by construction, transparent texels
  // contribute nothing — the alpha-edge fix. Alpha feeds coverage on the cutout pipeline (A2C).
  // Layer bit 15 = stochastic flag (074/12); grads + the plain tap stay in UNIFORM control flow.
  let layer = in.layer & 0xffu;
  let uvDx = dpdx(in.uv);
  let uvDy = dpdy(in.uv);
  var texel = textureSample(worldTexture, worldSampler, in.uv, layer);
  if ((in.layer & 0x8000u) != 0u && frame.moonDir.w > 0.5) {
    texel = stochasticTexel(in.uv, layer, uvDx, uvDy);
  }
  if (cutout) {
    // Needle-fine foliage minifies to FRACTIONAL sampled alpha across the whole crown (each pixel covers
    // many leaf/gap texels) — raw A2C turns that into a uniform screen-door stipple. Sharpen the SAMPLED
    // alpha toward the vanilla alpha-test look (fwidth keeps real silhouettes antialiased) and
    // un-premultiply the colour so boosted coverage does not render the ×alpha-darkened RGB.
    let sharpened = clamp((texel.a - 0.5) / max(fwidth(texel.a), 0.0001) + 0.5, 0.0, 1.0);
    texel = vec4f(texel.rgb / max(texel.a, 0.05), sharpened);
  }
  // Hybrid lighting (074/06 row 3, the shipped 064 model): prelit is the INDIRECT term, the sun adds a real
  // direct term on the raw albedo. indirect/direct ride frame params — day arcs are a CPU concern.
  // Baked AO modulates ONLY the indirect term (074/07) — sun shadowing is the separate sunVis bake.
  let lit = in.prelit * (frame.params.y * in.ao) +
    frame.sunColor.rgb * (in.sunNdl * frame.params.z) +
    frame.moonColor.rgb * in.moonNdl +
    in.localLight +
    localLightDynamic(in.world, normalize(in.normal));
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
  color = mix(color, skyFogFor(viewDir) * texel.a, fogFactor);
  return vec4f(color, texel.a);
}

@fragment
fn fsWorld(in: VsOut) -> @location(0) vec4f {
  return worldShade(in, false);
}

@fragment
fn fsWorldCutout(in: VsOut) -> @location(0) vec4f {
  return worldShade(in, true);
}

@fragment
fn fsBeam(in: VsOut) -> @location(0) vec4f {
  // Floodlight cones (074/06 row 11, plan 032): 'white'-textured geometry whose soft cone lives in the
  // per-vertex prelit ALPHA. Output is PREMULTIPLIED for the (one, one-minus-src-alpha) blend pipeline.
  // No sun/glow terms — a beam is self-lit, tinted only by the dn-mixed prelit colour.
  let texel = textureSample(worldTexture, worldSampler, in.uv, in.layer & 0xffu);
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
/**
 * WGSL reserved words that read like perfectly ordinary identifiers — the ones a shader author actually
 * reaches for. (The full spec list is long and mostly implausible; these are the traps.)
 */
const WGSL_RESERVED = new Set([
  'as',
  'do',
  'enum',
  'filter',
  'from',
  'get',
  'inline',
  'layout',
  'match',
  'meta',
  'mod',
  'module',
  'move',
  'new',
  'null',
  'of',
  'pass',
  'precise',
  'ref',
  'require',
  'resource',
  'self',
  'set',
  'shared',
  'static',
  'std',
  'target',
  'template',
  'this',
  'type',
  'typedef',
  'union',
  'unless',
  'use',
  'using',
  'where',
]);

export function assertGuardrails(name: string, wgsl: string): void {
  // A BACKTICK inside WGSL terminates the TypeScript template literal this store is written in — the file
  // stops parsing and the error lands nowhere near the shader. It has cost this project four separate
  // debugging detours; the store itself must reject it.
  if (wgsl.includes('`')) {
    throw new Error(`<${name}>: backtick in WGSL — it closes the TS template literal (use plain quotes)`);
  }
  // Dynamically-indexed uniform-space ARRAYS in fragment code collapsed occupancy on Metal (073: ~250 ms).
  // Uniform structs are fine; `var<uniform>` holding an array type is the banned shape.
  if (/var<uniform>[^;]*:\s*array</.test(wgsl)) {
    throw new Error(`<${name}>: uniform-space array detected — use a texture or storage buffer (073 guardrail)`);
  }
  if (/\bloop\s*\{/.test(wgsl) && !/break/.test(wgsl)) {
    throw new Error(`<${name}>: unbounded loop detected (073 guardrail)`);
  }
  // WGSL RESERVED WORDS used as identifiers. Twice now the browser compiler has been the first thing to
  // catch one — `meta` (the B2 vertex attribute) and `from` (a light-pool parameter) — because naga's
  // guardrails don't look for them and neither did we. A declared name is enough to check: WGSL reserves
  // these outright, so `let`/`var`/parameter/attribute uses all trip the same error.
  const declared = [
    ...wgsl.matchAll(
      /(?:let|var|const)\s+([A-Za-z_]\w*)|(\w+)\s*:\s*(?:vec|mat|f32|u32|i32|bool|array|texture|sampler|ptr)/g,
    ),
  ];
  for (const match of declared) {
    const identifier = match[1] ?? match[2];
    if (identifier && WGSL_RESERVED.has(identifier)) {
      throw new Error(`<${name}>: '${identifier}' is a WGSL RESERVED WORD — rename it (the browser is not our linter)`);
    }
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
