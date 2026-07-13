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
import { RigidEntity, type RigidPartInit } from './entities/rigid';
import { compileAll, MSAA_SAMPLES, pipelineIdFor, type PipelineSet, SCENE_FORMAT } from './render/pipelines';
import { buildSkyLut, SKY_LUT_HEIGHT, SKY_LUT_WIDTH, skyLutKey } from './render/sky-lut';
import { CellStore } from './world/cells';
import { TextureArrays } from './world/textures';

// Reversed-Z (z-fighting fix): FLOAT depth + swapped near/far + clear 0 + greater compares — hugely
// better far-field precision (SA signs sit centimetres off walls hundreds of metres from the camera).
const DEPTH_FORMAT: GPUTextureFormat = 'depth32float';
/** Corona instance cap per frame (074/06 row 13) — far beyond any district's lamp count. */
const CORONA_CAP = 2048;
/** Cloud dome side (074/06 row 15) — the converter emits exactly this; the texture never reallocates. */
const CLOUD_DOME_SIZE = 1024;
/** timecyc `sunSize` (≈3–5) → angular core radius in radians (~1° at sunSize 4, prod-matched by eye). */
const SUN_SIZE_TO_RAD = 0.0045;
/** Godrays (074/09 stage 1): ray strength, per-tap decay, and the bright-pass floor (the sun disc's HDR
 *  overshoot sits at 3–6; lit world pixels stay under ~1.2, so they never feed rays). */
const GODRAY_INTENSITY = 0.9;
const GODRAY_DECAY = 0.93;
const GODRAY_THRESHOLD = 1.25;

export interface CameraState {
  aspect: number;
  eye: Vec3;
  far: number;
  fovYRad: number;
  near: number;
  target: Vec3;
  up: Vec3;
}

/** One CPU-side local light (074/06 row 7); hosts push these into `Engine.dynamicLights` each frame. */
export interface DynamicLight {
  /** Linear RGB × intensity. */
  color: readonly [number, number, number];
  position: readonly [number, number, number];
  radius: number;
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
  /** Cloud dome layer alpha 0..1 (how strongly the panorama composites; the textures carry the look). */
  cloudAlpha: number;
  /** Cloud cover 0..1 — the LUT haze driver, fed per weather (cloud-profile port); NOT the layer alpha. */
  cloudCover: number;
  /** Cloud heaviness 0..1 (storm/fog weathers). */
  cloudDark: number;
  /** Weather-change crossfade duration, seconds (dome slot A→B blend). */
  cloudFadeSeconds: number;
  /** Cloud dome rotation speed (rad/s on the frame clock — SA's slow wind drift). */
  cloudSpeed: number;
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
  /** Godrays post-pass strength multiplier (0 = off — the config toggle; 1 = default). */
  godrayStrength: number;
  /** Game hour 0..24 — gates the timed objectTable draws (074/06 row 9). */
  hour: number;
  /** Moonlight colour, linear (BLACK by day — the host arc gates it). */
  moonColor: readonly [number, number, number];
  /** Unit direction TOWARDS the moon (engine space). */
  moonDir: readonly [number, number, number];
  /** LINEAR sky gradient horizon colour (sky pass + world fog share it). */
  skyHorizon: readonly [number, number, number];
  /** SA mood strength: how strongly timecyc's skyTop tints the physical sky (0 = pure Preetham). */
  skyMood: number;
  /** LINEAR sky gradient zenith colour. */
  skyTop: readonly [number, number, number];
  /** Stochastic de-tiling toggle (074/12): 0 = plain sampling (DEFAULT — field issues pending the
   *  histogram-preserving pass; see plan 12), 1 = 3-tap blend on flagged layers. */
  stochastic: number;
  /** Sun LIGHT colour, linear 0..1 (the N·L term — near-white; the visible disc uses sunCoreColor). */
  sunColor: readonly [number, number, number];
  /** Sun DISC core colour, linear (timecyc `sunCore` — yellow/orange; hosts gate to black at night). */
  sunCoreColor: readonly [number, number, number];
  /** Sun corona/glow colour, linear (timecyc `sunCorona` — the warm halo + godray tint). */
  sunCoronaColor: readonly [number, number, number];
  /** Unit direction TOWARDS the sun (engine space). */
  sunDir: readonly [number, number, number];
  /** Direct sun scale (the N·L term). */
  sunDirect: number;
  /** Current day-arc elevation 0..1 (the sun-vis v2 threshold input — 074/07). */
  sunElevation: number;
  /** Indirect (prelit) scale. */
  sunIndirect: number;
  /** timecyc `sunSize` (≈3–5) — scales the visible disc's angular radius. */
  sunSize: number;
  /** Baked sun-shadow strength on the direct term (074/07): 0 = off, 1 = raw bake. */
  sunVisStrength: number;
  /** Wind multiplier on the baked sway amplitudes (074/06 row 10): 0 = still air, 1 = baked metres. */
  windStrength: number;
}

/** Live probe handle: write the palette ([model, bone 0, …], column-major), then `updatePedPalette()`. */
export interface PedProbe {
  palette: Float32Array;
}

/** Skinning-probe upload (074/08 B1) — raw byte views over the probe fixture's bin sections. */
export interface PedProbeInit {
  boneCount: number;
  indexCount: number;
  /** uint16 index payload. */
  indices: Uint8Array;
  joints: Uint8Array;
  normals: Uint8Array;
  positions: Uint8Array;
  submeshes: readonly { indexCount: number; indexOffset: number }[];
  texture: { height: number; rgba: Uint8Array; width: number };
  uvs: Uint8Array;
  weights: Uint8Array;
}

/** Rigid-entity upload (074/08 B2) — raw byte views over the vehicle fixture's bin sections. */
export interface VehicleProbeInit {
  colors: Uint8Array;
  indexCount: number;
  /** uint16 index payload. */
  indices: Uint8Array;
  meta: Uint8Array;
  normals: Uint8Array;
  parts: readonly RigidPartInit[];
  positions: Uint8Array;
  submeshes: readonly { indexCount: number; indexOffset: number; part: number; translucent: boolean }[];
  /** RGBA8 layers, all the same size, packed sequentially. */
  texture: { height: number; layers: number; rgba: Uint8Array; width: number };
  uvs: Uint8Array;
  vertexCount: number;
}

/** Light-pool capacity (074/06 row 7) — mirrored by the WGSL loop bound. */
const LIGHT_POOL_CAP = 64;
/** 2dfx lamps farther than this never enter the pool (pixel reach is bounded by the radius anyway). */
const LIGHT_POOL_REACH = 130;

export class Engine {
  cells!: CellStore;
  /** Host-owned dynamic lights (vehicle head/taillights …) — replace the contents each frame. */
  readonly dynamicLights: DynamicLight[] = [];
  /** Live environment — host mutates freely; written into the frame UBO every frame. Noon defaults. */
  readonly environment: Environment = {
    // Modest by default: SA prelit already carries baked darkening — full-strength AO double-darkens.
    aoStrength: 0.6,
    cloudAlpha: 0.9,
    cloudCover: 0.12,
    cloudDark: 0,
    cloudFadeSeconds: 4,
    cloudSpeed: 0.004,
    dn: 0,
    emissiveBoost: 1.6,
    fogCutDistance: 2400,
    fogHeightK: 1 / 180,
    fogHeightMin: 0.35,
    fogStartDistance: 250,
    godrayStrength: 1,
    hour: 12,
    moonColor: [0, 0, 0],
    moonDir: [-0.3, 0.8, -0.25],
    skyHorizon: [0.42, 0.55, 0.72],
    skyMood: 0.7,
    skyTop: [0.12, 0.32, 0.65],
    stochastic: 0,
    sunColor: [1, 0.96, 0.88],
    sunCoreColor: [1, 0.95, 0.68],
    sunCoronaColor: [1, 0.8, 0.4],
    sunDir: [0.35, 0.85, 0.25],
    sunDirect: 0.9,
    sunElevation: 1,
    sunIndirect: 0.75,
    sunSize: 4,
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
  /** Crossfade state: blend 0 = slot A shows, 1 = slot B; animated from `cloudFadeFrom` toward
   *  `cloudFadeTarget` on the frame clock over env.cloudFadeSeconds. */
  private cloudFadeFrom = 0;
  private cloudFadeStartMs = 0;
  private cloudFadeTarget = 0;
  private cloudLayerOn = 0;
  /** Both slots allocated ONCE at CLOUD_DOME_SIZE² and only ever written in place — the frame bind group
   *  is recorded inside cell bundles and must stay immutable after init. */
  private cloudTextureA: GPUTexture | null = null;
  private cloudTextureB: GPUTexture | null = null;
  private coronaInstances!: GPUBuffer;
  private coronaQuad!: GPUBuffer;
  private readonly coronaScratch = new Float32Array(CORONA_CAP * 8);
  private depthView!: GPUTextureView;
  private engineDevice!: EngineDevice;
  private frameBindGroup!: GPUBindGroup;
  private frameUniform!: GPUBuffer;
  private readonly frustumPlanes = new Float32Array(24);
  private readonly invViewProj: Mat4 = mat4Identity();
  private lightPoolBuffer!: GPUBuffer;
  private readonly lightPoolScratch = new Float32Array(LIGHT_POOL_CAP * 8);
  private msaaView!: GPUTextureView;
  /** Skinning probe (074/08 B1) — a single skinned entity outside the static bundles. */
  private ped: null | {
    bindGroup: GPUBindGroup;
    buffers: GPUBuffer[];
    indexBuffer: GPUBuffer;
    palette: Float32Array;
    paletteBuffer: GPUBuffer;
    submeshes: readonly { indexCount: number; indexOffset: number }[];
  } = null;
  private pedTexture: GPUTexture | null = null;
  private pedTextureBytes = 0;
  private pipelines!: PipelineSet;
  /** Resolved scene (16f) + the godrays composite resources (074/09 stage 1); bind group is rebuilt on
   *  resize — it is NOT referenced by any bundle, so this is safe (unlike the frame bind group). */
  private postBindGroup!: GPUBindGroup;
  private postSampler!: GPUSampler;
  private postUniform!: GPUBuffer;
  private readonly proj: Mat4 = mat4Identity();
  private resources!: Resources;
  private sceneColorView!: GPUTextureView;
  private skyLutCurrentKey = '';
  private skyLutTexture!: GPUTexture;
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
  /** Rigid-entity probe (074/08 B2) — one vehicle-style part hierarchy outside the static bundles. */
  private vehicle: null | {
    bindGroup: GPUBindGroup;
    buffers: GPUBuffer[];
    entity: RigidEntity;
    indexBuffer: GPUBuffer;
    matrixBuffer: GPUBuffer;
    submeshes: readonly { indexCount: number; indexOffset: number; part: number; translucent: boolean }[];
    texture: GPUTexture;
    textureBytes: number;
  } = null;

  private readonly view: Mat4 = mat4Identity();

  private readonly viewProj: Mat4 = mat4Identity();

  /** Render one frame. Returns the stats snapshot (the HUD's input). */
  frame(camera: CameraState): EngineStats {
    const submitStart = performance.now();
    const canvasTexture = this.canvasContext.getCurrentTexture();
    this.ensureTargets(canvasTexture.width, canvasTexture.height);

    // Swapped near/far = the reversed-Z projection (near maps to depth 1, far to 0).
    mat4PerspectiveZO(this.proj, camera.fovYRad, camera.aspect, camera.far, camera.near);
    mat4LookAt(this.view, camera.eye, camera.target, camera.up);
    mat4Multiply(this.viewProj, this.proj, this.view);
    mat4Invert(this.invViewProj, this.viewProj);
    const frameData = new Float32Array(84);
    frameData.set(this.viewProj, 0);
    frameData.set(this.invViewProj, 16);
    // camera.w = cloud slot A→B crossfade blend (spare vec4 slot; row 15 weather fade).
    frameData.set([...camera.eye, this.currentCloudBlend()], 32);
    const env = this.environment;
    const sunLen = Math.hypot(env.sunDir[0], env.sunDir[1], env.sunDir[2]) || 1;
    // sunDir.w = current arc elevation (the sun-vis v2 threshold input — 074/07).
    frameData.set([env.sunDir[0] / sunLen, env.sunDir[1] / sunLen, env.sunDir[2] / sunLen, env.sunElevation], 36);
    frameData.set([...env.sunColor, 1], 40);
    frameData.set([env.dn, env.sunIndirect, env.sunDirect, env.emissiveBoost], 44);
    frameData.set([...env.skyTop, 1], 48);
    frameData.set([...env.skyHorizon, 1], 52);
    frameData.set([env.fogCutDistance, env.fogStartDistance, env.fogHeightK, env.fogHeightMin], 56);
    frameData.set(
      [env.aoStrength, env.sunVisStrength, (performance.now() - this.startedMs) / 1000, env.windStrength],
      60,
    );
    const moonLen = Math.hypot(env.moonDir[0], env.moonDir[1], env.moonDir[2]) || 1;
    // moonDir.w doubles as the stochastic de-tiling toggle (074/12) — the vec4 slot was spare.
    frameData.set([env.moonDir[0] / moonLen, env.moonDir[1] / moonLen, env.moonDir[2] / moonLen, env.stochastic], 64);
    // moonColor.w carries the cloud rotation speed (spare vec4 slot, same pattern as moonDir.w).
    frameData.set([...env.moonColor, env.cloudSpeed], 68);
    // params3 = [light count (row 7), cloud layer on, cloudDark, cloud layer alpha] — row 15.
    frameData[72] = this.fillLightPool(camera.eye);
    frameData[73] = this.cloudLayerOn;
    frameData[74] = env.cloudDark;
    frameData[75] = Math.min(1, Math.max(0, env.cloudAlpha));
    // sunCore/sunCorona = the SUN VISUAL (timecyc columns — the disc is yellow/orange; the white-ish
    // env.sunColor stays the LIGHT). sunCore.w = angular core radius (rad) from timecyc sunSize;
    // sunCorona.w = weather cloud COVER (prod's uCloudClear source — hides stars globally under overcast).
    frameData.set([...env.sunCoreColor, env.sunSize * SUN_SIZE_TO_RAD], 76);
    frameData.set([...env.sunCoronaColor, Math.min(1, Math.max(0, env.cloudCover))], 80);
    this.device.queue.writeBuffer(this.frameUniform, 0, frameData);
    this.refreshSkyLut();

    frustumFromViewProj(this.frustumPlanes, this.viewProj);
    const bundles: GPURenderBundle[] = [];
    const blendCells: { bundle: GPURenderBundle; distanceSq: number }[] = [];
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
        if (cell.blendBundle) {
          blendCells.push({
            bundle: cell.blendBundle,
            distanceSq:
              (cell.bounds[0] - camera.eye[0]) ** 2 +
              (cell.bounds[1] - camera.eye[1]) ** 2 +
              (cell.bounds[2] - camera.eye[2]) ** 2,
          });
        }
        draws += cell.draws;
      }
    }
    // Blend phase back-to-front by CELL distance — cross-cell transparency ordering (per-group order inside
    // a cell stays baked; the standard within-bundle transparency caveat).
    const blendBundles = blendCells.sort((a, b) => b.distanceSq - a.distanceSq).map((entry) => entry.bundle);

    const encoder = this.device.createCommandEncoder({ label: 'frame' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          clearValue: this.skyColor,
          loadOp: 'clear',
          resolveTarget: this.sceneColorView,
          storeOp: 'discard',
          view: this.msaaView,
        },
      ],
      depthStencilAttachment: {
        depthClearValue: 0, // reversed-Z far plane
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
        view: this.depthView,
      },
      label: 'world',
      ...this.timers.passTimestampWrites(),
    });
    // TWO-PHASE frame (field fix): every cell's OPAQUE first (complete depth), then the sky (background
    // pixels only), then every cell's BLENDS over the finished depth — a later cell's opaque can no longer
    // repaint an earlier cell's foliage/glass, and blends depth-test against the whole world.
    if (bundles.length > 0) {
      pass.executeBundles(bundles);
    }
    // ObjectTable draws (074/06 row 9): hour-gated timed objects, in the opaque phase (their blend groups
    // sort with the world blends only approximately — the standard transparency caveat).
    draws += this.drawObjects(pass);
    draws += this.drawPed(pass);
    draws += this.drawVehicle(pass, false);
    pass.setPipeline(this.pipelines.get('sky'));
    pass.setBindGroup(0, this.frameBindGroup);
    pass.draw(3);
    if (blendBundles.length > 0) {
      pass.executeBundles(blendBundles);
    }
    // Entity glass after the world blends (074/08 B2): composites over the finished frame.
    draws += this.drawVehicle(pass, true);
    // 2dfx coronas last (074/06 row 13): additive on top of everything, depth-read hides occluded ones.
    draws += this.drawCoronas(pass, camera);
    pass.end();
    // Godrays composite (074/09 stage 1): radial blur of the resolved scene toward the sun's screen
    // position, written to the sRGB swapchain. Uniform updated first (sun UV + gates).
    this.device.queue.writeBuffer(this.postUniform, 0, this.fillPostUniform());
    const postPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          clearValue: { a: 1, b: 0, g: 0, r: 0 },
          loadOp: 'clear',
          storeOp: 'store',
          view: canvasTexture.createView({ format: this.engineDevice.colorFormat }),
        },
      ],
      label: 'post',
    });
    postPass.setPipeline(this.pipelines.get('post'));
    postPass.setBindGroup(0, this.postBindGroup);
    postPass.draw(3);
    postPass.end();
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
    // Scene pipelines target the 16-float offscreen (godrays bright-pass needs the HDR overshoot); only
    // the post pipeline writes the sRGB swapchain.
    this.pipelines = compileAll(this.device, SCENE_FORMAT, DEPTH_FORMAT, this.engineDevice.colorFormat);
    this.frameUniform = this.resources.createBuffer('uniform', {
      label: 'frame',
      size: 336, // viewProj + invViewProj (128) + camera/sun/params/sky×2/fog/params2/moon×2/params3/sunCore/sunCorona (13 × 16)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Local light pool (074/06 row 7): CPU-filled point lights, shared by every frame-layout pipeline.
    this.lightPoolBuffer = this.resources.createBuffer('uniform', {
      label: 'light-pool',
      size: this.lightPoolScratch.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    // PBR sky LUT (074/06 row 4): CPU-built Preetham dome, refreshed when the environment moves.
    this.skyLutTexture = this.resources.createTexture(
      'texture',
      {
        format: 'rgba16float',
        label: 'sky-lut',
        size: { height: SKY_LUT_HEIGHT, width: SKY_LUT_WIDTH },
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      },
      SKY_LUT_WIDTH * SKY_LUT_HEIGHT * 8,
    );
    // Cloud dome slots A/B (074/06 row 15): BOTH allocated up front — the frame bind group is recorded
    // inside cell bundles and is immutable after init. Weather changes write into the idle slot and the
    // camera.w blend crossfades (env.cloudFadeSeconds).
    const cloudSlot = (label: string): GPUTexture =>
      this.resources.createTexture(
        'texture',
        {
          format: 'rgba8unorm-srgb',
          label,
          size: { height: CLOUD_DOME_SIZE, width: CLOUD_DOME_SIZE },
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        },
        CLOUD_DOME_SIZE * CLOUD_DOME_SIZE * 4,
      );
    this.cloudTextureA = cloudSlot('cloud-dome-a');
    this.cloudTextureB = cloudSlot('cloud-dome-b');
    this.frameBindGroup = this.device.createBindGroup({
      entries: [
        { binding: 0, resource: { buffer: this.frameUniform } },
        { binding: 1, resource: this.skyLutTexture.createView() },
        {
          binding: 2,
          resource: this.device.createSampler({ label: 'sky-lut', magFilter: 'linear', minFilter: 'linear' }),
        },
        { binding: 3, resource: { buffer: this.lightPoolBuffer } },
        { binding: 4, resource: this.cloudTextureA.createView() },
        { binding: 5, resource: this.cloudTextureB.createView() },
      ],
      label: 'frame',
      layout: this.pipelines.frameLayout,
    });
    this.refreshSkyLut();
    this.textures = new TextureArrays(this.device, this.resources, this.pipelines.materialLayout);
    // Corona pass buffers (074/06 row 13): a unit quad + a per-frame instance buffer (CPU-filled, tiny).
    this.coronaQuad = this.resources.createBuffer('cellVertex', {
      label: 'corona-quad',
      size: 48,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.coronaQuad, 0, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]));
    this.coronaInstances = this.resources.createBuffer('cellVertex', {
      label: 'corona-instances',
      size: CORONA_CAP * 32,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.postUniform = this.resources.createBuffer('uniform', {
      label: 'post',
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.postSampler = this.device.createSampler({ label: 'post', magFilter: 'linear', minFilter: 'linear' });
    this.cells = new CellStore({
      colorFormat: SCENE_FORMAT,
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

  removePedProbe(): void {
    if (!this.ped) {
      return;
    }
    for (const buffer of this.ped.buffers) {
      this.resources.destroyBuffer('cellVertex', buffer);
    }
    this.resources.destroyBuffer('cellVertex', this.ped.indexBuffer);
    this.resources.destroyBuffer('uniform', this.ped.paletteBuffer);
    if (this.pedTexture) {
      this.resources.destroyTexture('texture', this.pedTexture, this.pedTextureBytes);
      this.pedTexture = null;
    }
    this.ped = null;
  }

  removeVehicleProbe(): void {
    if (!this.vehicle) {
      return;
    }
    for (const buffer of this.vehicle.buffers) {
      this.resources.destroyBuffer('cellVertex', buffer);
    }
    this.resources.destroyBuffer('cellVertex', this.vehicle.indexBuffer);
    this.resources.destroyBuffer('uniform', this.vehicle.matrixBuffer);
    this.resources.destroyTexture('texture', this.vehicle.texture, this.vehicle.textureBytes);
    this.vehicle = null;
  }

  /** Install a weather's cloud dome (074/06 row 15); RGBA8, EXACTLY CLOUD_DOME_SIZE² (the converter's
   *  contract). The persistent slot textures are overwritten IN PLACE — cell bundles record the frame bind
   *  group at create time, so the group (and every view in it) must never be rebuilt/destroyed. The first
   *  install fills both slots (no fade from garbage); later installs write the idle slot and crossfade
   *  over env.cloudFadeSeconds. Pass null to gate the layer off. */
  setCloudTexture(texture: null | { height: number; rgba: Uint8Array; width: number }): void {
    if (texture && this.cloudTextureA && this.cloudTextureB) {
      if (texture.width !== CLOUD_DOME_SIZE || texture.height !== CLOUD_DOME_SIZE) {
        throw new Error(`cloud dome must be ${CLOUD_DOME_SIZE}² (got ${texture.width}×${texture.height})`);
      }
      const write = (target: GPUTexture): void =>
        this.device.queue.writeTexture(
          { texture: target },
          texture.rgba,
          { bytesPerRow: texture.width * 4 },
          { height: texture.height, width: texture.width },
        );
      if (this.cloudLayerOn === 0) {
        write(this.cloudTextureA);
        write(this.cloudTextureB);
        this.cloudFadeFrom = 0;
        this.cloudFadeTarget = 0;
      } else {
        const from = this.currentCloudBlend();
        const target = from < 0.5 ? 1 : 0;
        write(target === 1 ? this.cloudTextureB : this.cloudTextureA);
        this.cloudFadeFrom = from;
        this.cloudFadeTarget = target;
        this.cloudFadeStartMs = performance.now();
      }
    }
    this.cloudLayerOn = texture ? 1 : 0;
  }

  /** Create (or replace) the skinning probe entity (074/08 B1). Returns the live palette handle. */
  setPedProbe(init: PedProbeInit): PedProbe {
    this.removePedProbe();
    const upload = (label: string, bytes: Uint8Array, usage: number): GPUBuffer => {
      const size = Math.ceil(bytes.byteLength / 4) * 4;
      const buffer = this.resources.createBuffer('cellVertex', {
        label: `ped-${label}`,
        size,
        usage: usage | GPUBufferUsage.COPY_DST,
      });
      // writeBuffer length must be %4 (the M0 lesson) — odd u16 index payloads get a zero-padded copy.
      let payload = bytes;
      if (bytes.byteLength !== size) {
        payload = new Uint8Array(size);
        payload.set(bytes);
      }
      this.device.queue.writeBuffer(buffer, 0, payload);

      return buffer;
    };
    const buffers = [
      upload('positions', init.positions, GPUBufferUsage.VERTEX),
      upload('normals', init.normals, GPUBufferUsage.VERTEX),
      upload('uvs', init.uvs, GPUBufferUsage.VERTEX),
      upload('joints', init.joints, GPUBufferUsage.VERTEX),
      upload('weights', init.weights, GPUBufferUsage.VERTEX),
    ];
    const indexBuffer = upload('indices', init.indices, GPUBufferUsage.INDEX);
    const palette = new Float32Array((1 + init.boneCount) * 16);
    const paletteBuffer = this.resources.createBuffer('uniform', {
      label: 'ped-palette',
      size: palette.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const texture = this.resources.createTexture(
      'texture',
      {
        format: 'rgba8unorm-srgb',
        label: 'ped-texture',
        size: { height: init.texture.height, width: init.texture.width },
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      },
      init.texture.rgba.byteLength,
    );
    this.device.queue.writeTexture(
      { texture },
      init.texture.rgba,
      { bytesPerRow: init.texture.width * 4 },
      { height: init.texture.height, width: init.texture.width },
    );
    const bindGroup = this.device.createBindGroup({
      entries: [
        { binding: 0, resource: { buffer: paletteBuffer } },
        { binding: 1, resource: texture.createView() },
        { binding: 2, resource: this.device.createSampler({ label: 'ped', magFilter: 'linear', minFilter: 'linear' }) },
      ],
      label: 'ped',
      layout: this.pipelines.pedLayout,
    });
    this.ped = { bindGroup, buffers, indexBuffer, palette, paletteBuffer, submeshes: init.submeshes };
    this.pedTexture = texture;
    this.pedTextureBytes = init.texture.rgba.byteLength;

    return { palette };
  }

  /** Create (or replace) the rigid-entity probe (074/08 B2). Returns the CPU-side entity handle. */
  setVehicleProbe(init: VehicleProbeInit): RigidEntity {
    this.removeVehicleProbe();
    const upload = (label: string, bytes: Uint8Array, usage: number): GPUBuffer => {
      const size = Math.ceil(bytes.byteLength / 4) * 4;
      const buffer = this.resources.createBuffer('cellVertex', {
        label: `vehicle-${label}`,
        size,
        usage: usage | GPUBufferUsage.COPY_DST,
      });
      let payload = bytes;
      if (bytes.byteLength !== size) {
        payload = new Uint8Array(size);
        payload.set(bytes);
      }
      this.device.queue.writeBuffer(buffer, 0, payload);

      return buffer;
    };
    const buffers = [
      upload('positions', init.positions, GPUBufferUsage.VERTEX),
      upload('normals', init.normals, GPUBufferUsage.VERTEX),
      upload('uvs', init.uvs, GPUBufferUsage.VERTEX),
      upload('colors', init.colors, GPUBufferUsage.VERTEX),
      upload('meta', init.meta, GPUBufferUsage.VERTEX),
    ];
    const indexBuffer = upload('indices', init.indices, GPUBufferUsage.INDEX);
    const entity = new RigidEntity(init.parts);
    const matrixBuffer = this.resources.createBuffer('uniform', {
      label: 'vehicle-matrices',
      size: entity.matrices.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const layerBytes = init.texture.width * init.texture.height * 4;
    const texture = this.resources.createTexture(
      'texture',
      {
        format: 'rgba8unorm-srgb',
        label: 'vehicle-texture',
        size: { depthOrArrayLayers: init.texture.layers, height: init.texture.height, width: init.texture.width },
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      },
      init.texture.rgba.byteLength,
    );
    for (let layer = 0; layer < init.texture.layers; layer += 1) {
      this.device.queue.writeTexture(
        { origin: { x: 0, y: 0, z: layer }, texture },
        init.texture.rgba.subarray(layer * layerBytes, (layer + 1) * layerBytes),
        { bytesPerRow: init.texture.width * 4 },
        { height: init.texture.height, width: init.texture.width },
      );
    }
    const bindGroup = this.device.createBindGroup({
      entries: [
        { binding: 0, resource: { buffer: matrixBuffer } },
        { binding: 1, resource: texture.createView({ dimension: '2d-array' }) },
        {
          binding: 2,
          resource: this.device.createSampler({ label: 'vehicle', magFilter: 'linear', minFilter: 'linear' }),
        },
      ],
      label: 'vehicle',
      layout: this.pipelines.rigidLayout,
    });
    this.vehicle = {
      bindGroup,
      buffers,
      entity,
      indexBuffer,
      matrixBuffer,
      submeshes: init.submeshes,
      texture,
      textureBytes: init.texture.rgba.byteLength,
    };

    return entity;
  }

  /** Upload the probe's palette after the host wrote it (model matrix slot 0 + sampled bones). */
  updatePedPalette(): void {
    if (this.ped) {
      this.device.queue.writeBuffer(this.ped.paletteBuffer, 0, this.ped.palette);
    }
  }

  /** Flatten the part hierarchy and upload the matrix buffer (call after mutating the entity). */
  updateVehicle(): void {
    if (this.vehicle) {
      this.vehicle.entity.flatten();
      this.device.queue.writeBuffer(this.vehicle.matrixBuffer, 0, this.vehicle.entity.matrices);
    }
  }

  /** Cloud slot blend on the frame clock (0 = slot A, 1 = slot B) — written into camera.w each frame. */
  private currentCloudBlend(): number {
    const fadeMs = Math.max(1, this.environment.cloudFadeSeconds * 1000);
    const t = Math.min(1, (performance.now() - this.cloudFadeStartMs) / fadeMs);

    return this.cloudFadeFrom + (this.cloudFadeTarget - this.cloudFadeFrom) * t;
  }

  /** 2dfx corona billboards of visible cells (074/06 row 13): CPU-gated by night + farClip, one
   *  instanced draw. Colour is premultiplied by the dn gate — coronas are a NIGHT phenomenon (v1). */
  private drawCoronas(pass: GPURenderPassEncoder, camera: CameraState): number {
    const gate = Math.min(1, Math.max(0, this.environment.dn * 1.5));
    if (gate <= 0.02) {
      return 0;
    }
    let count = 0;
    const scratch = this.coronaScratch;
    for (const cell of this.cells.all()) {
      if (!cell.visible || cell.lights.length === 0) {
        continue;
      }
      for (const light of cell.lights) {
        if (count >= CORONA_CAP) {
          break;
        }
        const dx = light.x - camera.eye[0];
        const dy = light.y - camera.eye[1];
        const dz = light.z - camera.eye[2];
        const dist = Math.hypot(dx, dy, dz);
        // farClip floor: SA clips street coronas ~100 units (street-level tuning) — the lab camera flies
        // high, so v1 keeps them alive to 350; the game integration restores the authored clip.
        const reach = Math.max(light.farClip, 350);
        if (dist > reach) {
          continue;
        }
        const fade = gate * Math.min(1, (1 - dist / reach) * 4) * (light.color[3] / 255);
        const at = count * 8;
        scratch[at] = light.x;
        scratch[at + 1] = light.y;
        scratch[at + 2] = light.z;
        scratch[at + 3] = light.size * 1.5;
        scratch[at + 4] = (light.color[0] / 255) ** 2.2;
        scratch[at + 5] = (light.color[1] / 255) ** 2.2;
        scratch[at + 6] = (light.color[2] / 255) ** 2.2;
        scratch[at + 7] = fade;
        count += 1;
      }
    }
    if (count === 0) {
      return 0;
    }
    this.device.queue.writeBuffer(this.coronaInstances, 0, scratch, 0, count * 8);
    pass.setPipeline(this.pipelines.get('corona'));
    pass.setBindGroup(0, this.frameBindGroup);
    pass.setVertexBuffer(0, this.coronaQuad);
    pass.setVertexBuffer(1, this.coronaInstances);
    pass.draw(6, count);

    return 1;
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

  private drawPed(pass: GPURenderPassEncoder): number {
    if (!this.ped) {
      return 0;
    }
    pass.setPipeline(this.pipelines.get('ped'));
    pass.setBindGroup(0, this.frameBindGroup);
    pass.setBindGroup(1, this.ped.bindGroup);
    this.ped.buffers.forEach((buffer, slot) => pass.setVertexBuffer(slot, buffer));
    pass.setIndexBuffer(this.ped.indexBuffer, 'uint16');
    for (const submesh of this.ped.submeshes) {
      pass.drawIndexed(submesh.indexCount, 1, submesh.indexOffset);
    }

    return this.ped.submeshes.length;
  }

  private drawVehicle(pass: GPURenderPassEncoder, translucent: boolean): number {
    if (!this.vehicle) {
      return 0;
    }
    let draws = 0;
    let bound = false;
    for (const submesh of this.vehicle.submeshes) {
      if (submesh.translucent !== translucent) {
        continue;
      }
      if (!bound) {
        pass.setPipeline(this.pipelines.get(translucent ? 'rigid-blend' : 'rigid-opaque'));
        pass.setBindGroup(0, this.frameBindGroup);
        pass.setBindGroup(1, this.vehicle.bindGroup);
        this.vehicle.buffers.forEach((buffer, slot) => pass.setVertexBuffer(slot, buffer));
        pass.setIndexBuffer(this.vehicle.indexBuffer, 'uint16');
        bound = true;
      }
      pass.drawIndexed(submesh.indexCount, 1, submesh.indexOffset, 0, submesh.part);
      draws += 1;
    }

    return draws;
  }

  private ensureTargets(width: number, height: number): void {
    if (this.targetSize.width === width && this.targetSize.height === height) {
      return;
    }
    this.targetSize = { height, width };
    const bytes = width * height * (8 + 4) * MSAA_SAMPLES; // 16f color + depth estimate
    const msaa = this.resources.createTexture(
      'target',
      {
        format: SCENE_FORMAT,
        label: 'msaa-color',
        sampleCount: MSAA_SAMPLES,
        size: { height, width },
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      },
      bytes / 2,
    );
    // The MSAA resolve lands here; the godrays post pass samples it and writes the swapchain.
    const sceneColor = this.resources.createTexture(
      'target',
      {
        format: SCENE_FORMAT,
        label: 'scene-color',
        size: { height, width },
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      },
      width * height * 8,
    );
    this.sceneColorView = sceneColor.createView();
    this.postBindGroup = this.device.createBindGroup({
      entries: [
        { binding: 0, resource: { buffer: this.postUniform } },
        { binding: 1, resource: this.sceneColorView },
        { binding: 2, resource: this.postSampler },
      ],
      label: 'post',
      layout: this.pipelines.postLayout,
    });
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

  /** Fill the local light pool (074/06 row 7): host dynamics first, then 2dfx lamps at night by distance.
   *  Returns the light count (params3.x — bounds the WGSL loop). */
  private fillLightPool(eye: Vec3): number {
    const scratch = this.lightPoolScratch;
    let count = 0;
    const push = (x: number, y: number, z: number, radius: number, r: number, g: number, b: number): void => {
      if (count >= LIGHT_POOL_CAP) {
        return;
      }
      const at = count * 8;
      scratch[at] = x;
      scratch[at + 1] = y;
      scratch[at + 2] = z;
      scratch[at + 3] = radius;
      scratch[at + 4] = r;
      scratch[at + 5] = g;
      scratch[at + 6] = b;
      scratch[at + 7] = 0;
      count += 1;
    };
    for (const light of this.dynamicLights) {
      push(light.position[0], light.position[1], light.position[2], light.radius, ...light.color);
    }
    // 2dfx street lamps join at night (the same anchors the corona pass draws), distance-bounded.
    const gate = this.environment.dn * 1.4;
    if (gate > 0.03) {
      for (const cell of this.cells.all()) {
        if (count >= LIGHT_POOL_CAP) {
          break;
        }
        for (const light of cell.lights) {
          const dx = light.x - eye[0];
          const dy = light.y - eye[1];
          const dz = light.z - eye[2];
          if (dx * dx + dy * dy + dz * dz > LIGHT_POOL_REACH * LIGHT_POOL_REACH) {
            continue;
          }
          push(
            light.x,
            light.y,
            light.z,
            Math.max(14, light.size * 8),
            (light.color[0] / 255) ** 2.2 * gate,
            (light.color[1] / 255) ** 2.2 * gate,
            (light.color[2] / 255) ** 2.2 * gate,
          );
        }
      }
    }
    if (count > 0) {
      this.device.queue.writeBuffer(this.lightPoolBuffer, 0, scratch, 0, count * 8);
    }

    return count;
  }

  /** Godrays uniform (074/09 stage 1): [sunU, sunV, intensity, decay] + [tint rgb, threshold]. Intensity
   *  gates on the sun being in front of the camera, above the horizon (sunCoreColor is black at night),
   *  and near/inside the frame (soft edge fade — rays die gracefully as the sun leaves the screen). */
  private fillPostUniform(): Float32Array {
    const out = new Float32Array(8);
    const env = this.environment;
    const vp = this.viewProj;
    const len = Math.hypot(env.sunDir[0], env.sunDir[1], env.sunDir[2]) || 1;
    const [dx, dy, dz] = [env.sunDir[0] / len, env.sunDir[1] / len, env.sunDir[2] / len];
    // Direction at infinity: clip = viewProj × (dir, 0) — column-major, translation column skipped.
    const clipX = vp[0] * dx + vp[4] * dy + vp[8] * dz;
    const clipY = vp[1] * dx + vp[5] * dy + vp[9] * dz;
    const clipW = vp[3] * dx + vp[7] * dy + vp[11] * dz;
    let intensity = 0;
    let u = 0.5;
    let v = 0.5;
    if (clipW > 1e-4 && dy > 0) {
      u = 0.5 + (0.5 * clipX) / clipW;
      v = 0.5 - (0.5 * clipY) / clipW;
      const outside = Math.max(0, -u, u - 1, -v, v - 1);
      const edgeFade = Math.max(0, 1 - outside / 0.45);
      const dayGate = Math.min(1, Math.max(...env.sunCoreColor));
      intensity = GODRAY_INTENSITY * edgeFade * dayGate * Math.max(0, env.godrayStrength);
    }
    out.set([u, v, intensity, GODRAY_DECAY], 0);
    out.set([...env.sunCoronaColor, GODRAY_THRESHOLD], 4);

    return out;
  }

  /** Rebuild the sky LUT when its environment inputs moved (quantized key — ~a few rebuilds per game
   *  minute under a day cycle; each build is ~5 k texels of scalar math + a 72 KB upload). */
  private refreshSkyLut(): void {
    const env = this.environment;
    const input = {
      cloudCover: env.cloudCover,
      cloudDark: env.cloudDark,
      dn: env.dn,
      mood: env.skyMood,
      skyHorizon: env.skyHorizon,
      skyTop: env.skyTop,
      sunElevation: env.sunElevation,
    };
    const key = skyLutKey(input);
    if (key === this.skyLutCurrentKey) {
      return;
    }
    this.skyLutCurrentKey = key;
    this.device.queue.writeTexture(
      { texture: this.skyLutTexture },
      buildSkyLut(input),
      { bytesPerRow: SKY_LUT_WIDTH * 8 },
      { height: SKY_LUT_HEIGHT, width: SKY_LUT_WIDTH },
    );
  }
}

/** SA timed-object gate: params = on | off << 8; the window wraps midnight when on > off. */
function timedActive(params: number, hour: number): boolean {
  const on = params & 0xff;
  const off = (params >> 8) & 0xff;

  return on < off ? hour >= on && hour < off : hour >= on || hour < off;
}
