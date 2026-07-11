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
  camera: vec4f,
};
@group(0) @binding(0) var<uniform> frame: Frame;
`,
  world: /* wgsl */ `
#include <frame>

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
};

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) dayPrelit: vec4f,
  @location(2) @interpolate(flat) layer: u32,
};

@vertex
fn vsWorld(in: VsIn) -> VsOut {
  var out: VsOut;
  out.clip = frame.viewProj * vec4f(in.position + cell.origin.xyz, 1.0);
  out.uv = in.uv;
  out.dayPrelit = in.dayPrelit;
  out.layer = in.layerChannels.x;
  return out;
}

@fragment
fn fsWorld(in: VsOut) -> @location(0) vec4f {
  // Textures ship PREMULTIPLIED (074/02): filtering is correct by construction, transparent texels
  // contribute nothing — the alpha-edge fix. Alpha feeds coverage on the cutout pipeline (A2C).
  let texel = textureSample(worldTexture, worldSampler, in.uv, in.layer);
  return vec4f(texel.rgb * in.dayPrelit.rgb, texel.a);
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
