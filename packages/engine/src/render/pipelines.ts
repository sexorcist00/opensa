/**
 * Pipeline registry (plan 074/01): every pipeline the engine can ever bind is ENUMERATED here and compiled by
 * `compileAll()` behind the load veil. A steady-state miss throws — cold-start compile storms are impossible
 * by design, not unlikely (the 073 lesson as an assertion).
 *
 * M0 set: world opaque/cutout × front/double = 4 pipelines. The cutout pair enables alpha-to-coverage
 * (MSAA 4×) — the third leg of the alpha-edge fix.
 */
import { OSCELL_VERTEX_STRIDE } from '@opensa/engine-formats';

import { resolveShader } from './shaders';

export const MSAA_SAMPLES = 4;

export type PipelineId =
  | 'sky'
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
    entries: [{ binding: 0, buffer: { type: 'uniform' }, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT }],
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
  const variants: { cull: GPUCullMode; cutout: boolean; id: PipelineId }[] = [
    { cull: 'back', cutout: false, id: 'world-opaque-front' },
    { cull: 'none', cutout: false, id: 'world-opaque-double' },
    { cull: 'back', cutout: true, id: 'world-cutout-front' },
    { cull: 'none', cutout: true, id: 'world-cutout-double' },
  ];
  const skyModule = device.createShaderModule({ code: resolveShader('sky'), label: 'sky' });
  const skyLayout = device.createPipelineLayout({ bindGroupLayouts: [frameLayout], label: 'sky' });
  pipelines.set(
    'sky',
    device.createRenderPipeline({
      depthStencil: { depthCompare: 'less-equal', depthWriteEnabled: false, format: depthFormat },
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
        depthStencil: { depthCompare: 'less', depthWriteEnabled: true, format: depthFormat },
        fragment: { entryPoint: 'fsWorld', module, targets: [{ format: colorFormat }] },
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

/** `.oscell` group → pipeline id (pipelineClass 0 opaque | 1 cutout; side 0 front | 1 double). M0 renders
 *  blend/beam classes as cutout placeholders — plan 06 gives them real pipelines. */
export function pipelineIdFor(pipelineClass: number, side: number): PipelineId {
  const cutout = pipelineClass !== 0;

  return `world-${cutout ? 'cutout' : 'opaque'}-${side === 1 ? 'double' : 'front'}`;
}
