/**
 * The game's runtime `Config` (extracted from `canvas-host.tsx` 2026-07-13 so the own-engine host
 * (plan 074/10 B3, `?engine=opensa`) reuses the SAME controls/movement/streaming/graphics values as the
 * three-WebGL path — behavioural parity by construction, one source of truth).
 */
import type { Config } from '@opensa/game/interfaces/config.interface';

const BASE = import.meta.env.VITE_STATIC_URL;

/** Streaming grid cell edge — shared by Config.streaming + the adapter; MUST match opensa-lod-generator's
 *  cellSize (its baked lod_<cx>_<cy> cells map 1:1 onto engine cells). */
/**
 * The GAME-side cell grid: collision streaming, procobj scatter, LOD-impostor placement.
 *
 * Distinct from the RENDER grid — opensa-pack welds `.oscell` blobs on its own `CELL_SIZE` (250) and the
 * manifest carries that to the engine. The two have never matched and nothing requires them to.
 */
export const GAME_CELL_SIZE = 256;

export function createGameRuntimeConfig(): Config {
  return {
    camera: {
      followDistance: 7,
      followHeight: 1.2,
      followLerp: 3,
      followMaxPolar: Math.PI / 2 - 0.05,
      followMinPolar: 0.25,
      followPolar: 1.15,
      followZoom: true,
      followZoomMax: 10,
      followZoomMin: 4,
    },
    // 088/03: RUN is the default gait (SA jogs); Shift sprints. `walk` is left unbound — the slow tier
    // is reachable by a partial touch-stick deflection, or bind a key here.
    controls: { back: 'KeyS', forward: 'KeyW', jump: 'Space', left: 'KeyA', right: 'KeyD', sprint: 'ShiftLeft' },
    fog: { distance: 800, timecycScale: 1 },
    fonts: { hud: { clock: 'SixCaps-Regular', zone: 'SixCaps-Regular' } },
    gameState: 'play',
    graphics: {
      bloom: { enabled: true, intensity: 0.7, threshold: 0.7 },
      clouds: { coverage: 0.5, opacity: 0.85, volumetric: false },
      // World 2dfx particle effects (plan 044) — drawDistance replaces the systems' authored
      // CULLDIST (vanilla culls fire at 35 m — too close).
      effects: { drawDistance: 150, enabled: true },
      headlights: {
        beamIntensity: 2.2,
        beamRange: 34,
        brakeIntensity: 1.6,
        coronaIntensity: 0.8,
        coronaSize: 0.28,
        intensity: 1,
      },
      lights: { enabled: true, nightEndHour: 6, nightStartHour: 20 },
      moon: { brightness: 1, elevationDeg: 5, size: 55 },
      night: {
        coronaDrawDistance: 120,
        dynamicObjectsFill: { rim: 0.1, strength: 0.8 }, // plan 034: dynamic-object night fill
        emissiveBoost: 1.6,
        litFade: { dawnEnd: 7, dawnStart: 6, duskEnd: 20, duskStart: 19 },
        skyGlow: 1,
        skylight: 0.6,
        windowGlow: 1.0,
      },
      // Rendering-overhaul master switch (plan 063). DEFAULT-FLIPPED to 'modern' (2026-07-10): the whole
      // chain (064–071) is on by default — hybrid sun, CSM shadows, PBR sky+LUT, unified fog, local lights,
      // night emissives. Volumetric clouds stay OFF (heavy; ultra-tier). The formal quality-tier ladder +
      // budget contract is plan 072, PARKED for now — this is a straight "everything but volumetric" flip.
      pipeline: 'modern',
      // Procedural ground clutter (procobj.dat; plan 042) — per-category, live-tunable in debug → ProcObj.
      procobj: {
        bushes: { density: 1, drawDistance: 80, enabled: true },
        cacti: { density: 1, drawDistance: 100, enabled: true },
        flowers: { density: 1, drawDistance: 50, enabled: true },
        grass: { density: 1, drawDistance: 50, enabled: true },
        rocks: { density: 1, drawDistance: 80, enabled: true },
        trees: { density: 1, drawDistance: 150, enabled: true },
        underwater: { density: 1, drawDistance: 60, enabled: true },
      },
      renderScale: 1,
      shadows: { distance: 800, enabled: true },
      sky: { density: 0.96, exposure: 0.5, model: 'pbr', mood: 0.7, pbrExposure: 0.55, weight: 0.4 },
      ssao: { enabled: true, intensity: 1.5, radius: 0.2 },
      stars: { enabled: true },
      sun: { godrays: true, godraysSize: 30, sunSize: 15 },
      toneMapping: true,
      toneMappingMode: 'aces',
      vehicleReflection: { intensity: 0.25, preset: 'enhanced' },
      water: {
        darkness: 0.9,
        foam: 1,
        glint: 0.5,
        reflection: 0.2,
        shore: true,
        shoreClarity: 0.55,
        shoreDepth: 6,
        waves: 1,
      },
      // SA prelit world (plan 038) calibration — live-tunable in debug → Atmosphere.
      worldLight: {
        dayBrightness: 0.85,
        duskBrightness: 0.45,
        lodNightAmbScale: 1.6,
        nightPrelitBrightness: 0.7,
        shadowStrength: 0.55,
        sunDirect: 1,
        sunIndirect: 0.7,
      },
    },
    hud: {
      clock: { borderColor: '#000', borderWidth: 1, color: '#fff', fontSize: 52 },
      zone: { borderColor: '#000', borderWidth: 1, color: '#fff', fontSize: 40 },
    },
    mapViewer: false,
    // Turn rates (plan 088/01): near-idle spins snappily, the top tier arcs at a third of that.
    // Jump (plan 088/04): jumpSpeed 4.5 → apex ≈ 1.03 m, air ≈ 0.92 s (3.5 gave a weak 0.62 m hop).
    // accel 14 (field 2026-07-24, was 20): 0→run in ~0.5 s — the start stopped ripping; decel stays
    // higher so stopping keeps its snap.
    movement: {
      accel: 14,
      airControl: 0.3,
      // 2.2 covers the full fall_front (0.73 s) + getup_front (1.37 s) chain — a shorter recovery
      // CUT the riser mid-motion and popped to idle.
      collapseRecoverySeconds: 2.2,
      collapseSpeed: 16,
      coyoteSeconds: 0.12,
      deceleration: 25,
      hardLandRecoverySeconds: 0.5,
      hardLandSpeed: 12,
      jumpBufferSeconds: 0.15,
      jumpSpeed: 4.5,
      landRecoverySeconds: 0.15,
      launchDelaySeconds: 0.1,
      runSpeed: 7,
      // 40° (field 2026-07-24, was 45): the LS river banks (~42°) must slide — 45 left the ped
      // standing on them, and jump-laddering up any hillside worked.
      slideSlopeDeg: 40,
      sprintSpeed: 10,
      turnRateFullDeg: 240,
      turnRateIdleDeg: 720,
      walkSpeed: 2,
    },
    showCollision: false,
    // Diagnostics off by default. Flip to 'debug' | 'log' | 'warn' | 'error' here to stream
    // gated `log` events to the console; filter by `type` in the subscriber below.
    showLogs: false,
    staticUrl: BASE,
    // lodDrawDistance kept just past fog.distance (800): geometry is culled shortly after it's fully
    // fogged, so the distant skyline isn't rendered as pale ghosts (and it's cheaper).
    streaming: { cellSize: GAME_CELL_SIZE, collisionDrawDistance: 150, hdDrawDistance: 300, lodDrawDistance: 1000 },
    time: { secondsPerGameMinute: 1.5 },
    vehicle: { hdDistance: 80, lodDistance: 250, unloadDistance: 500 },
    weatherTransitionSeconds: 6,
  };
}
