/**
 * The board's own events, derived from two snapshots of it (204/3-01).
 *
 * **This is the `map` category and the console owns it** ([the contract](../../../../docs/contracts/panel-audio.md)),
 * on the test that separates the categories: *can the console see it in the board it already holds?* It can
 * see a call appear, a unit commit to one, a unit reach its scene and a call clear — and PCAD raises no
 * trigger for three of those four today.
 *
 * **Pure, and a diff rather than a subscription.** The board arrives as an immutable snapshot on the audio
 * clock's own schedule, so the only way to know what CHANGED is to have kept the last one. That also makes
 * the whole thing testable by handing it two objects, which is the shape every rule in this repository
 * prefers to a callback nobody can inspect.
 */
import type { Incident, Operations, Unit } from '../ops/types';

/** The names this can raise, in the order the contract lists them. */
export type BoardEvent =
  | 'call_closed'
  | 'call_created_p1'
  | 'call_created_p2'
  | 'call_created_p3'
  | 'unit_arrived'
  | 'unit_assigned';

/**
 * What changed between two boards, as event names.
 *
 * A first call (no previous board) raises NOTHING: every unit and every call on it is *already there*
 * rather than newly arrived, and a console that announced its whole roster at open would be a console
 * somebody mutes in the first minute.
 */
export function boardEvents(previous: null | Operations, next: Operations): readonly BoardEvent[] {
  if (previous === null) {
    return [];
  }
  const events: BoardEvent[] = [];
  const before = new Map(previous.incidents.map((incident) => [incident.id, incident]));
  for (const incident of next.incidents) {
    const was = before.get(incident.id);
    if (!was) {
      events.push(created(incident));
      continue;
    }
    if (was.status !== 'closed' && incident.status === 'closed') {
      events.push('call_closed');
    }
  }

  const units = new Map(previous.units.map((unit) => [unit.id, unit]));
  for (const unit of next.units) {
    const was = units.get(unit.id);
    if (!was) {
      // A unit that appears mid-shift is coming on duty, which is not a dispatch event and has no sound in
      // the contract. It is named here so the next reader knows it was considered rather than missed.
      continue;
    }
    // Any CHANGE of commitment, not only leaving patrol: `assignUnit` moves a unit straight from one call
    // to another, and a dispatcher re-directing a unit mid-run is exactly the moment worth hearing.
    if (unit.incident !== null && was.incident !== unit.incident) {
      events.push('unit_assigned');
    }
    if (arrived(was, unit)) {
      events.push('unit_arrived');
    }
  }

  return events;
}

/** Whether a unit reached its scene on this tick. */
function arrived(was: Unit, now: Unit): boolean {
  return was.status !== 'onScene' && now.status === 'onScene';
}

/** A new call, coded by its priority — the visuals carry it three ways and so must this. */
function created(incident: Incident): BoardEvent {
  if (incident.priority === 1) {
    return 'call_created_p1';
  }

  return incident.priority === 2 ? 'call_created_p2' : 'call_created_p3';
}
