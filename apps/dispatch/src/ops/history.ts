/**
 * The board as it was (201/8-03): unit tracks plus the calls' own history, resolved into an `Operations`
 * snapshot for any moment the clock is at.
 *
 * **The whole of replay is one substitution.** Nothing downstream of `read.ops()` knows the clock exists —
 * the map loop, the symbology, the panels and the detail card all take the board they always took, and when
 * the operator scrubs they are handed the board OF THAT MOMENT instead of the live one. That is the payoff
 * of 8/01's decision to keep time out of `Unit` and in a store beside it: a resolved snapshot is the same
 * shape as a live one, so there is no second rendering path to maintain.
 *
 * A unit and a call need different histories, because they change differently. A unit MOVES, continuously,
 * and is sampled ({@link UnitTracks}). A call does not move at all — it changes STATUS, a handful of times
 * in its life — so its history is an event list, which is both smaller and exact.
 */
import type { Incident, IncidentStatus, Operations, Unit } from './types';

import { UnitTracks } from './tracks';

/** What the history is holding, for `?inventory=1`. */
export interface HistoryStats {
  /** Host bytes: the unit tracks' rings plus a rough count of the call events. */
  readonly bytes: number;
  readonly capacity: number;
  /** Recorded call transitions across every call of the shift. */
  readonly incidentEvents: number;
  readonly samples: number;
  readonly tracks: number;
  readonly window: null | readonly [number, number];
}

/** One recorded change to a call. Its position never changes, so nothing here carries one. */
interface IncidentEvent {
  readonly assigned: readonly string[];
  readonly status: IncidentStatus;
  readonly t: number;
}

/** Bytes an event costs, accounted the way the tracks are: t + status + a short id list. A call changes
 *  state a handful of times in its life, so this is an estimate of a rounding error, and it is labelled
 *  one rather than being left out of the total. */
const BYTES_PER_EVENT = 64;

export class BoardHistory {
  private readonly incidents = new Map<string, { events: IncidentEvent[]; incident: Incident }>();
  private readonly tracks = new UnitTracks();

  /**
   * The board at wall time `t`.
   *
   * Units come from their tracks; a unit with no sample at all is dropped rather than drawn at a position
   * nobody recorded. Calls that had not been opened yet are not on the board, and the ones that had carry
   * the status they had. The log is left as the live one's — a scrub is for the map and the roster, and a
   * reconstructed ticker would be a second source of truth for what was said.
   */
  at(t: number, live: Operations): Operations {
    const units: Unit[] = [];
    for (const unit of live.units) {
      const state = this.tracks.at(unit.id, t);
      if (state) {
        units.push({ ...unit, at: state.at, heading: state.heading, status: state.status });
      }
    }
    const incidents: Incident[] = [];
    for (const { events, incident } of this.incidents.values()) {
      if (incident.opened > t) {
        continue;
      }
      const event = lastAtOrBefore(events, t);
      incidents.push(event ? { ...incident, assigned: event.assigned, status: event.status } : incident);
    }

    return { ...live, incidents, now: t, units };
  }

  /** Take one board snapshot. Called once per tick; the policies decide what actually lands. */
  record(ops: Operations): void {
    this.tracks.record(ops);
    for (const incident of ops.incidents) {
      const held = this.incidents.get(incident.id);
      if (!held) {
        this.incidents.set(incident.id, {
          events: [{ assigned: incident.assigned, status: incident.status, t: ops.now }],
          incident,
        });
        continue;
      }
      const last = held.events[held.events.length - 1];
      if (last.status !== incident.status || !sameIds(last.assigned, incident.assigned)) {
        held.events.push({ assigned: incident.assigned, status: incident.status, t: ops.now });
      }
    }
  }

  stats(): HistoryStats {
    const track = this.tracks.stats();
    let incidentEvents = 0;
    for (const held of this.incidents.values()) {
      incidentEvents += held.events.length;
    }

    return { ...track, bytes: track.bytes + incidentEvents * BYTES_PER_EVENT, incidentEvents };
  }

  /** The span a scrub may ask for, or null while nothing has been recorded. */
  window(): null | { newest: number; oldest: number } {
    const held = this.tracks.stats().window;

    return held ? { newest: held[1], oldest: held[0] } : null;
  }
}

/** The last event at or before `t`, or null when the call had not changed yet. */
function lastAtOrBefore(events: readonly IncidentEvent[], t: number): IncidentEvent | null {
  let found: IncidentEvent | null = null;
  for (const event of events) {
    if (event.t > t) {
      break;
    }
    found = event;
  }

  return found;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
