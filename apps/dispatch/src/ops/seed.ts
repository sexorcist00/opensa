/**
 * The demo board: Los Santos landmarks, a shift's worth of units, and the call types a dispatcher sees.
 *
 * These are ordinary GTA coordinates — swap the table for your own map's places and the whole app follows.
 * Nothing else in the app hardcodes a position.
 */
import type { Incident, IncidentPriority, Operations, Unit } from './types';

/** Named places calls come in at, GTA coords. Los Santos, roughly clockwise from Ganton. */
export const LANDMARKS: readonly { readonly at: readonly [number, number]; readonly name: string }[] = [
  { at: [2495, -1687], name: 'Grove Street, Ganton' },
  { at: [2100, -1800], name: 'Idlewood' },
  { at: [2400, -2000], name: 'Willowfield' },
  { at: [1685, -2330], name: "Los Santos Int'l" },
  { at: [1750, -2050], name: 'El Corona' },
  { at: [1774, -1897], name: 'Unity Station' },
  { at: [1481, -1770], name: 'Pershing Square' },
  { at: [1420, -1550], name: 'Commerce' },
  { at: [1480, -1300], name: 'Downtown LS' },
  { at: [1000, -1300], name: 'Market' },
  { at: [700, -1500], name: 'Marina' },
  { at: [900, -1800], name: 'Verona Beach' },
  { at: [350, -1800], name: 'Santa Maria Beach' },
  { at: [1250, -900], name: 'Vinewood Boulevard' },
  { at: [1350, -700], name: 'Mulholland' },
  { at: [1980, -1150], name: 'Glen Park' },
  { at: [2220, -1150], name: 'Jefferson' },
  { at: [2700, -1150], name: 'Los Flores' },
  { at: [2650, -1400], name: 'East Los Santos' },
  { at: [2750, -1900], name: 'East Beach' },
];

/** The call types, with the priority a dispatcher would give them and who normally rolls. */
export const CALL_TYPES: readonly {
  readonly code: string;
  readonly priority: IncidentPriority;
  readonly title: string;
}[] = [
  { code: '10-50', priority: 2, title: 'Traffic collision' },
  { code: '10-31', priority: 1, title: 'Crime in progress' },
  { code: '10-70', priority: 1, title: 'Structure fire' },
  { code: '10-52', priority: 1, title: 'Medical — ambulance needed' },
  { code: '10-90', priority: 2, title: 'Bank alarm' },
  { code: '10-16', priority: 3, title: 'Domestic disturbance' },
  { code: '10-66', priority: 3, title: 'Suspicious person' },
  { code: '10-91', priority: 3, title: 'Abandoned vehicle' },
  { code: '10-80', priority: 1, title: 'Pursuit in progress' },
  { code: '10-15', priority: 2, title: 'Prisoner transport' },
];

/** The shift on duty when the board opens. */
export function initialOperations(now: number): Operations {
  const units: Unit[] = [
    unit('u1', '1-ADAM-12', 'patrol', 0),
    unit('u2', '1-ADAM-20', 'patrol', 3),
    unit('u3', '2-LINCOLN-7', 'patrol', 7),
    unit('u4', '2-LINCOLN-9', 'patrol', 11),
    unit('u5', '3-KING-4', 'patrol', 15),
    unit('u6', 'MEDIC-3', 'ambulance', 5),
    unit('u7', 'MEDIC-7', 'ambulance', 17),
    unit('u8', 'ENGINE-51', 'fire', 9),
    unit('u9', 'TRUCK-9', 'fire', 13),
  ];

  return {
    incidents: [makeIncident('i1', now, 1), makeIncident('i2', now - 90_000, 5)],
    log: ['Shift start — 9 units on duty'],
    now,
    units,
  };
}

/** A call at a named landmark. `landmark` and `type` index the tables above, so a caller can be explicit. */
export function makeIncident(
  id: string,
  opened: number,
  landmark: number,
  type = landmark % CALL_TYPES.length,
): Incident {
  const place = LANDMARKS[landmark % LANDMARKS.length];
  const call = CALL_TYPES[type % CALL_TYPES.length];

  return {
    assigned: [],
    at: place.at,
    code: call.code,
    id,
    opened,
    place: place.name,
    priority: call.priority,
    remaining: 20 + (type % 4) * 12,
    status: 'pending',
    title: call.title,
  };
}

function unit(id: string, callsign: string, kind: Unit['kind'], landmark: number): Unit {
  return {
    at: LANDMARKS[landmark % LANDMARKS.length].at,
    callsign,
    heading: 0,
    id,
    incident: null,
    kind,
    status: 'available',
    target: null,
  };
}
