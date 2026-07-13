/**
 * Environment drive (plan 074/06 row 14): thin lab wrappers over the SHARED config→Environment driver
 * (`@opensa/game/adapters/engine-environment-driver` — the 074/10 config-API parity module). The lab runs the
 * standalone defaults (no game config) plus its `?fogscale=` camera-altitude compensation.
 */
import type { Engine } from '@opensa/engine';

import { createEngineEnvironmentDriver } from '@opensa/game/adapters/engine-environment-driver';

export interface EnvironmentDriver {
  apply(hour: number): void;
}

/** Fallback parametric arc (no timecyc in the manifest — old paks). */
export function parametricDriver(engine: Engine): EnvironmentDriver {
  return createEngineEnvironmentDriver(engine.environment);
}

/** The real thing: timecyc colours + fog ranges per hour/weather.
 *  The lab camera flies hundreds of units up — radial ground distances dwarf street-level ones, so the
 *  timecyc fog mood needs a scale (`?fogscale=N`, default 2.5); the game host runs it at 1. */
export function timecycDriver(
  engine: Engine,
  timecycText: string,
  is24h: boolean,
  weather: number,
  fogScale = 2.5,
): EnvironmentDriver {
  return createEngineEnvironmentDriver(engine.environment, {
    fogScale,
    timecyc: { is24h, text: timecycText },
    weather,
  });
}
