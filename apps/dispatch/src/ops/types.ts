/**
 * The dispatch domain. Deliberately tiny and renderer-free: nothing here knows about WebGPU, the pak or the
 * camera, so the whole operations model can be unit-tested and later swapped for a real backend feed without
 * touching the map.
 */
import type { GtaGround } from '../map/coords';

export interface Incident {
  /** Unit ids currently working it. */
  readonly assigned: readonly string[];
  readonly at: GtaGround;
  /** The radio code a dispatcher actually says out loud ("10-50", "10-31"). */
  readonly code: string;
  readonly id: string;
  /** `performance.now()` at creation — the panels age it into "3m ago". */
  readonly opened: number;
  /** Nearest named place, for the address line. */
  readonly place: string;
  readonly priority: IncidentPriority;
  /** Seconds of work still needed once a unit is on scene; the sim counts it down. */
  readonly remaining: number;
  readonly status: IncidentStatus;
  readonly title: string;
}

/** 1 = life at risk (roll everything), 2 = urgent, 3 = routine. */
export type IncidentPriority = 1 | 2 | 3;

export type IncidentStatus = 'assigned' | 'closed' | 'onScene' | 'pending';

/** The whole board, as one immutable snapshot. */
export interface Operations {
  readonly incidents: readonly Incident[];
  /** Newest first — the call log the status bar counts. */
  readonly log: readonly string[];
  /** The clock at the last tick. Panels age calls against THIS, so rendering stays pure. */
  readonly now: number;
  readonly units: readonly Unit[];
}

/** What the operator currently has selected — panels and map symbology both read it. */
export type Selection =
  | null
  | {
      readonly at: GtaGround;
      /** The named district the point falls in (201/5-03) — null when the world ships no `info.zon`, or on
       *  the synthetic demo, which is nowhere. */
      readonly district: null | string;
      readonly kind: 'world';
      readonly model: string;
      readonly txd: string;
    }
  | { readonly id: string; readonly kind: 'incident' }
  | { readonly id: string; readonly kind: 'unit' };

export interface Unit {
  readonly at: GtaGround;
  readonly callsign: string;
  /**
   * Metres above sea level, as the feed reports them (201/5-04). The map is drawn in GTA ground coordinates
   * and everything else here is 2D, but a MODEL needs a height, and this surface has no world to ask: the
   * pak carries no ground query and the units read no collision, by decision. So the height is part of the
   * position CLAIM, like the rest of it — PCAD knows what z its player is at.
   *
   * A replayed fix carries the unit's last known height rather than the one it had then: the track ring
   * stores what a dispatcher reads (201/8-01), and widening a 17-byte sample for a drawing detail is a cost
   * the whole shift pays.
   */
  readonly elevation: number;
  /** Radians, 0 = north — the chevron's rotation. */
  readonly heading: number;
  readonly id: string;
  /** The incident this unit is committed to, or null when it is patrolling. */
  readonly incident: null | string;
  readonly kind: UnitKind;
  /**
   * The model the unit CLAIMS to be driving — a bare name the built game resolves (`copcarls`, `ambulan`).
   * `null` means the feed did not say, and the map draws the symbol alone; so does a name this build carries
   * no `.osm` for (201/5-04). Never a slot id: a name is what a mod author writes and what the archive keys.
   */
  readonly model: null | string;
  readonly status: UnitStatus;
  /** Where it is currently driving; null means "pick a new patrol point". */
  readonly target: GtaGround | null;
}

/** Which service the unit belongs to — it picks the symbol and the colour on the map. */
export type UnitKind = 'ambulance' | 'fire' | 'patrol';

export type UnitStatus = 'available' | 'busy' | 'enRoute' | 'onScene';
