/**
 * Which audio zone the listener is standing in (203/4-01).
 *
 * SA picks its ambience by AUDIO ZONE — `CAEAmbienceTrackManager` reads `CAudioZones`, and those zones are
 * the `AUZO` rows of the IPLs, which the pak build bakes into `audio.osaudio`. The census of 2026-09-09
 * found **155 of them, all in one file** (`audiozon.ipl`): 152 boxes, 3 spheres, 151 active.
 *
 * **A linear scan, and that is the right answer at this size.** 155 point tests at ten a second is nothing,
 * and a spatial index would be a structure to keep in sync with a table that changes once per build. If a
 * total conversion ever ships thousands, the shape of the fix is a grid — and the report's zone count is
 * what would say so.
 *
 * **The smallest containing zone wins**, which is the same rule the named districts use for `info.zon`'s
 * nested boxes (201/5-03). Zones overlap on purpose — a club sits inside a district — and the inner one is
 * the one whose sound the author meant.
 */
import type { OsaudioZone } from '@opensa/engine-formats';

import type { Vec3 } from './spatial';

/**
 * The zone the point is in, or `null` for the open world.
 *
 * Inactive zones are skipped: `flags == 1` is what the game passes as `isActive`, and anything else starts
 * the zone switched off. Nothing in this chain switches one on — if that ever arrives it belongs with the
 * event table, and this function grows a parameter rather than a second implementation.
 */
export function audioZoneAt(zones: readonly OsaudioZone[], point: Vec3): null | OsaudioZone {
  let best: null | OsaudioZone = null;
  let bestVolume = Number.POSITIVE_INFINITY;
  for (const zone of zones) {
    if (!zone.active || !contains(zone, point)) {
      continue;
    }
    const volume = volumeOf(zone);
    if (volume < bestVolume) {
      best = zone;
      bestVolume = volume;
    }
  }

  return best;
}

/** Whether a point is inside one zone. */
export function contains(zone: OsaudioZone, point: Vec3): boolean {
  if (zone.shape === 'sphere') {
    return Math.hypot(point[0] - zone.centre[0], point[1] - zone.centre[1], point[2] - zone.centre[2]) <= zone.radius;
  }
  // The IPL row states two corners and does not promise which is which — a row with its Z pair the other way
  // round is a zone nobody could ever be inside, and it would be silent rather than wrong.
  for (let axis = 0; axis < 3; axis += 1) {
    const low = Math.min(zone.min[axis] ?? 0, zone.max[axis] ?? 0);
    const high = Math.max(zone.min[axis] ?? 0, zone.max[axis] ?? 0);
    const value = point[axis] ?? 0;
    if (value < low || value > high) {
      return false;
    }
  }

  return true;
}

/** How big a zone is, for the smallest-wins rule. */
function volumeOf(zone: OsaudioZone): number {
  if (zone.shape === 'sphere') {
    return (4 / 3) * Math.PI * zone.radius ** 3;
  }

  return [0, 1, 2].reduce((total, axis) => total * Math.abs((zone.max[axis] ?? 0) - (zone.min[axis] ?? 0)), 1);
}
