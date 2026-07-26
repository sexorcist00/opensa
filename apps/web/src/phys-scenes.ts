/**
 * The scripted physics track (plan 081/01) — the `[bench]` scene list's twin for driving.
 *
 * Every spot is a REAL place on the road graph, not a coordinate from memory: the straights come from a scan
 * of the game's own `NODES*.DAT` vehicle nodes for chains that hold one heading with no height change, and
 * the crest from the same scan asking for a rise then a drop inside a launch length. Each scene records the
 * measured shape of its spot, because a scene whose ground turns out to be wrong invalidates every number
 * captured on it, and that has to be checkable later.
 *
 * Cars are ground-snapped at spawn (`seatVehicleOnGround`), so `position.z` is a hint. Headings are the
 * road's own heading from the graph (GTA convention: 0 faces +Y, counter-clockwise about +Z).
 */
import type { DriveKeyframe, PhysScene } from '@opensa/game/vehicle/scripted-drive';

/** Full lock alternating on a fixed beat — a slalom has to be a metronome, or two runs are not comparable. */
function metronome(from: number, beats: number, period: number, steer: number, throttle: number): DriveKeyframe[] {
  return Array.from({ length: beats }, (_, index) => ({
    move: { x: index % 2 === 0 ? steer : -steer, y: throttle },
    t: from + index * period,
  }));
}

export const PHYS_SCENES: readonly PhysScene[] = [
  {
    durationS: 10,
    heading: 0,
    key: 'rest',
    // The SF west-shore straight, NOT Ganton. The first version stood at Ganton, where the user saw parked
    // cars shivering — and measured nothing reliable, because a lap seats the player in the NEAREST car and
    // that street is full of parked ones. A scene about one car's stillness has to stand where it is alone.
    position: [-2809, 180, 6],
    timeline: [{ move: { x: 0, y: 0 }, t: 0 }],
    what: 'The car sits at rest for ten seconds. Everything here should read zero; anything that does not is a tremor.',
  },
  {
    durationS: 16,
    heading: -3.132,
    key: 'brake-strip',
    // SF west-shore straight: 450 m holding one heading with Δz 0.00 over the whole run.
    position: [-2809, 121.1, 6],
    timeline: [
      { move: { x: 0, y: 1 }, t: 0 }, // WOT
      // Brake at 8 s, NOT later: the first capture held WOT to 12 s, and the infernus ran out of straight
      // at 190 km/h — an 18.8 g lateral spike that had nothing to do with braking. 8 s is ~200 m in.
      { actions: ['jump'], move: { x: 0, y: 0 }, t: 8 },
    ],
    what: 'Time to speed, then a full-brake stop: the nose-lift complaint quantified (pitch sign under brake) plus brake distance.',
  },
  {
    durationS: 24,
    heading: 1.571,
    key: 'step-steer',
    // Its own LV straight (325 m, Δz 0.00) with open ground to the turn side — a settled corner leaves the
    // road by design, and must not meet a wall while it does.
    position: [2417.3, 1773.1, 9.6],
    timeline: [
      // A GENTLE constant input at a modest speed. Every other scene is either straight or at full lock, and
      // neither can show a transient: this one asks for a corner and watches how long the car takes to give
      // it. v1 stepped 0.35 after 5 s of throttle (117 km/h on the infernus) and NONE of the four cars
      // settled — every lap broke away, and the firetruck rolled to 91.8°. A response needs a steady state
      // to rise toward, so the run-up is 3 s and the step is 0.15.
      { move: { x: 0, y: 1 }, t: 0 },
      { move: { x: 0.15, y: 0.25 }, t: 3 },
      { move: { x: 0, y: 0.25 }, t: 10 }, // released — the return is half the answer
      { move: { x: -0.15, y: 0.25 }, t: 14 }, // the same step the other way: symmetry
      { move: { x: 0, y: 0.25 }, t: 21 },
    ],
    what: 'Step steer at speed: how long the yaw takes to answer a held moderate input, and whether it settles. The throttle holds ~speed rather than pinning it — the capture records the speed at the step.',
  },
  {
    durationS: 24,
    heading: 1.571,
    key: 'slalom',
    // LV straight: 336 m, Δz 0.00.
    position: [2392.1, 1193.1, 9.6],
    timeline: [{ move: { x: 0, y: 1 }, t: 0 }, ...metronome(5, 10, 1.6, 0.9, 0.6)],
    what: 'Metronome steering at speed: roll angle per direction change, and how close the body comes to a flip.',
  },
  {
    durationS: 16,
    heading: -3.142,
    key: 'u-turn',
    // LS east straight: 294 m, Δz 0.00.
    position: [2413.8, -1822.3, 12.4],
    timeline: [
      // 2.5 s of WOT, not 4: the first capture entered the turn at 100 km/h, swung wide off the road and
      // took two ~80 g hits — a crash log, not a cornering measurement.
      { move: { x: 0, y: 1 }, t: 0 },
      { move: { x: -1, y: 0.3 }, t: 2.5 }, // full lock left, off the power
      { move: { x: 0, y: 0.5 }, t: 8 },
    ],
    what: 'A 180 at moderate speed: steady-state cornering — slip angle, lateral g and the load the outer wheels carry.',
  },
  {
    durationS: 14,
    heading: 1.571,
    key: 'kerb-strike',
    // The LV straight the slalom uses, but 120 m along it: sharing a spot meant seating the player in the
    // WRECK the slalom leaves behind (it flips), and the capture came back with a car that never moved and
    // was "airborne" for its whole lap. Scenes on one road must not stand on each other's leftovers.
    // UNCONFIRMED: whether the angle below actually mounts the kerb — the first clean capture answers it
    // (a vertical g spike or none).
    position: [2272.1, 1193.1, 9.6],
    timeline: [
      { move: { x: 0, y: 1 }, t: 0 },
      { move: { x: 0.25, y: 0.6 }, t: 4 }, // drift into the kerb at a shallow angle
      { move: { x: 0, y: 0.4 }, t: 7 },
    ],
    what: 'Mounting a kerb at a shallow angle: the vertical spike and how far the car is thrown off line.',
  },
  {
    durationS: 16,
    heading: 1.478,
    key: 'crest-jump',
    // Red County crest: +4.3 m then −3.3 m within 50 m either side of the peak, on a 108 m straight approach.
    position: [601.5, -150.1, 30],
    timeline: [{ move: { x: 0, y: 1 }, t: 0 }],
    what: 'Flat-out over a crest: air time, the landing spike, and whether the car keeps its line on touchdown.',
  },
  {
    durationS: 16,
    heading: -3.142,
    key: 'handbrake-turn',
    // SF west-shore straight, 378 m of room from here.
    position: [-2808.9, 49.5, 6],
    timeline: [
      { move: { x: 0, y: 1 }, t: 0 },
      { actions: ['jump'], move: { x: -1, y: 0 }, t: 5 }, // lock + handbrake
      { move: { x: 0, y: 0 }, t: 7 },
    ],
    what: 'Handbrake turn: how far the car rotates and whether the slide is held — the feel target the user gives in vanilla-SA words.',
  },
  {
    durationS: 18,
    heading: -3.142,
    key: 'pull-away-reverse',
    // SF west-shore straight, from the quiet end.
    position: [-2808.9, 3.5, 6],
    timeline: [
      { move: { x: 0, y: 1 }, t: 0 },
      { move: { x: 0, y: 0 }, t: 5 }, // coast to a stop
      { move: { x: 0, y: -1 }, t: 9 }, // reverse from rest — the seedReverse path
      { move: { x: 0, y: 0 }, t: 15 },
    ],
    what: 'Standing start, coast-down, then reverse from rest: launch behaviour, off-throttle drag and the reverse seeding.',
  },
];

/** The three reference cars the BEFORE matrix runs (sports / sedan / heavy — the calibration trio). */
export const PHYS_CARS: readonly string[] = ['infernus', 'admiral', 'firetruk'];
