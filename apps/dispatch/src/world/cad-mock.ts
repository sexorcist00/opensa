/**
 * A stand-in for the CAD, so the `cad` bus can be heard and measured before another repository ships
 * (204/3-02, decision 3.3).
 *
 * **It is a stand-in for the OTHER SIDE, not a feature of this one.** It builds messages in the contract's
 * shape and hands them to [the seam](./cad-link.ts) PCAD will use; at phase 3 it is switched off and no
 * audio code changes. That is the whole argument for building it: a `cad` bus nobody can hear is a bus whose
 * ducking, whose reserve and whose 50 ms budget are all unmeasured until the day they matter.
 *
 * **Every message is about a unit that is actually on the board**, because a panic from a callsign nobody
 * has is a sound an operator cannot act on, and acting on it is the only way to notice the console is
 * wrong about it.
 *
 * **It always carries the `sound` field**, which is what the contract asks PCAD for. The fallback path is
 * tested directly rather than injected here — a mock that sometimes omitted the field would be this
 * repository manufacturing the defect it is asking the other one to fix.
 */
import type { Operations, Unit } from '../ops/types';
import type { CadMessage } from './cad-link';

/** Whether this run carries the stand-in at all. `off` is `?cad=0`, spelled the way a filed row spells it. */
export type CadArm = 'off' | 'on';

/**
 * Mean seconds between messages.
 *
 * Often enough that a minute of watching the console hears the `cad` bus duck the city, rare enough that it
 * is not the thing somebody remembers about the demo. A MEAN rather than an interval: a fixed one makes a
 * rhythm, which is the lesson [the ambience](../../../../docs/gta-sa-original/audio-ambience.md) already
 * paid for once.
 */
export const MOCK_MEAN_SECONDS = 45;

/**
 * What the stand-in can say, and how often relative to each other.
 *
 * `panic_button` is deliberately the rarest: it is the loudest thing the console can do, and a demo that
 * fires it every third message teaches an operator to ignore it — which is the one outcome this whole chain
 * exists to prevent.
 */
const SCRIPT: readonly { readonly line: (unit: Unit) => CadMessage; readonly weight: number }[] = [
  {
    line: (unit) => message('Assistance Request', `${unit.callsign} requests assistance`, 'assist_request'),
    weight: 4,
  },
  { line: (unit) => message('ALPR Hit', `Plate read near ${unit.callsign}`, 'alpr_hit'), weight: 3 },
  {
    line: (unit) => message('Simplex Request', `${unit.callsign} offers a simplex exchange`, 'simplex_request'),
    weight: 3,
  },
  {
    line: (unit) => message('Simplex Accepted', `${unit.callsign} accepted the exchange`, 'simplex_accepted'),
    weight: 2,
  },
  {
    line: (unit) => message('Simplex Declined', `${unit.callsign} declined the exchange`, 'simplex_declined'),
    weight: 1,
  },
  { line: (unit) => message('BOLO', `New BOLO relayed to ${unit.callsign}`, 'bolo_new'), weight: 2 },
  { line: (unit) => message('Panic Button', `${unit.callsign} PANIC`, 'panic_button'), weight: 1 },
];

const TOTAL_WEIGHT = SCRIPT.reduce((sum, entry) => sum + entry.weight, 0);

/** The CAD, faked. Driven by elapsed time rather than by ticks, so its rate does not follow the clock's. */
export class CadMock {
  private readonly random: () => number;

  constructor(random: () => number = (): number => Math.random()) {
    this.random = random;
  }

  /**
   * Whatever the CAD would have said over `gapSeconds`, or `null`.
   *
   * A Poisson-ish draw against the mean rather than a countdown: two messages may land close together and a
   * quiet stretch may run long, which is what a feed of independent events actually looks like.
   */
  step(board: Operations, gapSeconds: number): CadMessage | null {
    if (board.units.length === 0) {
      return null;
    }
    // No `gapSeconds <= 0` guard: a random is in [0, 1) and the threshold is 0 across no time, so the draw
    // below already refuses it. A second check there would read as protection while protecting nothing.
    if (this.random() >= gapSeconds / MOCK_MEAN_SECONDS) {
      return null;
    }
    const unit = board.units[Math.min(board.units.length - 1, Math.floor(this.random() * board.units.length))];

    return pick(this.random() * TOTAL_WEIGHT).line(unit);
  }
}

/**
 * Read the arm out of `?cad=`.
 *
 * Absent is `on`, and that is a statement with an expiry date: until PCAD carries the contract's `sound`
 * field there is no CAD to connect to, so a console opened with nothing on the `cad` bus would report a
 * budget nobody exercised. `?cad=0` removes the stand-in and leaves the seam exactly as it is — which is
 * also what the day PCAD arrives looks like. Like every arm in this family, unrecognised is the DEFAULT.
 */
export function cadArm(params: URLSearchParams): CadArm {
  return params.get('cad') === '0' ? 'off' : 'on';
}

function message(title: string, body: string, sound: string): CadMessage {
  return { body, sound, title };
}

/** The weighted draw, walked rather than indexed so the weights above read as the table they are. */
function pick(at: number): (typeof SCRIPT)[number] {
  let seen = 0;
  for (const entry of SCRIPT) {
    seen += entry.weight;
    if (at < seen) {
      return entry;
    }
  }

  return SCRIPT[SCRIPT.length - 1];
}
