import { AmbientLight, DirectionalLight, HemisphereLight, MathUtils, type Scene, Vector3 } from 'three';

import type { System } from '../core/system';
import type { NightConfig } from '../interfaces/config.interface';

import { setSkyColor, SKY_LIGHT_TUNING, type SkySample } from './sky.plugin';
import { sunElevationAt } from './sun-position';

/**
 * Minimal sun/ambient light rig for the WebGPU mode (plan 073/03 slice A). Plugins are skipped under `?webgpu=1`
 * (they author GLSL), so nothing creates lights or tracks the sun — dynamics render black and the world-material
 * uniform drive reads a dead sun direction. This SYSTEM (systems still run) reuses the SkyPlugin's pure pieces:
 * `sunElevationAt` for the arc, the timecyc sample for colours, {@link SKY_LIGHT_TUNING} for intensities — no
 * dome/LUT/shadow visuals (those are later slices). Exposes the same signals the canvas-host uniform block needs
 * (`sunDirection`, `nightFactor`, the sun light for its shadow handle).
 */
export class SkyLiteSystem implements System {
  readonly ambient = new AmbientLight(0xffffff, 1);

  readonly name = 'sky-lite';
  readonly skylight = new HemisphereLight(SKY_LIGHT_TUNING.nightSkyColor, SKY_LIGHT_TUNING.nightGroundColor, 0);
  readonly sun = new DirectionalLight(0xffffff, 0);

  private readonly getHour: () => number;
  private readonly moonDir = new Vector3(0, 1, 0);
  private readonly moonElevationDeg: () => number;
  private night = 1;
  private readonly nightConfig: () => NightConfig;
  private readonly sample: (hour: number) => SkySample;
  private readonly sunDir = new Vector3(0, -1, 0);

  constructor(
    sample: (hour: number) => SkySample,
    getHour: () => number,
    nightConfig: () => NightConfig,
    moonElevationDeg: () => number,
  ) {
    this.sample = sample;
    this.getHour = getHour;
    this.nightConfig = nightConfig;
    this.moonElevationDeg = moonElevationDeg;
    // r185: a castShadow light with a never-rendered map binds a non-depth fallback into the shadow sampler and
    // drops every lit receiveShadow draw (see sky/csm plugins). Shadows arrive with plan 073/05 — keep it off.
    this.sun.castShadow = false;
  }

  /** Add the rig to the scene (canvas-host calls this once — systems have no install hook). */
  addTo(scene: Scene): void {
    scene.add(this.ambient, this.skylight, this.sun, this.sun.target);
  }

  /** Unit direction toward the moon (three world space) — the SkyPlugin's fixed azimuth + config elevation. */
  moonDirection(): Vector3 {
    return this.moonDir;
  }

  /** 0 day → 1 deep night (sun height) — same curve as the SkyPlugin. */
  nightFactor(): number {
    return this.night;
  }

  /** Unit sun direction (towards the sun); points down when the sun is below the horizon. */
  sunDirection(): Vector3 {
    return this.sunDir;
  }

  /** Sine of the sun's elevation (1 zenith → negative below the horizon): the driver of every time band. */
  sunSin(): number {
    return this.sunDir.y;
  }

  update(): void {
    const night = this.nightConfig();
    const { dir, elevation } = sunElevationAt(this.getHour(), night.litFade.dawnStart, night.litFade.duskEnd);
    this.sunDir.set(dir[0], dir[1], dir[2]);
    const above = elevation > 0;
    const height = Math.max(0, this.sunDir.y);
    this.night = 1 - MathUtils.smoothstep(height, 0, 0.22);

    const sky = this.sample(this.getHour());
    // Same recipe as SkyPlugin.apply (minus overcast — weather integration is a later slice): timecyc sun colour,
    // √height brightness arc, warm object-ambient by day, hemisphere skylight cross-fading to the cool night fill.
    setSkyColor(this.sun.color, sky.dir, true);
    this.sun.intensity = above ? SKY_LIGHT_TUNING.sunIntensity * Math.sqrt(height) : 0;
    this.sun.position.copy(this.sunDir).multiplyScalar(100);
    setSkyColor(this.ambient.color, sky.ambObj, true);
    this.ambient.intensity =
      SKY_LIGHT_TUNING.ambientNight + (SKY_LIGHT_TUNING.ambientDay - SKY_LIGHT_TUNING.ambientNight) * (1 - this.night);
    this.skylight.color.copy(SKY_LIGHT_TUNING.daySkyColor).lerp(SKY_LIGHT_TUNING.nightSkyColor, this.night);
    this.skylight.groundColor.copy(SKY_LIGHT_TUNING.dayGroundColor).lerp(SKY_LIGHT_TUNING.nightGroundColor, this.night);
    this.skylight.intensity = SKY_LIGHT_TUNING.daySkylight * (1 - this.night) + night.skylight * this.night;

    // Moon: the SkyPlugin's fixed sky direction (azimuth const × config elevation) for the world moon term.
    const moonEl = MathUtils.degToRad(this.moonElevationDeg());
    const cosEl = Math.cos(moonEl);
    this.moonDir
      .set(SKY_LIGHT_TUNING.moonAzimuth.x * cosEl, Math.sin(moonEl), SKY_LIGHT_TUNING.moonAzimuth.z * cosEl)
      .normalize();
  }
}
