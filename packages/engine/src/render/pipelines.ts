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

/** The SCENE render target format (074/09 stage 1): the world/sky/entities render into a linear 16-float
 *  offscreen so the sun's HDR overshoot survives for the godrays bright-pass; the post pipeline composites
 *  into the sRGB swapchain view. */
export const SCENE_FORMAT: GPUTextureFormat = 'rgba16float';

export type PipelineId =
  | 'corona'
  | 'debris'
  | 'particle-add'
  | 'particle-blend'
  | 'ped'
  | 'post'
  | 'rigid-blend'
  | 'rigid-opaque'
  | 'sky'
  | 'water'
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
  /** group(1) of the debris pipeline: the break's uniform + its shard texture ARRAY + sampler (B7·a). */
  debrisLayout: GPUBindGroupLayout;
  /** group(0): per-frame uniform. */
  frameLayout: GPUBindGroupLayout;
  get(id: PipelineId): GPURenderPipeline;
  /** group(2): texture array + sampler. */
  materialLayout: GPUBindGroupLayout;
  /** group(1) of the particle pipelines: system params (storage) + the FX sprite ARRAY + sampler (B6). */
  particleLayout: GPUBindGroupLayout;
  /** group(1) of the ped pipeline: matrix storage (model + bone palette) + texture + sampler (074/08 B1). */
  pedLayout: GPUBindGroupLayout;
  /** group(0) of the post pipeline: post uniform + scene texture + sampler (godrays, 074/09 stage 1). */
  postLayout: GPUBindGroupLayout;
  /** group(1) of the rigid-entity pipelines: part matrices + texture ARRAY + sampler (074/08 B2). */
  rigidLayout: GPUBindGroupLayout;
  /** group(1) of the water pipeline: the ripple texture + sampler (074/06 row 12 v1). */
  waterLayout: GPUBindGroupLayout;
}

export function compileAll(
  device: GPUDevice,
  colorFormat: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
  outputFormat: GPUTextureFormat = colorFormat,
): PipelineSet {
  const frameLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, buffer: { type: 'uniform' }, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT },
      // PBR sky LUT (074/06 row 4): sampled by the sky pass AND the world fog (the 068 invariant).
      { binding: 1, texture: {}, visibility: GPUShaderStage.FRAGMENT },
      { binding: 2, sampler: {}, visibility: GPUShaderStage.FRAGMENT },
      // Local light pool (074/06 row 7): world samples it in the VERTEX stage, dynamics per pixel.
      {
        binding: 3,
        buffer: { type: 'read-only-storage' },
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      },
      // Cloud dome layer (074/06 row 15): per-weather panoramas sampled by fsSky over the Preetham LUT.
      // Two slots — weather changes write the idle one and camera.w crossfades between them.
      { binding: 4, texture: {}, visibility: GPUShaderStage.FRAGMENT },
      { binding: 5, texture: {}, visibility: GPUShaderStage.FRAGMENT },
      // SA corona sprites (particle.txd): layer 0 = coronastar (lamps/headlights), layer 1 = coronamoon.
      // Created ONCE at init and written in place — the frame bind group is recorded inside cell bundles and
      // is immutable (the row-15 lesson: never destroy or rebuild anything a bundle references).
      { binding: 6, texture: { viewDimension: '2d-array' }, visibility: GPUShaderStage.FRAGMENT },
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
    { blend: false, cull: 'back', cutout: true, entry: 'fsWorldCutout', id: 'world-cutout-front' },
    { blend: false, cull: 'none', cutout: true, entry: 'fsWorldCutout', id: 'world-cutout-double' },
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
  // Water v1 (074/06 row 12): frame group + the ripple texture; one big translucent surface drawn after
  // the sky, before the blend bundles (foliage/glass then sort over it; depth READ hides it under land).
  const waterLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, texture: {}, visibility: GPUShaderStage.FRAGMENT },
      { binding: 1, sampler: {}, visibility: GPUShaderStage.FRAGMENT },
      { binding: 2, texture: {}, visibility: GPUShaderStage.FRAGMENT },
    ],
    label: 'water',
  });
  const waterModule = device.createShaderModule({ code: resolveShader('water'), label: 'water' });
  pipelines.set(
    'water',
    device.createRenderPipeline({
      depthStencil: { depthCompare: 'greater', depthWriteEnabled: false, format: depthFormat },
      fragment: {
        entryPoint: 'fsWater',
        module: waterModule,
        targets: [{ blend: premultBlend, format: colorFormat }],
      },
      label: 'water',
      layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, waterLayout], label: 'water' }),
      multisample: { count: MSAA_SAMPLES },
      primitive: { cullMode: 'none', topology: 'triangle-list' },
      vertex: {
        // Stride 20: engine-space position + baked shore distance (074/06 row 12 v2) + water class (plan 075:
        // 0 = sea, 1 = inland — inland renders calm so pools don't spill their waves).
        buffers: [
          {
            arrayStride: 20,
            attributes: [
              { format: 'float32x3', offset: 0, shaderLocation: 0 },
              { format: 'float32', offset: 12, shaderLocation: 1 },
              { format: 'float32', offset: 16, shaderLocation: 2 },
            ],
          },
        ],
        entryPoint: 'vsWater',
        module: waterModule,
      },
    }),
  );
  // Skinning probe (074/08 B1): storage palette + 4-bone blend; separate tight attribute buffers (the
  // dynamics vertex layout is NOT the .oscell layout — that consequence is exactly what the probe freezes).
  const pedLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, buffer: { type: 'read-only-storage' }, visibility: GPUShaderStage.VERTEX },
      { binding: 1, texture: {}, visibility: GPUShaderStage.FRAGMENT },
      { binding: 2, sampler: {}, visibility: GPUShaderStage.FRAGMENT },
    ],
    label: 'ped',
  });
  // Rigid dynamics (074/08 B2): part matrices in storage, texture ARRAY (vehicle TXD layers), opaque +
  // premultiplied-glass variants. Vertex layout family #3 (pos/normal/uv/color/meta tight buffers).
  const rigidLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, buffer: { type: 'read-only-storage' }, visibility: GPUShaderStage.VERTEX },
      { binding: 1, texture: { viewDimension: '2d-array' }, visibility: GPUShaderStage.FRAGMENT },
      { binding: 2, sampler: {}, visibility: GPUShaderStage.FRAGMENT },
      // Per-instance carcols paint (074/08 B5) — 4 colours per matrix row.
      { binding: 3, buffer: { type: 'read-only-storage' }, visibility: GPUShaderStage.VERTEX },
      // Per-instance lamp state (074/08 B5 step 5) — headlights + brakes, one vec4 per matrix row.
      {
        binding: 4,
        buffer: { type: 'read-only-storage' },
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      },
    ],
    label: 'rigid',
  });
  const rigidModule = device.createShaderModule({ code: resolveShader('rigid'), label: 'rigid' });
  const rigidPipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [frameLayout, rigidLayout],
    label: 'rigid',
  });
  const rigidBuffers: GPUVertexBufferLayout[] = [
    { arrayStride: 12, attributes: [{ format: 'float32x3', offset: 0, shaderLocation: 0 }] },
    { arrayStride: 12, attributes: [{ format: 'float32x3', offset: 0, shaderLocation: 1 }] },
    { arrayStride: 8, attributes: [{ format: 'float32x2', offset: 0, shaderLocation: 2 }] },
    { arrayStride: 4, attributes: [{ format: 'unorm8x4', offset: 0, shaderLocation: 3 }] },
    { arrayStride: 4, attributes: [{ format: 'uint8x4', offset: 0, shaderLocation: 4 }] },
    // Reflection slots (B5r): env layer + coefficient + intensity + specular level, all from the DFF.
    { arrayStride: 4, attributes: [{ format: 'uint8x4', offset: 0, shaderLocation: 5 }] },
  ];
  for (const variant of [
    { blend: false, entry: 'fsRigid', id: 'rigid-opaque' as const },
    { blend: true, entry: 'fsRigidBlend', id: 'rigid-blend' as const },
  ]) {
    pipelines.set(
      variant.id,
      device.createRenderPipeline({
        depthStencil: {
          depthCompare: variant.blend ? 'greater-equal' : 'greater',
          depthWriteEnabled: !variant.blend,
          format: depthFormat,
        },
        fragment: {
          entryPoint: variant.entry,
          module: rigidModule,
          targets: [
            {
              format: colorFormat,
              ...(variant.blend
                ? {
                    blend: {
                      alpha: { dstFactor: 'one-minus-src-alpha', operation: 'add', srcFactor: 'one' },
                      color: { dstFactor: 'one-minus-src-alpha', operation: 'add', srcFactor: 'one' },
                    } satisfies GPUBlendState,
                  }
                : {}),
            },
          ],
        },
        label: variant.id,
        layout: rigidPipelineLayout,
        multisample: { count: MSAA_SAMPLES },
        // Double-sided: SA vehicle interiors/glass are single-sided shells viewed from both sides.
        primitive: { cullMode: 'none', frontFace: 'ccw', topology: 'triangle-list' },
        vertex: { buffers: rigidBuffers, entryPoint: 'vsRigid', module: rigidModule },
      }),
    );
  }
  const pedModule = device.createShaderModule({ code: resolveShader('ped'), label: 'ped' });
  pipelines.set(
    'ped',
    device.createRenderPipeline({
      depthStencil: { depthCompare: 'greater', depthWriteEnabled: true, format: depthFormat },
      fragment: { entryPoint: 'fsPed', module: pedModule, targets: [{ format: colorFormat }] },
      label: 'ped',
      layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, pedLayout], label: 'ped' }),
      multisample: { count: MSAA_SAMPLES },
      // Double-sided for the probe: SA ped meshes carry single-sided skirts/hair shells.
      primitive: { cullMode: 'none', frontFace: 'ccw', topology: 'triangle-list' },
      vertex: {
        buffers: [
          { arrayStride: 12, attributes: [{ format: 'float32x3', offset: 0, shaderLocation: 0 }] },
          { arrayStride: 12, attributes: [{ format: 'float32x3', offset: 0, shaderLocation: 1 }] },
          { arrayStride: 8, attributes: [{ format: 'float32x2', offset: 0, shaderLocation: 2 }] },
          { arrayStride: 4, attributes: [{ format: 'uint8x4', offset: 0, shaderLocation: 3 }] },
          { arrayStride: 4, attributes: [{ format: 'unorm8x4', offset: 0, shaderLocation: 4 }] },
        ],
        entryPoint: 'vsPed',
        module: pedModule,
      },
    }),
  );
  // 2dfx coronas (074/06 row 13): instanced additive billboards, depth READ (occluders hide them).
  // 2dfx particles (B6): instanced camera-facing sprites whose whole lifecycle runs in the vertex shader.
  // Two blend variants — smoke ALPHA-blends, fire/sparks add — over one shared sprite array.
  const particleLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, buffer: { type: 'read-only-storage' }, visibility: GPUShaderStage.VERTEX },
      { binding: 1, texture: { viewDimension: '2d-array' }, visibility: GPUShaderStage.FRAGMENT },
      { binding: 2, sampler: {}, visibility: GPUShaderStage.FRAGMENT },
    ],
    label: 'particle',
  });
  const particleModule = device.createShaderModule({ code: resolveShader('particle'), label: 'particle' });
  const particleBuffers: GPUVertexBufferLayout[] = [
    { arrayStride: 8, attributes: [{ format: 'float32x2', offset: 0, shaderLocation: 0 }] },
    {
      arrayStride: 36,
      attributes: [
        { format: 'float32x3', offset: 0, shaderLocation: 1 }, // spawn
        { format: 'float32x3', offset: 12, shaderLocation: 2 }, // velocity
        { format: 'float32x3', offset: 24, shaderLocation: 3 }, // life, phase, system
      ],
      stepMode: 'instance',
    },
  ];
  for (const variant of [
    { add: true, id: 'particle-add' as const },
    { add: false, id: 'particle-blend' as const },
  ]) {
    pipelines.set(
      variant.id,
      device.createRenderPipeline({
        depthStencil: { depthCompare: 'greater', depthWriteEnabled: false, format: depthFormat },
        fragment: {
          entryPoint: 'fsParticle',
          module: particleModule,
          targets: [
            {
              blend: variant.add
                ? {
                    alpha: { dstFactor: 'one', operation: 'add', srcFactor: 'one' },
                    color: { dstFactor: 'one', operation: 'add', srcFactor: 'one' },
                  }
                : premultBlend,
              format: colorFormat,
            },
          ],
        },
        label: variant.id,
        layout: device.createPipelineLayout({
          bindGroupLayouts: [frameLayout, particleLayout],
          label: 'particle',
        }),
        multisample: { count: MSAA_SAMPLES },
        primitive: { topology: 'triangle-list' },
        vertex: { buffers: particleBuffers, entryPoint: 'vsParticle', module: particleModule },
      }),
    );
  }

  // Prop debris (B7·a): one draw per break. Every vertex carries its shard's whole flight, so the pass is
  // pure geometry + a 16-byte uniform; the shards are alpha-blended and write no depth (they overlap).
  const debrisLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, buffer: { type: 'uniform' }, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT },
      { binding: 1, texture: { viewDimension: '2d-array' }, visibility: GPUShaderStage.FRAGMENT },
      { binding: 2, sampler: {}, visibility: GPUShaderStage.FRAGMENT },
    ],
    label: 'debris',
  });
  const debrisModule = device.createShaderModule({ code: resolveShader('debris'), label: 'debris' });
  pipelines.set(
    'debris',
    device.createRenderPipeline({
      depthStencil: { depthCompare: 'greater', depthWriteEnabled: false, format: depthFormat },
      fragment: {
        entryPoint: 'fsDebris',
        module: debrisModule,
        targets: [{ blend: premultBlend, format: colorFormat }],
      },
      label: 'debris',
      layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, debrisLayout], label: 'debris' }),
      multisample: { count: MSAA_SAMPLES },
      // Shards are single-sided triangles torn out of a closed mesh — both faces must draw.
      primitive: { cullMode: 'none', topology: 'triangle-list' },
      vertex: {
        buffers: [
          {
            arrayStride: 80,
            attributes: [
              { format: 'float32x3', offset: 0, shaderLocation: 0 }, // position (world, engine space)
              { format: 'float32x2', offset: 12, shaderLocation: 1 }, // uv
              { format: 'float32x4', offset: 20, shaderLocation: 2 }, // colour
              { format: 'float32x3', offset: 36, shaderLocation: 3 }, // shard centroid
              { format: 'float32x3', offset: 48, shaderLocation: 4 }, // velocity
              { format: 'float32x3', offset: 60, shaderLocation: 5 }, // spin axis x speed
              { format: 'float32x2', offset: 72, shaderLocation: 6 }, // land time, texture layer
            ],
          },
        ],
        entryPoint: 'vsDebris',
        module: debrisModule,
      },
    }),
  );

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
  // Godrays post pass (074/09 stage 1, field round 3 — prod parity via postprocessing's GodRaysEffect):
  // fullscreen triangle, radial blur of thresholded scene brightness toward the sun's screen position,
  // composited into the sRGB swapchain. No depth, no MSAA — it reads the RESOLVED scene.
  const postLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, buffer: { type: 'uniform' }, visibility: GPUShaderStage.FRAGMENT },
      { binding: 1, texture: {}, visibility: GPUShaderStage.FRAGMENT },
      { binding: 2, sampler: {}, visibility: GPUShaderStage.FRAGMENT },
    ],
    label: 'post',
  });
  const postModule = device.createShaderModule({ code: resolveShader('post'), label: 'post' });
  pipelines.set(
    'post',
    device.createRenderPipeline({
      fragment: { entryPoint: 'fsPost', module: postModule, targets: [{ format: outputFormat }] },
      label: 'post',
      layout: device.createPipelineLayout({ bindGroupLayouts: [postLayout], label: 'post' }),
      primitive: { topology: 'triangle-list' },
      vertex: { entryPoint: 'vsPost', module: postModule },
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
    debrisLayout,
    frameLayout,
    get(id: PipelineId): GPURenderPipeline {
      const pipeline = pipelines.get(id);
      if (!pipeline) {
        throw new Error(`pipeline miss in steady state: ${id} (074 ground rule 3 — enumerate it in compileAll)`);
      }

      return pipeline;
    },
    materialLayout,
    particleLayout,
    pedLayout,
    postLayout,
    rigidLayout,
    waterLayout,
  };
}

/** `.oscell` group → pipeline id (pipelineClass 0 opaque | 1 cutout | 2 blend | 3 beam; side 0 front | 1 double). */
export function pipelineIdFor(pipelineClass: number, side: number): PipelineId {
  const kind = (['opaque', 'cutout', 'blend', 'beam'] as const)[pipelineClass] ?? 'cutout';

  return `world-${kind}-${side === 1 ? 'double' : 'front'}`;
}
