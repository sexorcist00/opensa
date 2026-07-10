import type { DirectionalLightShadow, Matrix4, PerspectiveCamera, Texture, Vector2 } from 'three';

import { DirectionalLight, Vector3 } from 'three';

import type { Plugin, PluginContext } from './plugin';

import { needsRefresh, type RefreshState, shadowDistanceFactor, sliceSphere, splitRanges } from '../shadows/csm-math';

/**
 * Cascaded sun shadows (plan 065). Slot 0 is the SkyPlugin sun's own per-frame 45 m map (dynamics + near
 * HD); this plugin owns slots 1–2: two intensity-0 `DirectionalLight`s whose only job is their shadow maps
 * — three renders them with proper depth materials (alpha-tested foliage works), while `autoUpdate=false`
 * + the {@link needsRefresh} schedule gives the static-caster caching the plan demands (mid/far cascades
 * re-render on sun rotation / camera travel, not every frame). The world material samples all three via
 * `worldCsmUniforms` (mirrored here through the injected sink — packages/game stays renderware-free).
 */

/** The world material's CSM uniform surface (structurally matches renderware's `worldCsmUniforms`). */
export interface CsmUniformSink {
  uCsmMaps: { value: (null | Texture)[] };
  uCsmMapSize: { value: Vector2 };
  uCsmMatrices: { value: Matrix4[] };
  uCsmMix: { value: number };
  uCsmSplits: { value: { set(x: number, y: number, z: number): unknown } };
}

/** Shadow-render layer for DYNAMIC casters (player/vehicles) — the near map renders ONLY these. */
export const CSM_DYNAMIC_LAYER = 1;
/** Shadow-render layer for STATIC world casters (streamed cells) — the cached cascades render ONLY these. */
export const CSM_STATIC_LAYER = 2;

/** Dynamic-caster overlay range = the sun map's ortho half-extent (SkyPlugin SHADOW_SIZE). */
const NEAR_SPLIT = 45;
/** Mid/far cascade shadow-map resolution (the near map is the sun's own 2048). */
const CASCADE_MAP = 2048;
/** Uniform↔logarithmic split blend for the mid/far ranges. */
const SPLIT_LAMBDA = 0.5;
/** How far up-sun the cascade camera sits beyond the slice radius (covers tall casters up-light). */
const CAMERA_BACKUP = 400;
/** Coverage margin over the strict slice sphere — the leading edge stays covered between refreshes. */
const FIT_MARGIN = 1.3;
/** Velocity lookahead (seconds): shift the fit centre along the camera velocity so fast travel (driving,
 *  flyovers) renders shadows AHEAD of the view instead of trailing it (same idea as streaming's plan 060). */
const LOOKAHEAD_S = 0.4;

const WORLD_UP = new Vector3(0, 1, 0);
const WORLD_X = new Vector3(1, 0, 0);
const scratchForward = new Vector3();
const scratchRight = new Vector3();
const scratchUp = new Vector3();
const scratchCenter = new Vector3();
const scratchView = new Vector3();
const scratchVelocity = new Vector3();
const scratchLookahead = new Vector3();
const scratchPrevCam = new Vector3();

interface Cascade {
  lastRadius: number;
  light: DirectionalLight;
  state: null | RefreshState;
}

export class CsmPlugin implements Plugin {
  readonly name = 'csm';

  private readonly cascades: Cascade[] = [];
  private readonly getNearShadow: () => DirectionalLightShadow;
  private readonly getSunDir: () => Vector3;
  private readonly getWorldVersion: () => number;
  private hasPrevCam = false;
  private lastWorldVersion = -1;
  private readonly sink: CsmUniformSink;

  constructor(
    getSunDir: () => Vector3,
    getNearShadow: () => DirectionalLightShadow,
    sink: CsmUniformSink,
    getWorldVersion: () => number,
  ) {
    this.getSunDir = getSunDir;
    this.getNearShadow = getNearShadow;
    this.sink = sink;
    this.getWorldVersion = getWorldVersion;
  }

  install(context: PluginContext): void {
    // The sun's own map stays DYNAMICS-ONLY (its per-frame render must not pay thousands of static
    // casters): its shadow camera sees only the dynamic layer. The caster system tags entities into it.
    this.getNearShadow().camera.layers.set(CSM_DYNAMIC_LAYER);
    for (let index = 0; index < 2; index += 1) {
      // Intensity 0: the light exists only for its shadow map — it must not light anything (the lit
      // dynamics keep their single real sun; a zero light contributes zero regardless of its shadow).
      const light = new DirectionalLight(0xffffff, 0);
      light.castShadow = true;
      light.shadow.mapSize.set(CASCADE_MAP, CASCADE_MAP);
      light.shadow.autoUpdate = false; // rendered on the needsRefresh schedule only
      light.shadow.camera.near = 1;
      light.shadow.camera.layers.set(CSM_STATIC_LAYER); // static world only — dynamics would go stale in the cache
      light.shadow.bias = -0.0004;
      context.scene.add(light, light.target);
      this.cascades.push({ lastRadius: 0, light, state: null });
    }
    this.sink.uCsmMapSize.value.set(CASCADE_MAP, CASCADE_MAP);
  }

  update(context: PluginContext): void {
    const { pipeline, shadows } = context.config.graphics;
    const nearShadow = this.getNearShadow();
    // The near map's autoUpdate is the SkyPlugin's "sun is actually casting now" signal (night/overcast off).
    const active = pipeline === 'modern' && shadows.enabled && nearShadow.autoUpdate;
    if (!active) {
      this.sink.uCsmMix.value = 0;

      return;
    }
    const sunDir = this.getSunDir();
    const camera = context.camera;
    const maxDistance = shadows.distance * shadowDistanceFactor(Math.max(0, sunDir.y));
    // The STATIC cascades cover the whole range from the camera (the near map is only a dynamics overlay).
    const ranges = splitRanges(1, Math.max(maxDistance, NEAR_SPLIT * 2), 2, SPLIT_LAMBDA);
    this.sink.uCsmSplits.value.set(NEAR_SPLIT, ranges[0].far, ranges[1].far);

    // World-change invalidation, SETTLE-gated: the host reports -1 while streaming is in flight (a flyover
    // adds/removes cells every frame — forcing a refresh per change would defeat the cache and spike the
    // frame). One forced refresh fires when the world settles with a different cell set.
    const worldVersion = this.getWorldVersion();
    const worldChanged = worldVersion >= 0 && worldVersion !== this.lastWorldVersion;
    if (worldVersion >= 0) {
      this.lastWorldVersion = worldVersion;
    }

    // Camera velocity estimate → lookahead (shadows render ahead of fast travel, not trailing it).
    const dt = Math.max(context.clock.delta, 1e-3);
    if (this.hasPrevCam) {
      scratchVelocity.copy(camera.position).sub(scratchPrevCam).divideScalar(dt);
    } else {
      scratchVelocity.set(0, 0, 0);
      this.hasPrevCam = true;
    }
    scratchPrevCam.copy(camera.position);

    camera.getWorldDirection(scratchView);
    // Stagger: at most ONE static-cascade re-render per frame (both due → far waits a frame).
    let refreshed = false;
    for (const [index, range] of ranges.entries()) {
      refreshed = this.fitCascade(this.cascades[index], camera, range.near, range.far, sunDir, worldChanged, refreshed);
    }

    // Mirror the maps/matrices into the world material — matrices BY REFERENCE: three refreshes
    // `shadow.matrix` during the shadow render (after this update), so a copy would lag one frame and
    // the receive would sample with stale coords (shadows flicker/vanish while the camera moves).
    const maps = this.sink.uCsmMaps.value;
    const matrices = this.sink.uCsmMatrices.value;
    maps[0] = nearShadow.map?.texture ?? null;
    matrices[0] = nearShadow.matrix;
    for (const [index, cascade] of this.cascades.entries()) {
      maps[index + 1] = cascade.light.shadow.map?.texture ?? null;
      matrices[index + 1] = cascade.light.shadow.matrix;
    }
    this.sink.uCsmMix.value = maps[0] && maps[1] && maps[2] ? 1 : 0;
  }

  /** Stable-fit one cascade (slice bounding sphere + texel snap) and schedule its re-render if stale.
   *  Returns whether a re-render was scheduled (the caller staggers refreshes across frames). */
  private fitCascade(
    cascade: Cascade,
    camera: PerspectiveCamera,
    near: number,
    far: number,
    sunDir: Vector3,
    force: boolean,
    skipBudget: boolean,
  ): boolean {
    const fit = sliceSphere(camera.fov, camera.aspect, near, far);
    const radius = fit.radius * FIT_MARGIN;
    scratchCenter.copy(camera.position).addScaledVector(scratchView, fit.centerDistance);
    // Lookahead along the camera velocity, clamped inside the margin so the strict slice stays covered.
    const lookahead = Math.min(scratchVelocity.length() * LOOKAHEAD_S, fit.radius * (FIT_MARGIN - 1));
    if (lookahead > 0.001) {
      scratchLookahead.copy(scratchVelocity).normalize();
      scratchCenter.addScaledVector(scratchLookahead, lookahead);
    }

    // Texel snap in the light's right/up basis (same trick as the SkyPlugin near map — kills shimmer).
    scratchForward.copy(sunDir).negate();
    scratchRight.crossVectors(scratchForward, Math.abs(scratchForward.y) > 0.99 ? WORLD_X : WORLD_UP).normalize();
    scratchUp.crossVectors(scratchRight, scratchForward).normalize();
    const texel = (2 * radius) / CASCADE_MAP;
    const r = Math.round(scratchCenter.dot(scratchRight) / texel) * texel;
    const u = Math.round(scratchCenter.dot(scratchUp) / texel) * texel;
    const f = scratchCenter.dot(scratchForward);
    scratchCenter
      .set(0, 0, 0)
      .addScaledVector(scratchRight, r)
      .addScaledVector(scratchUp, u)
      .addScaledVector(scratchForward, f);

    const center: [number, number, number] = [scratchCenter.x, scratchCenter.y, scratchCenter.z];
    const sun: [number, number, number] = [sunDir.x, sunDir.y, sunDir.z];
    const radiusChanged = Math.abs(radius - cascade.lastRadius) > cascade.lastRadius * 0.05;
    if (!force && !radiusChanged && !needsRefresh(cascade.state, center, sun, radius)) {
      return false; // cached map still valid — the whole point (static-caster caching)
    }
    if (skipBudget) {
      cascade.state = null; // due but deferred — guarantee it renders next frame

      return true;
    }
    // Re-fit the camera ONLY when re-rendering, so the sampled matrix always matches the frozen map.
    const shadowCam = cascade.light.shadow.camera;
    shadowCam.left = -radius;
    shadowCam.right = radius;
    shadowCam.top = radius;
    shadowCam.bottom = -radius;
    shadowCam.far = radius * 2 + CAMERA_BACKUP;
    shadowCam.updateProjectionMatrix();
    cascade.light.target.position.copy(scratchCenter);
    cascade.light.position.copy(scratchCenter).addScaledVector(sunDir, radius + CAMERA_BACKUP);
    cascade.light.target.updateMatrixWorld();
    cascade.light.updateMatrixWorld();
    cascade.light.shadow.needsUpdate = true;
    cascade.state = { center, sunDir: sun };
    cascade.lastRadius = radius;

    return true;
  }
}
