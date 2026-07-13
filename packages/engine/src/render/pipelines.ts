/**
 * Pipeline registry (plan 074/01): every pipeline the engine can ever bind is ENUMERATED here and compiled by
 * `compileAll()` behind the load veil. A steady-state miss throws — cold-start compile storms are impossible
 * by design, not unlikely (the 073 lesson as an assertion).
 *
 * World set: opaque/cutout/blend/beam × front/double = 8 pipelines + sky. The cutout pair enables
 * alpha-to-coverage (MSAA 4×) — the third leg of the alpha-edge fix. Blend/beam pipelines blend
 * PREMULTIPLIED output (one, one-minus-src-alpha) with depth READ-ONLY (074/06 rows 9/11).
 */
import { OSCELL_VERTEX_STRIDE } from '@opensa/engine-formats';

import { resolveShader } from './shaders';

export const MSAA_SAMPLES = 4;

export type PipelineId =
  | 'corona'
  | 'sky'
  | 'world-beam-double'
  | 'world-beam-front'
  | 'world-blend-double'
  | 'world-blend-front'
  | 'world-cutout-double'
  | 'world-cutout-front'
  | 'world-opaque-double'
  | 'world-opaque-front';

export interface PipelineSet {
  /** group(1): per-cell uniform (origin). */
  cellLayout: GPUBindGroupLayout;
  /** group(0): per-frame uniform. */
  frameLayout: GPUBindGroupLayout;
  get(id: PipelineId): GPURenderPipeline;
  /** group(2): texture array + sampler. */
  materialLayout: GPUBindGroupLayout;
}

export function compileAll(
  device: GPUDevice,
  colorFormat: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
): PipelineSet {
  const frameLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, buffer: { type: 'uniform' }, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT },
      // PBR sky LUT (074/06 row 4): sampled by the sky pass AND the world fog (the 068 invariant).
      { binding: 1, texture: {}, visibility: GPUShaderStage.FRAGMENT },
      { binding: 2, sampler: {}, visibility: GPUShaderStage.FRAGMENT },
    ],
    label: 'frame',
  });
  const cellLayout = device.createBindGroupLayout({
    entries: [{ binding: 0, buffer: { type: 'uniform' }, visibility: GPUShaderStage.VERTEX }],
    label: 'cell',
  });
  const materialLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, texture: { viewDimension: '2d-array' }, visibility: GPUShaderStage.FRAGMENT },
      { binding: 1, sampler: {}, visibility: GPUShaderStage.FRAGMENT },
    ],
    label: 'material',
  });
  const layout = device.createPipelineLayout({
    bindGroupLayouts: [frameLayout, cellLayout, materialLayout],
    label: 'world',
  });
  const module = device.createShaderModule({ code: resolveShader('world'), label: 'world' });
  const vertexBuffers: GPUVertexBufferLayout[] = [
    {
      arrayStride: OSCELL_VERTEX_STRIDE,
      attributes: [
        { format: 'float32x3', offset: 0, shaderLocation: 0 }, // position
        { format: 'float32x2', offset: 16, shaderLocation: 1 }, // uv
        { format: 'unorm8x4', offset: 24, shaderLocation: 2 }, // dayPrelit
        { format: 'uint16x2', offset: 32, shaderLocation: 3 }, // layer + packed channels
        { format: 'snorm8x4', offset: 12, shaderLocation: 4 }, // normal (sun N·L — 074/06)
        { format: 'unorm8x4', offset: 28, shaderLocation: 5 }, // nightPrelit + sway alpha
      ],
    },
  ];

  const pipelines = new Map<PipelineId, GPURenderPipeline>();
  const variants: { blend: boolean; cull: GPUCullMode; cutout: boolean; entry: string; id: PipelineId }[] = [
    { blend: false, cull: 'back', cutout: false, entry: 'fsWorld', id: 'world-opaque-front' },
    { blend: false, cull: 'none', cutout: false, entry: 'fsWorld', id: 'world-opaque-double' },
    { blend: false, cull: 'back', cutout: true, entry: 'fsWorld', id: 'world-cutout-front' },
    { blend: false, cull: 'none', cutout: true, entry: 'fsWorld', id: 'world-cutout-double' },
    { blend: true, cull: 'back', cutout: false, entry: 'fsWorld', id: 'world-blend-front' },
    { blend: true, cull: 'none', cutout: false, entry: 'fsWorld', id: 'world-blend-double' },
    { blend: true, cull: 'back', cutout: false, entry: 'fsBeam', id: 'world-beam-front' },
    { blend: true, cull: 'none', cutout: false, entry: 'fsBeam', id: 'world-beam-double' },
  ];
  // Premultiplied-alpha compositing (textures ship premultiplied; fsBeam premultiplies the cone).
  const premultBlend: GPUBlendState = {
    alpha: { dstFactor: 'one-minus-src-alpha', operation: 'add', srcFactor: 'one' },
    color: { dstFactor: 'one-minus-src-alpha', operation: 'add', srcFactor: 'one' },
  };
  const skyModule = device.createShaderModule({ code: resolveShader('sky'), label: 'sky' });
  const skyLayout = device.createPipelineLayout({ bindGroupLayouts: [frameLayout], label: 'sky' });
  // 2dfx coronas (074/06 row 13): instanced additive billboards, depth READ (occluders hide them).
  const coronaModule = device.createShaderModule({ code: resolveShader('corona'), label: 'corona' });
  pipelines.set(
    'corona',
    device.createRenderPipeline({
      // Reversed-Z everywhere (z-fighting fix): float depth, clear 0, GREATER passes nearer fragments.
      depthStencil: { depthCompare: 'greater', depthWriteEnabled: false, format: depthFormat },
      fragment: {
        entryPoint: 'fsCorona',
        module: coronaModule,
        targets: [
          {
            blend: {
              alpha: { dstFactor: 'one', operation: 'add', srcFactor: 'one' },
              color: { dstFactor: 'one', operation: 'add', srcFactor: 'one' },
            },
            format: colorFormat,
          },
        ],
      },
      label: 'corona',
      layout: skyLayout,
      multisample: { count: MSAA_SAMPLES },
      primitive: { topology: 'triangle-list' },
      vertex: {
        buffers: [
          {
            arrayStride: 8,
            attributes: [{ format: 'float32x2', offset: 0, shaderLocation: 0 }],
          },
          {
            arrayStride: 32,
            attributes: [
              { format: 'float32x3', offset: 0, shaderLocation: 1 },
              { format: 'float32', offset: 12, shaderLocation: 2 },
              { format: 'float32x4', offset: 16, shaderLocation: 3 },
            ],
            stepMode: 'instance',
          },
        ],
        entryPoint: 'vsCorona',
        module: coronaModule,
      },
    }),
  );
  pipelines.set(
    'sky',
    device.createRenderPipeline({
      // Reversed-Z far plane (depth 0). The sky draws FIRST in the frame (vs the cleared buffer): blended
      // classes write no depth, so a late sky would repaint them wherever their background is sky.
      depthStencil: { depthCompare: 'greater-equal', depthWriteEnabled: false, format: depthFormat },
      fragment: { entryPoint: 'fsSky', module: skyModule, targets: [{ format: colorFormat }] },
      label: 'sky',
      layout: skyLayout,
      multisample: { count: MSAA_SAMPLES },
      primitive: { topology: 'triangle-list' },
      vertex: { entryPoint: 'vsSky', module: skyModule },
    }),
  );
  for (const variant of variants) {
    pipelines.set(
      variant.id,
      device.createRenderPipeline({
        // Reversed-Z: GREATER for depth-written classes; blended classes read-only AND pass EQUAL depths —
        // coplanar overlays (night windows, wall signs) composite stably instead of shimmering.
        depthStencil: {
          depthCompare: variant.blend ? 'greater-equal' : 'greater',
          depthWriteEnabled: !variant.blend,
          format: depthFormat,
        },
        fragment: {
          entryPoint: variant.entry,
          module,
          targets: [{ format: colorFormat, ...(variant.blend ? { blend: premultBlend } : {}) }],
        },
        label: variant.id,
        layout,
        multisample: { alphaToCoverageEnabled: variant.cutout, count: MSAA_SAMPLES },
        primitive: { cullMode: variant.cull, frontFace: 'ccw', topology: 'triangle-list' },
        vertex: { buffers: vertexBuffers, entryPoint: 'vsWorld', module },
      }),
    );
  }

  return {
    cellLayout,
    frameLayout,
    get(id: PipelineId): GPURenderPipeline {
      const pipeline = pipelines.get(id);
      if (!pipeline) {
        throw new Error(`pipeline miss in steady state: ${id} (074 ground rule 3 — enumerate it in compileAll)`);
      }

      return pipeline;
    },
    materialLayout,
  };
}

/** `.oscell` group → pipeline id (pipelineClass 0 opaque | 1 cutout | 2 blend | 3 beam; side 0 front | 1 double). */
export function pipelineIdFor(pipelineClass: number, side: number): PipelineId {
  const kind = (['opaque', 'cutout', 'blend', 'beam'] as const)[pipelineClass] ?? 'cutout';

  return `world-${kind}-${side === 1 ? 'double' : 'front'}`;
}
