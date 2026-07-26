/**
 * Scripted physics laps (plan 081/01) — `?phys=<scene|all>&car=<model>`, the `[bench]` runner's twin.
 *
 * A lap drives the car the way a player does: it teleports next to the spot, spawns the model, presses
 * enter/exit and WALKS the ped in through the real sequence, lets the springs settle, then hands the wheel to
 * a {@link ScriptedDriveSource} timeline while the telemetry ring records every fixed step. What comes out is
 * one `[phys] {json}` line per lap — the protocol the headless harness collects and `phys-compare` diffs.
 *
 * Everything outside the timed window (streaming settle, the climb-in, the spring settle) happens with the
 * capture OFF, so a lap's frames are the drive and nothing else.
 */
import { type StreamStats } from '@opensa/engine';
import { summarisePhysFrames, thinFrames } from '@opensa/game/vehicle/phys-capture';
import { type PhysScene, type ScriptedDriveSource } from '@opensa/game/vehicle/scripted-drive';
import { type TelemetryFrame } from '@opensa/game/vehicle/vehicle-telemetry';

import type { EngineVehicles } from './engine-vehicles';

import { PHYS_CARS, PHYS_SCENES } from '../phys-scenes';

/** What a lap needs from the engine host — thin accessors over its loop state, like `PerfRunsHost`. */
export interface PhysRunsHost {
  /** The scripted source installed in the host's CombinedInput; the fixed loop advances its clock. */
  drive: ScriptedDriveSource;
  getStream(): null | StreamStats;
  /** Live accessor — the vehicle system arrives asynchronously after boot. */
  getVehicles(): EngineVehicles | null;
  params: URLSearchParams;
  setHour(hour: number): void;
  /** The streaming-settle deadline after a teleport (the host's world-ready timeout). */
  settleTimeoutMs: number;
  /** Spawn a ground-snapped car of this model at a spot/heading (native GTA Z-up). */
  spawnCar(model: string, position: readonly [number, number, number], heading: number): Promise<void>;
  /** Teleport the player (streaming/collision anchor), GTA coords. */
  teleportPlayer(anchor: readonly [number, number, number]): void;
}

/** Midday: physics does not read the clock, but a capture that also gets screenshotted should be legible. */
const CAPTURE_HOUR = 12;
/** How far to the side of the spot the ped is dropped — clear of the car, close enough to walk in. */
const PED_OFFSET = 4;
/** Springs settle before the capture opens: a ground-snapped car is still moving on its suspension. */
const SETTLE_SECONDS = 2;
/** A climb-in that has not finished by now is a broken spot, not a slow one. */
const ENTER_TIMEOUT_S = 20;
/** Series rate in the printed JSON. Peaks are taken over EVERY frame (see `summarisePhysFrames`), so
 *  thinning costs the curve resolution, never a number. */
const SERIES_HZ = 20;

/** Wire the scripted-lap runner when the URL asks for it; a no-op otherwise. */
export function setupPhysRuns(host: PhysRunsHost): void {
  const key = host.params.get('phys');
  if (!key) {
    return;
  }
  const scenes = key === 'all' ? PHYS_SCENES : PHYS_SCENES.filter((scene) => scene.key === key);
  const car = host.params.get('car') ?? PHYS_CARS[0];
  if (scenes.length === 0) {
    // eslint-disable-next-line no-console -- runner CLI feedback, same protocol as [bench]
    console.warn(`[phys] unknown scene '${key}' — known: all, ${PHYS_SCENES.map((scene) => scene.key).join(', ')}`);

    return;
  }
  void (async (): Promise<void> => {
    for (const scene of scenes) {
      try {
        await runScene(host, scene, car);
      } catch (error) {
        // eslint-disable-next-line no-console -- a lap that failed must SAY so; a missing line reads as a pass
        console.warn(`[phys] scene '${scene.key}' failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // eslint-disable-next-line no-console -- runner CLI feedback, same protocol as [bench]
    console.log('[phys] sweep complete');
  })();
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Hold enter/exit for a moment: the system takes the PRESS edge, so it must also be released. */
async function pressEnterExit(host: PhysRunsHost): Promise<void> {
  host.drive.play([{ actions: ['enterExit'], t: 0 }, { t: 0.25 }]);
  await until(() => host.drive.time > 0.3, 2000);
}

function report(scene: PhysScene, car: string, frames: readonly TelemetryFrame[]): void {
  const capture = {
    car,
    // Column-named so a reader (and phys-compare) never has to count positions.
    columns: ['t', 'speed', 'slipAngle', 'pitch', 'roll', 'yawRate', 'gLong', 'gLat', 'gVert', 'throttle', 'steer'],
    key: scene.key,
    series: thinFrames(frames, SERIES_HZ).map((frame) =>
      [
        frame.t,
        frame.speed,
        frame.slipAngle,
        frame.pitch,
        frame.roll,
        frame.yawRate,
        frame.gLong,
        frame.gLat,
        frame.gVert,
        frame.throttle,
        frame.steer,
      ].map((value) => Number(value.toFixed(4))),
    ),
    seriesHz: SERIES_HZ,
    summary: summarisePhysFrames(frames),
    what: scene.what,
  };
  // eslint-disable-next-line no-console -- the capture deliverable IS this JSON line (the [bench] twin)
  console.log('[phys]', JSON.stringify(capture));
}

async function runScene(host: PhysRunsHost, scene: PhysScene, car: string): Promise<void> {
  const vehicles = host.getVehicles();
  if (!vehicles) {
    throw new Error('no vehicle system on this host');
  }
  host.setHour(CAPTURE_HOUR);
  // The ped stands to the car's RIGHT of the road heading, so the spawn never lands on top of him.
  const [x, y, z] = scene.position;
  host.teleportPlayer([x + Math.cos(scene.heading) * PED_OFFSET, y + Math.sin(scene.heading) * PED_OFFSET, z + 1]);
  // Settle: the collision cell under the spot must exist before a car is dropped into it (the bench
  // teleport contract — a car spawned into an unstreamed cell falls through the world).
  await until(() => host.getStream()?.pendingCells === 0, host.settleTimeoutMs);
  await host.spawnCar(car, scene.position, scene.heading);

  await pressEnterExit(host);
  const seated = await until(() => vehicles.activeVehicle() !== null && !vehicles.isSettling(), ENTER_TIMEOUT_S * 1000);
  host.drive.stop();
  if (!seated) {
    throw new Error(`the ped never got into the ${car} (bad spawn spot?)`);
  }
  await until(() => false, SETTLE_SECONDS * 1000); // let the suspension stop moving

  vehicles.telemetry.reset();
  vehicles.telemetry.enabled = true;
  host.drive.play(scene.timeline);
  await until(() => host.drive.time >= scene.durationS, (scene.durationS + 10) * 1000);
  host.drive.stop();
  const frames = vehicles.telemetry.frames();
  vehicles.telemetry.enabled = false;

  report(scene, car, frames);

  // Climb back out, so the next lap's teleport moves a ped and not a seated rider.
  await pressEnterExit(host);
  await until(() => vehicles.activeVehicle() === null, ENTER_TIMEOUT_S * 1000);
  host.drive.stop();
}

/** Wait until `ready()` or the deadline; returns whether it became ready. */
async function until(ready: () => boolean, timeoutMs: number): Promise<boolean> {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (ready()) {
      return true;
    }
    await nextFrame();
  }

  return ready();
}
