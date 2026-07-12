/**
 * The M0 engine facade (plan 074/01): device + enumerated pipelines + texture arrays + cell bundles + ONE
 * MSAA pass (opaque/cutout world, flat sky clear) with per-pass GPU timestamps. Later milestones grow the
 * fixed frame graph (sky/transparent/water/post) — the facade's API stays.
 */
import { configureCanvas, type EngineDevice, initDevice } from './core/device';
import {
  frustumFromViewProj,
  frustumIntersectsSphere,
  type Mat4,
  mat4Identity,
  mat4Invert,
  mat4LookAt,
  mat4Multiply,
  mat4PerspectiveZO,
  type Vec3,
} from './core/math';
import { Resources } from './core/resources';
import { GpuTimers } from './debug/gpu-timers';
import { compileAll, MSAA_SAMPLES, pipelineIdFor, type PipelineSet } from './render/pipelines';
import { CellStore } from './world/cells';
import { TextureArrays } from './world/textures';

const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';

export interface CameraState {
  aspect: number;
  eye: Vec3;
  far: number;
  fovYRad: number;
  near: number;
  target: Vec3;
  up: Vec3;
}

export interface EngineStats {
  cellsTotal: number;
  cellsVisible: number;
  drawsRecorded: number;
  gpuPassMs: number;
  residencyBytes: number;
  submitMs: number;
}

/** Per-frame environment (074/06): drives the world lighting uniforms. All CPU-side arcs live in the host. */
export interface Environment {
  /** Baked AO/skyVis strength on the indirect term (074/07): 0 = off, 1 = raw bake. */
  aoStrength: number;
  /** 0 day → 1 deep night (the prelit blend). */
  dn: number;
  /** Night-emissive glow strength (lit windows / neon self-illuminate; 0 = off). */
  emissiveBoost: number;
  /** Fog full-fog distance (the horizon cut, engine units). */
  fogCutDistance: number;
  /** Height-fog falloff (1/units) — haze hugs the ground. */
  fogHeightK: number;
  /** Floor of the height attenuation (high geometry keeps at least this much fog). */
  fogHeightMin: number;
  /** Fog ramp start distance. */
  fogStartDistance: number;
  /** Game hour 0..24 — gates the timed objectTable draws (074/06 row 9). */
  hour: number;
  /** LINEAR sky gradient horizon colour (sky pass + world fog share it). */
  skyHorizon: readonly [number, number, number];
  /** LINEAR sky gradient zenith colour. */
  skyTop: readonly [number, number, number];
  /** Sun colour, linear 0..1. */
  sunColor: readonly [number, number, number];
  /** Unit direction TOWARDS the sun (engine space). */
  sunDir: readonly [number, number, number];
  /** Direct sun scale (the N·L term). */
  sunDirect: number;
  /** Indirect (prelit) scale. */
  sunIndirect: number;
  /** Baked sun-shadow strength on the direct term (074/07): 0 = off, 1 = raw bake. */
  sunVisStrength: number;
  /** Wind multiplier on the baked sway amplitudes (074/06 row 10): 0 = still air, 1 = baked metres. */
  windStrength: number;
}

export class Engine {
  cells!: CellStore;
  /** Live environment — host mutates freely; written into the frame UBO every frame. Noon defaults. */
  readonly environment: Environment = {
    // Modest by default: SA prelit already carries baked darkening — full-strength AO double-darkens.
    aoStrength: 0.6,
    dn: 0,
    emissiveBoost: 1.6,
    fogCutDistance: 2400,
    fogHeightK: 1 / 180,
    fogHeightMin: 0.35,
    fogStartDistance: 250,
    hour: 12,
    skyHorizon: [0.42, 0.55, 0.72],
    skyTop: [0.12, 0.32, 0.65],
    sunColor: [1, 0.96, 0.88],
    sunDir: [0.35, 0.85, 0.25],
    sunDirect: 0.9,
    sunIndirect: 0.75,
    sunVisStrength: 1,
    windStrength: 1,
  };

  /** Flat sky clear (M0 stand-in for the sky pass). LINEAR values — the sRGB target encodes on write. */
  skyColor: GPUColor = { a: 1, b: 0.71, g: 0.46, r: 0.24 };

  textures!: TextureArrays;

  get adapterInfo(): string {
    return this.engineDevice.adapterInfo;
  }
  get device(): GPUDevice {
    return this.engineDevice.device;
  }
  private canvasContext!: GPUCanvasContext;
  private depthView!: GPUTextureView;
  private engineDevice!: EngineDevice;
  private frameBindGroup!: GPUBindGroup;
  private frameUniform!: GPUBuffer;
  private readonly frustumPlanes = new Float32Array(24);
  private readonly invViewProj: Mat4 = mat4Identity();
  private msaaView!: GPUTextureView;
  private pipelines!: PipelineSet;
  private readonly proj: Mat4 = mat4Identity();
  private resources!: Resources;
  private readonly startedMs = performance.now();
  private readonly statsValue: EngineStats = {
    cellsTotal: 0,
    cellsVisible: 0,
    drawsRecorded: 0,
    gpuPassMs: 0,
    residencyBytes: 0,
    submitMs: 0,
  };
  private targetSize = { height: 0, width: 0 };
  private timers!: GpuTimers;

  private readonly view: Mat4 = mat4Identity();

  private readonly viewProj: Mat4 = mat4Identity();

  /** Render one frame. Returns the stats snapshot (the HUD's input). */
  frame(camera: CameraState): EngineStats {
    const submitStart = performance.now();
    const canvasTexture = this.canvasContext.getCurrentTexture();
    this.ensureTargets(canvasTexture.width, canvasTexture.height);

    mat4PerspectiveZO(this.proj, camera.fovYRad, camera.aspect, camera.near, camera.far);
    mat4LookAt(this.view, camera.eye, camera.target, camera.up);
    mat4Multiply(this.viewProj, this.proj, this.view);
    mat4Invert(this.invViewProj, this.viewProj);
    const frameData = new Float32Array(64);
    frameData.set(this.viewProj, 0);
    frameData.set(this.invViewProj, 16);
    frameData.set([...camera.eye, 1], 32);
    const env = this.environment;
    const sunLen = Math.hypot(env.sunDir[0], env.sunDir[1], env.sunDir[2]) || 1;
    frameData.set([env.sunDir[0] / sunLen, env.sunDir[1] / sunLen, env.sunDir[2] / sunLen, 0], 36);
    frameData.set([...env.sunColor, 1], 40);
    frameData.set([env.dn, env.sunIndirect, env.sunDirect, env.emissiveBoost], 44);
    frameData.set([...env.skyTop, 1], 48);
    frameData.set([...env.skyHorizon, 1], 52);
    frameData.set([env.fogCutDistance, env.fogStartDistance, env.fogHeightK, env.fogHeightMin], 56);
    frameData.set(
      [env.aoStrength, env.sunVisStrength, (performance.now() - this.startedMs) / 1000, env.windStrength],
      60,
    );
    this.device.queue.writeBuffer(this.frameUniform, 0, frameData);

    frustumFromViewProj(this.frustumPlanes, this.viewProj);
    const bundles: GPURenderBundle[] = [];
    let draws = 0;
    let total = 0;
    for (const cell of this.cells.all()) {
      total += 1;
      cell.visible = frustumIntersectsSphere(
        this.frustumPlanes,
        cell.bounds[0],
        cell.bounds[1],
        cell.bounds[2],
        cell.bounds[3],
      );
      if (cell.visible) {
        bundles.push(cell.bundle);
        draws += cell.draws;
      }
    }

    const encoder = this.device.createCommandEncoder({ label: 'frame' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          clearValue: this.skyColor,
          loadOp: 'clear',
          resolveTarget: canvasTexture.createView({ format: this.engineDevice.colorFormat }),
          storeOp: 'discard',
          view: this.msaaView,
        },
      ],
      depthStencilAttachment: {
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
        view: this.depthView,
      },
      label: 'world',
      ...this.timers.passTimestampWrites(),
    });
    if (bundles.length > 0) {
      pass.executeBundles(bundles);
    }
    // ObjectTable draws (074/06 row 9): hour-gated timed objects of visible cells, outside the bundles.
    draws += this.drawObjects(pass);
    // Sky AFTER the world: depth-test less-equal at far depth touches only background pixels (074/06 row 4).
    pass.setPipeline(this.pipelines.get('sky'));
    pass.setBindGroup(0, this.frameBindGroup);
    pass.draw(3);
    pass.end();
    this.timers.resolve(encoder);
    this.device.queue.submit([encoder.finish()]);
    this.timers.read();

    this.statsValue.submitMs = performance.now() - submitStart;
    this.statsValue.gpuPassMs = this.timers.lastPassMs;
    this.statsValue.cellsTotal = total;
    this.statsValue.cellsVisible = bundles.length;
    this.statsValue.drawsRecorded = draws;
    this.statsValue.residencyBytes = this.resources.totalBytes();

    return this.statsValue;
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.engineDevice = await initDevice();
    this.canvasContext = configureCanvas(canvas, this.engineDevice);
    this.resources = new Resources(this.device);
    this.timers = new GpuTimers(this.device, this.engineDevice.hasTimestamps);
    this.pipelines = compileAll(this.device, this.engineDevice.colorFormat, DEPTH_FORMAT);
    this.frameUniform = this.resources.createBuffer('uniform', {
      label: 'frame',
      size: 256, // viewProj + invViewProj (128) + camera/sun/params/sky×2/fog/params2 (8 × 16) — FULL
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.frameBindGroup = this.device.createBindGroup({
      entries: [{ binding: 0, resource: { buffer: this.frameUniform } }],
      label: 'frame',
      layout: this.pipelines.frameLayout,
    });
    this.textures = new TextureArrays(this.device, this.resources, this.pipelines.materialLayout);
    this.cells = new CellStore({
      colorFormat: this.engineDevice.colorFormat,
      depthFormat: DEPTH_FORMAT,
      device: this.device,
      frameBindGroup: this.frameBindGroup,
      pipelines: this.pipelines,
      resources: this.resources,
      textures: this.textures,
    });
    this.ensureTargets(canvas.width, canvas.height);
  }

  /** Residency ledger passthrough (HUD + leak assertions). */
  ledger(): ReturnType<Resources['ledger']> {
    return this.resources.ledger();
  }

  /** ObjectTable draws for visible cells (074/06 row 9). Timed: render when `hour` is inside [on, off). */
  private drawObjects(pass: GPURenderPassEncoder): number {
    const hour = ((this.environment.hour % 24) + 24) % 24;
    let draws = 0;
    for (const cell of this.cells.all()) {
      if (!cell.visible || cell.objects.length === 0) {
        continue;
      }
      let bound = false;
      for (const object of cell.objects) {
        if (object.kind !== 0 || !timedActive(object.params, hour)) {
          continue;
        }
        if (!bound) {
          pass.setBindGroup(0, this.frameBindGroup);
          pass.setBindGroup(1, cell.cellBindGroup);
          pass.setVertexBuffer(0, cell.vertexBuffer);
          pass.setIndexBuffer(cell.indexBuffer, cell.index16 ? 'uint16' : 'uint32');
          bound = true;
        }
        for (const group of object.groups) {
          pass.setPipeline(this.pipelines.get(pipelineIdFor(group.pipelineClass, group.side)));
          pass.setBindGroup(2, this.textures.get(group.textureArrayRef).bindGroup);
          pass.drawIndexed(group.indexCount, 1, group.indexOffset, 0, 0);
          draws += 1;
        }
      }
    }

    return draws;
  }

  private ensureTargets(width: number, height: number): void {
    if (this.targetSize.width === width && this.targetSize.height === height) {
      return;
    }
    this.targetSize = { height, width };
    const bytes = width * height * (4 + 4) * MSAA_SAMPLES; // color + depth estimate
    const msaa = this.resources.createTexture(
      'target',
      {
        format: this.engineDevice.colorFormat,
        label: 'msaa-color',
        sampleCount: MSAA_SAMPLES,
        size: { height, width },
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      },
      bytes / 2,
    );
    const depth = this.resources.createTexture(
      'target',
      {
        format: DEPTH_FORMAT,
        label: 'msaa-depth',
        sampleCount: MSAA_SAMPLES,
        size: { height, width },
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      },
      bytes / 2,
    );
    this.msaaView = msaa.createView();
    this.depthView = depth.createView();
  }
}

/** SA timed-object gate: params = on | off << 8; the window wraps midnight when on > off. */
function timedActive(params: number, hour: number): boolean {
  const on = params & 0xff;
  const off = (params >> 8) & 0xff;

  return on < off ? hour >= on && hour < off : hour >= on || hour < off;
}
