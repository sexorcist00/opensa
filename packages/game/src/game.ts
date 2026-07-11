import {
  DoubleSide,
  Group,
  InstancedMesh,
  type Light,
  type Mesh,
  MeshBasicMaterial,
  MeshNormalMaterial,
  type Object3D,
  type PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  Vector4,
  type WebGLRenderer,
} from 'three';

import type { StreamingSystem } from './streaming/streaming.system';
import type { City } from './zones/city';

import { CameraController } from './core/camera-controller';
import { Clock } from './core/clock';
import { createRenderContext } from './core/renderer';
import { type System, SystemRegistry } from './core/system';
import { HiddenInstances } from './debug/hidden-instances';
import { Logger } from './diagnostics/logger';
import { EventBus } from './events/event-bus';
import { type GameEvents } from './events/events.global';
import { CombinedInput, type InputState, PointerLookSource } from './input';
import {
  type BloomConfig,
  type CameraConfig,
  type CloudsConfig,
  type Config,
  type EffectsConfig,
  type GameState,
  type HeadlightConfig,
  type LightsConfig,
  type MoonConfig,
  type NightConfig,
  type ProcObjCategory,
  type ProcObjTypeConfig,
  type ShadowsConfig,
  type SkyConfig,
  type SsaoConfig,
  type StarsConfig,
  type SunConfig,
  type ToneMappingModeName,
  type VehicleReflectionConfig,
  type WaterConfig,
  type WorldLightConfig,
} from './interfaces/config.interface';
import { type RegionRequest, type Vec3, type WorldAdapter } from './interfaces/world-adapter.interface';
import { type WorldMod } from './mods/mod.interface';
import { GpuTimer } from './perf/gpu-timer';
import { PerfMonitor } from './perf/perf-monitor';
import { type Plugin, type PluginContext, type RenderPipeline } from './plugins/plugin';
import { BasicRenderPipeline } from './plugins/render-pipeline';
import { type CellCoord } from './streaming/grid';
import { createSettleWatcher } from './streaming/settle-watcher';
import { GameClock } from './time/game-clock';
import { inHourWindow } from './time/hour-window';
import { type WeatherBlend, WeatherTransition } from './weather/weather-transition';

const FIXED_STEP = 1 / 60;
/** Engine default weather before a world is loaded (loadGame seeds the real one). */
const DEFAULT_WEATHER = 0;

interface LoadOptions {
  /** Radius (world units) the collision zone is built for; streaming handles render. */
  radius?: number;
  /** Start time of day in minutes since midnight (e.g. 360 = 6:00); defaults to noon. */
  startMinutes?: number;
  /** Initial timecyc weather index (into WEATHER_NAMES); defaults to {@link DEFAULT_WEATHER}. */
  weather?: number;
}

/**
 * The engine, as a singleton wrapper. Framework-agnostic: it owns the
 * renderer/scene/camera (built from a canvas) + an OrbitControls camera
 * controller, installs plugins, runs the loop (fixed-step systems → camera →
 * plugin update → pipeline render), loads the world through a {@link WorldAdapter},
 * and raycasts for picking. UI drives it via methods + the typed event bus.
 */
export class Game {
  private static instance: Game | null = null;

  readonly events = new EventBus<GameEvents>();

  private accumulator = 0;
  private adapter: null | WorldAdapter = null;
  private camera!: PerspectiveCamera;
  private cameraController!: CameraController;
  private readonly canvas: HTMLCanvasElement;
  private readonly clock = new Clock();
  private readonly collisionObjects: Object3D[] = [];
  /** Collision streaming ref (plan 061) — the physics half of {@link worldSettled}. */
  private collisionStreaming: null | { settled(): boolean } = null;
  private readonly config: Config;
  private context: null | PluginContext = null;
  private currentCity: City = 'COUNTRYSIDE';
  private currentZone = ''; // district display name (GXT text); '' = no zone
  private readonly entityRoot = new Group();
  /** Debug wireframe view (Map → Show Faces): scene-wide wireframe override to inspect the mesh. Lazy. */
  private faceMaterial: MeshBasicMaterial | null = null;
  private readonly gameClock = new GameClock();
  private gpuTimer: GpuTimer | null = null;
  /** Map-inspector "Hide object" state — restored automatically when the map viewer turns off. */
  private readonly hiddenInstances = new HiddenInstances();
  private input!: CombinedInput;
  /** The last successful pick (map-inspector selection) — the target of {@link hideSelectedObject}. */
  private lastPick: null | { instanceId: number; mesh: InstancedMesh } = null;
  private lastRequest: null | RegionRequest = null;
  private readonly logger: Logger;
  /** Debug normals view (plan: Map → Show Normals): scene-wide MeshNormalMaterial override, rendered
   *  straight to the screen (bypassing post-FX) so the normals read clean. Lazily created. */
  private normalMaterial: MeshNormalMaterial | null = null;
  private readonly perfMonitor = new PerfMonitor();
  private pipeline!: RenderPipeline;
  private readonly plugins: Plugin[] = [];
  private pointerSource!: PointerLookSource;
  private readonly raycaster = new Raycaster();
  private renderer!: WebGLRenderer;
  private scene!: Scene;
  /** Whether the debug wireframe override is active (shares the bypass-post-FX render path with normals). */
  private showFacesMode = false;
  /** Whether the debug normals override is active (render path bypasses post-FX while on). */
  private showNormalsMode = false;
  private started = false;
  private readonly streamingRoot = new Group();
  private streamingSystem: null | StreamingSystem = null;
  private readonly systems = new SystemRegistry();
  /** Reused by {@link warmUp} — it runs many times per frame during streaming ingest. */
  private readonly warmHolder = new Scene();
  private readonly warmViewport = new Vector4();
  private readonly weatherTransition: WeatherTransition;
  /** Phase-1 WebGPU spike (`?webgpu=1`): renderer is WebGPU; plugins + GPU timer are skipped. */
  private webgpu = false;

  private constructor(canvas: HTMLCanvasElement, config: Config) {
    this.canvas = canvas;
    this.config = config;
    this.weatherTransition = new WeatherTransition(DEFAULT_WEATHER);
    this.logger = new Logger(this.events, this.config);
    // Dynamic entities (the player, later NPCs/vehicles) live in GTA Z-up; the
    // −90°X here is display-only, matching the region group. Physics stays Z-up.
    this.entityRoot.name = 'EntityRoot';
    this.entityRoot.rotation.x = -Math.PI / 2;
    // Streamed map cells live in GTA Z-up too; one −90°X for the whole streaming root.
    this.streamingRoot.name = 'StreamingRoot';
    this.streamingRoot.rotation.x = -Math.PI / 2;
  }

  static getInstance(canvas?: HTMLCanvasElement, config?: Config): Game {
    if (!Game.instance) {
      if (!canvas || !config) {
        throw new Error('Game.getInstance requires a canvas and config on first call');
      }
      Game.instance = new Game(canvas, config);
    }

    return Game.instance;
  }

  /** Register another input source (e.g. the keyboard once the character exists, or a touch overlay). */
  addInputSource(source: InputState): void {
    this.input.add(source);
  }

  addPlugin(plugin: Plugin): this {
    this.plugins.push(plugin);

    return this;
  }

  /** Register a system; the loop runs `fixedUpdate(step)` then `update(delta)` on it. */
  addSystem(system: System): this {
    this.systems.add(system);

    return this;
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.pointerSource.stop();
    this.cameraController.dispose();
    for (const plugin of this.plugins) {
      plugin.dispose?.();
    }
    for (const object of this.collisionObjects) {
      disposeObject(object);
    }
    this.renderer.dispose();
    Game.instance = null;
  }

  /** Point the camera at a spawned entity once (initial framing; `setFollowTarget` trails it). */
  frameEntity(object: Object3D, distance = 20): void {
    this.entityRoot.updateMatrixWorld(true);
    this.cameraController.focus(object.getWorldPosition(new Vector3()), distance);
  }

  /** The scene camera (read-only handle; e.g. for camera-relative input). */
  getCamera(): PerspectiveCamera {
    return this.camera;
  }

  /** Live follow distance (includes wheel zoom) — for the debug "current" readout. */
  getCameraDistance(): number {
    return this.cameraController.getDistance();
  }

  /** The city the player is currently in (driven by {@link CityZoneSystem}); Countryside until a world loads. */
  getCity(): City {
    return this.currentCity;
  }

  /** The live config (mutated in place by `setConfig`); systems read it for state. */
  getConfig(): Readonly<Config> {
    return this.config;
  }

  /** Root group for dynamic entity meshes (player, NPCs). Native GTA Z-up content. */
  getEntityRoot(): Group {
    return this.entityRoot;
  }

  /** GPU pass timer (plan 063); `null` before init, no-op when the timer extension is missing. */
  getGpuTimer(): GpuTimer | null {
    return this.gpuTimer;
  }

  /** Continuous in-game time of day in hours (0–24, fractional) — for smooth consumers (sun/sky). */
  getHours(): number {
    return this.gameClock.exactMinutes / 60;
  }

  /** The combined player input the systems + camera read (plan 055); add sources via {@link addInputSource}. */
  getInput(): InputState {
    return this.input;
  }

  /** Shared diagnostics logger; pass to systems so they can emit gated `'log'` events. */
  getLogger(): Logger {
    return this.logger;
  }

  /** Frame-time / renderer.info sampler (plan 063) — the perf HUD and bench harness read/enable it. */
  getPerfMonitor(): PerfMonitor {
    return this.perfMonitor;
  }

  /** The scene root (read-only handle; e.g. for debug helpers that need world space, not a Z-up root). */
  getScene(): Scene {
    return this.scene;
  }

  /** Root group the streaming system adds/removes map cells under (native GTA Z-up). */
  getStreamingRoot(): Group {
    return this.streamingRoot;
  }

  /** Current in-game time, minutes since midnight (0–1439). */
  getTime(): number {
    return this.gameClock.minutes;
  }

  /** The grid cell the streaming view is in (null until streaming is wired). */
  getViewCell(): CellCoord | null {
    return this.streamingSystem?.viewCell() ?? null;
  }

  /** Active timecyc weather index (the committed target; the UI shows this as selected). */
  getWeather(): number {
    return this.weatherTransition.target;
  }

  /** Live weather blend (from/to indices + eased `t`) for the samplers — drives smooth transitions. */
  getWeatherBlend(): WeatherBlend {
    return this.weatherTransition.blend();
  }

  /** The district display name the player is in (GXT text from {@link ZoneNameSystem}); '' until in a zone. */
  getZone(): string {
    return this.currentZone;
  }

  /** Hide the last picked instance (map inspector) — restored automatically when the map viewer closes. */
  hideSelectedObject(): number {
    if (this.lastPick) {
      const count = this.hiddenInstances.hide(this.lastPick.mesh, this.lastPick.instanceId);
      this.lastPick = null;
      this.events.emit('select', null); // the object is gone from view — clear the selection panel

      return count;
    }

    return this.hiddenInstances.count;
  }

  async init(): Promise<void> {
    if (this.context) {
      return; // already initialized
    }
    const { camera, renderer, scene, webgpu } = await createRenderContext(this.canvas);
    this.webgpu = webgpu;
    this.camera = camera;
    this.renderer = renderer;
    this.scene = scene;
    this.scene.add(this.entityRoot);
    this.scene.add(this.streamingRoot);
    // Mouse look/zoom is an input source; other sources (keyboard, touch) join via addInputSource (plan 055).
    this.pointerSource = new PointerLookSource(renderer.domElement);
    this.pointerSource.start();
    this.input = new CombinedInput([this.pointerSource]);
    this.cameraController = new CameraController(camera, renderer.domElement, this.config, this.input);
    this.pipeline = new BasicRenderPipeline(renderer, scene, camera);
    // WebGPU spike: no WebGL2 context → skip the WebGL GPU timer.
    this.gpuTimer = webgpu ? null : GpuTimer.create(renderer.getContext() as WebGL2RenderingContext);
    // Perf accuracy (plan 063): with the post-FX composer, three resets `renderer.info` on EVERY internal
    // render call, so a post-frame sample would only see the last pass (1 draw / 1 triangle). Accumulate
    // across the whole frame instead: manual reset at the top of the loop.
    renderer.info.autoReset = false;
    this.context = {
      camera,
      clock: this.clock,
      config: this.config,
      events: this.events,
      pipeline: this.pipeline,
      renderer,
      scene,
    };

    // WebGPU spike (Phase 1): the plugins author raw GLSL (sky/water/csm) or use the WebGL-only `postprocessing`
    // lib (postfx) — none run on WebGPU yet. Skip their install so the raw streamed world renders under WebGPU
    // with base (auto-converted) materials. Porting each to TSL is the rest of Phase 1.
    if (!webgpu) {
      for (const plugin of this.plugins) {
        await plugin.install(this.context);
      }
    }

    this.start();
    this.events.emit('ready');
  }

  /**
   * Install a game mod (plan 039): wires its per-frame `update` in as a system. The mod's
   * `decoratePart` build hook is delivered separately — the host passes the same mod objects into
   * the world adapter's config (see canvas-host), since the adapter builds cells, not the engine.
   */
  installMod(mod: WorldMod): this {
    if (mod.update) {
      this.addSystem({
        name: `mod:${mod.name}`,
        update: (): void => mod.update?.({ hours: this.getHours(), seconds: performance.now() / 1000 }),
      });
    }

    return this;
  }

  /** Whether it's "night" by the configured lamp hours (`graphics.lights.nightStartHour/EndHour`). The single
   *  hour-based night signal for night lights — coronas + vehicle headlights (the master `lights.enabled`
   *  toggle is applied per-feature by callers). Distinct from `SkyPlugin`'s sun-height factor for atmosphere. */
  isNight(): boolean {
    const lights = this.config.graphics.lights;

    return inHourWindow(((this.getHours() % 24) + 24) % 24, lights.nightStartHour, lights.nightEndHour);
  }

  /** Every grid cell that holds content (for the debug section inspector). */
  listCells(): CellCoord[] {
    return this.adapter?.listCells() ?? [];
  }

  async loadGame(center: Vec3, options: LoadOptions = {}): Promise<void> {
    if (!this.adapter) {
      throw new Error('Game.loadGame requires a world adapter (setWorldAdapter)');
    }
    this.gameClock.set(options.startMinutes ?? 720); // default noon
    this.weatherTransition.begin(options.weather ?? DEFAULT_WEATHER, 0); // seed weather instantly (no ease)
    this.events.emit('loading', { fraction: 0 });
    await this.adapter.prepare((fraction) => this.events.emit('loading', { fraction }));

    // The map renders via the StreamingSystem (cells follow the view); loadGame just
    // prepares the adapter and seeds the collision zone around `center`.
    this.lastRequest = { center, geometry: 'map', radius: options.radius ?? 500 };
    await this.refreshCollision();
    this.events.emit('loaded');
  }

  /** Raycast at normalized device coords (-1..1) and emit the picked object info. */
  pick(ndcX: number, ndcY: number): void {
    if (!this.adapter) {
      return;
    }
    this.raycaster.setFromCamera(new Vector2(ndcX, ndcY), this.camera);
    const hit = this.raycaster
      .intersectObjects(this.streamingRoot.children, true)
      .find((it) => it.instanceId !== undefined);
    this.lastPick = null;
    if (hit && hit.instanceId !== undefined && hit.object instanceof InstancedMesh) {
      // three's instanceof narrows to InstancedMesh<any, …> — pin the default generics for the field.
      this.lastPick = { instanceId: hit.instanceId, mesh: hit.object as InstancedMesh };
    }
    this.events.emit('select', hit ? this.adapter.describe(hit.object, hit.instanceId) : null);
  }

  /**
   * Pre-compile a batch of freshly built cell objects BEFORE they enter the scene (plan 060 Phase 4):
   * `compileAsync` compiles their shader programs and uploads their textures against the live scene's
   * lighting, so the frame the cell appears in doesn't pay the upload/compile hitch.
   */
  async precompile(objects: readonly Object3D[]): Promise<void> {
    const holder = new Group();
    objects.forEach((object) => holder.add(object));
    try {
      await this.renderer.compileAsync(holder, this.camera, this.scene);
    } finally {
      // compileAsync only initializes GPU state; detach so the streaming system owns scene placement.
      [...holder.children].forEach((object) => holder.remove(object));
    }
  }

  resize(width: number, height: number): void {
    if (!this.context) {
      return;
    }
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    for (const plugin of this.plugins) {
      plugin.resize?.(width, height);
    }
  }

  /** Put every debug-hidden instance back (also runs automatically on map-viewer exit). */
  restoreHiddenObjects(): number {
    this.hiddenInstances.restoreAll();

    return 0;
  }

  /** Tune bloom (enabled/intensity/threshold) at runtime; merges into `graphics.bloom`. */
  setBloom(patch: Partial<BloomConfig>): void {
    this.setConfig({ graphics: { ...this.config.graphics, bloom: { ...this.config.graphics.bloom, ...patch } } });
  }

  /** Tune the water shader (glint/reflection) at runtime; merges into `graphics.water`. */
  /** Tune the follow camera (distance / angle / responsiveness / zoom range) at runtime; merges into `camera`. */
  setCamera(patch: Partial<CameraConfig>): void {
    this.setConfig({ camera: { ...this.config.camera, ...patch } });
    if (patch.followDistance !== undefined) {
      this.cameraController.setDistance(patch.followDistance); // keep the live (wheel) distance in sync
    }
  }

  /** Set the player's current city (from {@link CityZoneSystem}); emits `'city'` only on a real change. */
  setCity(city: City): void {
    if (city !== this.currentCity) {
      this.currentCity = city;
      this.events.emit('city', { city });
    }
  }

  /** Tune procedural sky clouds (coverage/opacity) at runtime; merges into `graphics.clouds`. */
  setClouds(patch: Partial<CloudsConfig>): void {
    this.setConfig({ graphics: { ...this.config.graphics, clouds: { ...this.config.graphics.clouds, ...patch } } });
  }

  /** Register the collision streaming system for {@link worldSettled} (plan 061). */
  setCollisionStreaming(system: { settled(): boolean }): void {
    this.collisionStreaming = system;
  }

  setConfig(patch: Partial<Config>): void {
    Object.assign(this.config, patch); // mutate in place so PluginContext.config stays live
    this.broadcastConfigChanged();
  }

  /** Tune world 2dfx particle effects (plan 044) at runtime; merges into `graphics.effects`. */
  setEffects(patch: Partial<EffectsConfig>): void {
    this.setConfig({ graphics: { ...this.config.graphics, effects: { ...this.config.graphics.effects, ...patch } } });
  }

  /** Swing the follow camera to a given orbit azimuth (yaw about world up). */
  /** Detach the camera for free-fly screenshots (arrows move, mouse looks); off → resume follow. */
  setFlyCamera(enabled: boolean): void {
    this.cameraController.setMode(enabled ? 'fly' : 'follow');
    this.events.emit('fly-camera', { enabled });
  }

  /** Change the distance fog range at runtime (world units to full fog). */
  setFogDistance(distance: number): void {
    this.setConfig({ fog: { ...this.config.fog, distance } });
  }

  setFollowAzimuth(azimuth: number): void {
    this.cameraController.setAzimuth(azimuth);
  }

  /** The object the camera trails in follow mode (null = none). */
  setFollowTarget(object: null | Object3D): void {
    this.cameraController.setTarget(object);
  }

  /** Switch between play (physics + control) and pause (frozen). */
  setGameState(state: GameState): void {
    this.setConfig({ gameState: state });
    this.events.emit('game-state', { state });
  }

  /** Toggle the god-rays post-effect at runtime. */
  setGodrays(enabled: boolean): void {
    this.setSun({ godrays: enabled });
  }

  /** Change the god-rays light-source size at runtime (shaft strength; independent of the disc). */
  setGodraysSize(godraysSize: number): void {
    this.setSun({ godraysSize });
  }

  /** Flip the rendering-pipeline master switch (plan 063; later plans branch on it — no-op today). */
  setGraphicsPipeline(pipeline: 'classic' | 'modern'): void {
    this.setConfig({ graphics: { ...this.config.graphics, pipeline } });
  }

  /** Tune vehicle headlights (beam size/reach/strength) at runtime; merges into `graphics.headlights`. */
  setHeadlights(patch: Partial<HeadlightConfig>): void {
    this.setConfig({
      graphics: { ...this.config.graphics, headlights: { ...this.config.graphics.headlights, ...patch } },
    });
  }

  /** Tune night light sources (coronas) at runtime; merges into `graphics.lights`. */
  setLights(patch: Partial<LightsConfig>): void {
    this.setConfig({ graphics: { ...this.config.graphics, lights: { ...this.config.graphics.lights, ...patch } } });
  }

  /** Debug: render an explicit set of cells at one detail level (null resumes streaming). */
  setManualCells(cells: CellCoord[] | null, lod = false): void {
    this.streamingSystem?.setManualCells(cells, lod);
  }

  setMapViewer(enabled: boolean): void {
    // The debug normals / wireframe overrides stay available here, so the mesh can be inspected top-down.
    this.setConfig({ mapViewer: enabled });
    this.cameraController.setMode(enabled ? 'debug' : 'follow');
    if (!enabled) {
      // Debug-hidden instances must never leak into gameplay — leaving the map viewer restores them all.
      this.hiddenInstances.restoreAll();
      this.lastPick = null;
    }
    this.events.emit('map-viewer', { enabled });
  }

  /** Tune the night moon (size/glow/elevation) at runtime; merges into `graphics.moon`. */
  setMoon(patch: Partial<MoonConfig>): void {
    this.setConfig({ graphics: { ...this.config.graphics, moon: { ...this.config.graphics.moon, ...patch } } });
  }

  /** Tune night ambient/atmosphere (brightness/tint) at runtime; merges into `graphics.night`. */
  setNight(patch: Partial<NightConfig>): void {
    this.setConfig({ graphics: { ...this.config.graphics, night: { ...this.config.graphics.night, ...patch } } });
  }

  /** Tune one procedural-clutter category (plan 042) at runtime; merges into `graphics.procobj`. */
  setProcObj(category: ProcObjCategory, patch: Partial<ProcObjTypeConfig>): void {
    const procobj = this.config.graphics.procobj;
    this.setConfig({
      graphics: {
        ...this.config.graphics,
        procobj: { ...procobj, [category]: { ...procobj[category], ...patch } },
      },
    });
  }

  /** Toggle sun shadows at runtime; merges into `graphics.shadows`. */
  setShadows(patch: Partial<ShadowsConfig>): void {
    this.setConfig({ graphics: { ...this.config.graphics, shadows: { ...this.config.graphics.shadows, ...patch } } });
  }

  /** Toggle the collision wireframe overlay for the current region (debug). */
  setShowCollision(enabled: boolean): void {
    this.setConfig({ showCollision: enabled });
    void this.refreshCollision();
  }

  /** Debug: render every object as a wireframe (scene-wide) so the mesh/topology is visible. Shares the
   *  override slot with Show Normals, so enabling one disables the other. */
  setShowFaces(enabled: boolean): void {
    this.showFacesMode = enabled;
    if (enabled) {
      this.showNormalsMode = false; // single override slot — one debug view at a time
      if (!this.faceMaterial) {
        this.faceMaterial = new MeshBasicMaterial({
          color: 0x00ff88,
          side: DoubleSide,
          toneMapped: false,
          wireframe: true,
        });
      }
    }
    this.applyDebugOverride();
  }

  /** Debug: render every object with a normals override (scene-wide), straight to the screen so the
   *  normals aren't reshaped by post-FX. Off restores the normal pipeline. */
  setShowNormals(enabled: boolean): void {
    this.showNormalsMode = enabled;
    if (enabled) {
      this.showFacesMode = false; // single override slot — one debug view at a time
      if (!this.normalMaterial) {
        // DoubleSide so back-facing cutout/foliage triangles also show; raw colours (no tone mapping).
        this.normalMaterial = new MeshNormalMaterial({ side: DoubleSide });
        this.normalMaterial.toneMapped = false;
      }
    }
    this.applyDebugOverride();
  }

  /** Tune the god-rays shader (density/exposure/weight) at runtime; merges into `graphics.sky`. */
  setSky(patch: Partial<SkyConfig>): void {
    this.setConfig({ graphics: { ...this.config.graphics, sky: { ...this.config.graphics.sky, ...patch } } });
  }

  /** Tune SSAO (enabled/intensity/radius) at runtime; merges into `graphics.ssao`. */
  setSsao(patch: Partial<SsaoConfig>): void {
    this.setConfig({ graphics: { ...this.config.graphics, ssao: { ...this.config.graphics.ssao, ...patch } } });
  }

  /** Toggle night stars at runtime; merges into `graphics.stars`. */
  setStars(patch: Partial<StarsConfig>): void {
    this.setConfig({ graphics: { ...this.config.graphics, stars: { ...this.config.graphics.stars, ...patch } } });
  }

  /** Tune the map streaming draw distances at runtime (HD / LOD / collision rings); merges into
   *  `config.streaming`. The streaming + collision systems read it live, so it applies next frame. */
  setStreaming(patch: Partial<Config['streaming']>): void {
    this.setConfig({ streaming: { ...this.config.streaming, ...patch } });
  }

  /** Register the streaming system so the engine can drive it (view cell, manual cells). */
  setStreamingSystem(system: StreamingSystem): void {
    this.streamingSystem = system;
  }

  /** Tune the sun disc + god-rays source at runtime; merges into `graphics.sun`. */
  setSun(patch: Partial<SunConfig>): void {
    this.setConfig({ graphics: { ...this.config.graphics, sun: { ...this.config.graphics.sun, ...patch } } });
  }

  /** Change the sun disc base size at runtime (world units; timecyc scales it per hour). */
  setSunSize(sunSize: number): void {
    this.setSun({ sunSize });
  }

  /** Jump the in-game clock to a time (minutes since midnight); emits `'time'`. */
  setTime(minutes: number): void {
    this.gameClock.set(minutes);
    this.emitTime();
  }

  /** Toggle ACES tone mapping at runtime. */
  setToneMapping(enabled: boolean): void {
    this.setConfig({ graphics: { ...this.config.graphics, toneMapping: enabled } });
  }

  /** Colour-spike selector (plan 063): move tone mapping between the post pass and the renderer. */
  setToneMappingMode(toneMappingMode: ToneMappingModeName): void {
    this.setConfig({ graphics: { ...this.config.graphics, toneMappingMode } });
  }

  /** Tune vehicle reflections (preset/intensity) at runtime; merges into `graphics.vehicleReflection`. */
  setVehicleReflection(patch: Partial<VehicleReflectionConfig>): void {
    const vehicleReflection = { ...this.config.graphics.vehicleReflection, ...patch };
    this.setConfig({ graphics: { ...this.config.graphics, vehicleReflection } });
  }

  setWater(patch: Partial<WaterConfig>): void {
    this.setConfig({ graphics: { ...this.config.graphics, water: { ...this.config.graphics.water, ...patch } } });
  }

  /** Switch the active timecyc weather (index into WEATHER_NAMES); eases over `weatherTransitionSeconds`. */
  setWeather(weather: number): void {
    this.weatherTransition.begin(weather, this.config.weatherTransitionSeconds);
    this.broadcastConfigChanged(); // refresh weather-dependent plugins (e.g. the reflection sky probe)
  }

  setWorldAdapter(adapter: WorldAdapter): this {
    this.adapter = adapter;

    return this;
  }

  /** Tune the SA prelit world lighting (plan 038) at runtime; merges into `graphics.worldLight`. */
  setWorldLight(patch: Partial<WorldLightConfig>): void {
    this.setConfig({
      graphics: { ...this.config.graphics, worldLight: { ...this.config.graphics.worldLight, ...patch } },
    });
  }

  /** Set the player's current district display name; emits `'zone'` only on a real change. */
  setZone(name: string): void {
    if (name !== this.currentZone) {
      this.currentZone = name;
      this.events.emit('zone', { name });
    }
  }

  /** Loading progress of the visual view ring — for the streaming veil (plan 061). */
  streamingProgress(): { loaded: number; total: number } {
    return this.streamingSystem?.progress() ?? { loaded: 0, total: 0 };
  }

  /** Snap the map-inspector (debug) camera back to top-down (undo a RIGHT-drag orbit). No-op outside it. */
  topDownView(): void {
    this.cameraController.topDownDebugView();
  }

  /**
   * Force the FIRST-DRAW GPU upload of a batch's geometry buffers without showing anything (plan 060,
   * round 3): render the objects once into a 1×1 scissored viewport with frustum culling off. `compileAsync`
   * covers programs + textures but vertex/instance buffers upload only on an actual draw — this is that draw,
   * off-screen for practical purposes. The streaming system warms a cell in slices across frames, then adds
   * it to the scene ATOMICALLY (no piece-by-piece pop-in, no upload spike on the appearance frame).
   */
  warmUp(objects: readonly Object3D[]): void {
    const holder = this.warmHolder;
    // Mirror the live scene's lighting context (round 5): fog/environment/lights change the shader program
    // cache key, so a bare holder scene made every material SYNC-compile a no-light/no-fog variant nobody
    // renders with (measured 28 ms warm frames for ONE object). Borrowing them makes the warm draw resolve
    // to the exact programs `precompile` already built — warming pays uploads only.
    holder.fog = this.scene.fog;
    holder.environment = this.scene.environment;
    const lights: Object3D[] = [];
    this.scene.traverse((node) => {
      if ((node as Light).isLight) {
        lights.push(node);
      }
    });
    const lightParents = lights.map((light) => light.parent);
    lights.forEach((light) => holder.add(light));
    const culled: boolean[] = [];
    objects.forEach((object) => {
      holder.add(object);
      object.traverse((node) => {
        culled.push(node.frustumCulled);
        node.frustumCulled = false; // guarantee a draw call regardless of where the cell sits
      });
    });
    const viewport = this.warmViewport;
    this.renderer.getViewport(viewport);
    const scissorWasOn = this.renderer.getScissorTest();
    const shadowAutoUpdate = this.renderer.shadowMap.autoUpdate;
    try {
      this.renderer.shadowMap.autoUpdate = false; // no shadow passes for a 1×1 warm draw
      this.renderer.setScissorTest(true);
      this.renderer.setScissor(0, 0, 1, 1);
      this.renderer.setViewport(0, 0, 1, 1);
      this.renderer.render(holder, this.camera);
    } finally {
      this.renderer.shadowMap.autoUpdate = shadowAutoUpdate;
      this.renderer.setViewport(viewport);
      this.renderer.setScissorTest(scissorWasOn);
      let at = 0;
      objects.forEach((object) => {
        object.traverse((node) => {
          node.frustumCulled = culled[at];
          at += 1;
        });
        holder.remove(object);
      });
      lights.forEach((light, index) => lightParents[index]?.add(light));
      holder.fog = null;
      holder.environment = null;
    }
  }

  /**
   * Freeze gameplay while the world streams in around a repositioned view (plan 061): enter `'streaming'`
   * (clock/physics/controller/animation stop; render + streaming keep running — the GPU warm-up needs
   * frames), run `move` (teleport/spawn placement), and restore `'play'` once {@link worldSettled} holds —
   * or after `timeoutMs`, so one failed cell degrades to a warning instead of a forever-frozen game.
   */
  async withStreamingFreeze(move: () => void, timeoutMs = 15_000): Promise<'settled' | 'timeout'> {
    this.setGameState('streaming');
    move();
    const watcher = createSettleWatcher(() => this.worldSettled(), timeoutMs);
    this.systems.add(watcher);
    const outcome = await watcher.result;
    this.systems.remove(watcher);
    if (outcome === 'timeout') {
      this.logger.warn('streaming', 'world-ready timeout — revealing before the ring finished streaming');
    }
    // Only leave the freeze if nothing else changed the state meanwhile (e.g. the pause menu opened).
    if (this.config.gameState === 'streaming') {
      this.setGameState('play');
    }

    return outcome;
  }

  /** Whether the world around the view is fully IN (plan 061): visual ring loaded + collision loaded. */
  worldSettled(): boolean {
    return (this.streamingSystem?.settled() ?? false) && (this.collisionStreaming?.settled() ?? true);
  }

  /** Point the scene's override material at whichever debug view is active (faces / normals / none). */
  private applyDebugOverride(): void {
    this.scene.overrideMaterial = this.showNormalsMode
      ? this.normalMaterial
      : this.showFacesMode
        ? this.faceMaterial
        : null;
  }

  /** Notify every plugin that config (or weather) changed, so they can refresh derived state. */
  private broadcastConfigChanged(): void {
    for (const plugin of this.plugins) {
      plugin.configChanged?.(this.config);
    }
  }

  /** Broadcast the current clock minute (event for UI/timecyc, console log for now). */
  private emitTime(): void {
    const minutes = this.gameClock.minutes;
    this.events.emit('time', { minutes });
    this.logger.log('time', GameClock.format(minutes));
  }

  /** Rebuild the collision overlay for the current region (or clear it when off). */
  private async refreshCollision(): Promise<void> {
    for (const object of this.collisionObjects) {
      this.scene.remove(object);
      disposeObject(object);
    }
    this.collisionObjects.length = 0;
    if (!this.adapter || !this.lastRequest || !this.config.showCollision) {
      return;
    }
    const objects = await this.adapter.loadCollisionDebug(this.lastRequest);
    if (!this.config.showCollision) {
      objects.forEach(disposeObject); // toggled off while awaiting

      return;
    }
    for (const object of objects) {
      this.scene.add(object);
      this.collisionObjects.push(object);
    }
  }

  private start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.renderer.setAnimationLoop((now) => {
      this.renderer.info.reset(); // frame-total draw/triangle counters (autoReset is off — see init)
      const delta = this.clock.tick(now);
      this.accumulator += delta;
      while (this.accumulator >= FIXED_STEP) {
        this.systems.fixedUpdate(FIXED_STEP);
        this.accumulator -= FIXED_STEP;
      }
      this.systems.update(delta);
      this.cameraController.update(delta);
      this.weatherTransition.tick(delta); // ease an in-progress weather change (real-time, runs while paused)
      // The clock only ticks while playing — pausing the game freezes the time of day.
      if (this.config.gameState === 'play' && this.gameClock.advance(delta, this.config.time.secondsPerGameMinute)) {
        this.emitTime();
      }
      if (this.context) {
        for (const plugin of this.plugins) {
          plugin.update?.(this.context);
        }
      }
      this.gpuTimer?.begin('frame');
      if (this.showNormalsMode || this.showFacesMode) {
        // Debug override (normals / wireframe): skip the post-FX pipeline and draw the scene straight to screen.
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.scene, this.camera);
      } else {
        this.pipeline.render();
      }
      this.gpuTimer?.end();
      this.gpuTimer?.poll();
      this.perfMonitor.frame(delta, this.renderer);
    });
  }
}

/**
 * Free GPU geometry/material of an object tree (meshes and line segments alike).
 * Textures are shared/cached — left intact.
 */
function disposeObject(object: Object3D): void {
  object.traverse((node) => {
    const renderable = node as Partial<Mesh>;
    renderable.geometry?.dispose();
    const material = renderable.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
    } else {
      material?.dispose();
    }
  });
}
