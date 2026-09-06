/**
 * The WORLD hour, and where it is allowed to come from.
 *
 * **This is the second of the two clocks on the screen and it is not the one `clock.ts` runs.** That one is
 * WALL time — when things happened on the board, what a scrub moves along, labelled `SHIFT`. This one is
 * the hour the environment driver applies: the light, the sky, the mood the timecyc authored, labelled
 * `WORLD`. Scrubbing back an hour of the shift does not make the city darker, and turning the world to
 * midnight does not rewind a call. Reading one for the other is the mistake 201/8-03 wrote that rule against.
 *
 * **Until now the world hour did not move at all** — `environment.apply(hour)` ran once at boot and again
 * whenever the operator moved the dial, and nothing else ever touched it. Time did not pass.
 *
 * **The reason it cannot simply free-run is the product.** The console is one of SEVERAL dispatchers
 * watching ONE SA-MP server ([202](../../../../docs/plans/202-pcad-dispatch/readme.md)), and a world hour
 * each console invents for itself is a world they do not share: two dispatchers describing the same street
 * at different times of day, on a board whose whole purpose is that they agree. **So the server is the
 * authority when it speaks**, and this module is the rule for who wins when.
 *
 * **How agreement is reached without a clock-sync protocol.** The feed carries an ANCHOR — the hour, and
 * the rate its day runs at — with each board tick (PCAD's own rate is ~4 s, `202 §4`). A console
 * interpolates from the anchor using time measured on ITS OWN clock since the message ARRIVED, never
 * against a timestamp minted on the server. That is deliberate: comparing a server timestamp with a browser
 * clock imports every skew between them, and phones are not NTP-disciplined. Measuring locally from arrival
 * bounds the disagreement to the transport delay plus one tick of drift, and every tick re-converges it.
 *
 * **And the correction is a SNAP rather than a slew, which is a choice with a reason.** At a 4 s cadence the
 * hour a console has drifted by is a fraction of a second of game time — invisible when it is corrected. The
 * case where the correction is large is a device that slept and woke, and there the jump is HONEST: the
 * world really did move on while the screen was dark. A slew would spend code smoothing the invisible case
 * and lie about the visible one.
 */

/** Where the hour on screen came from. The report and the top bar both state it rather than implying it. */
export type WorldClockSource = 'feed' | 'local' | 'operator';

/** What a server says about its own day, taken at the moment the message ARRIVED. */
export interface WorldTimeAnchor {
  /** The world hour, 0..24, at {@link receivedAtMs}. */
  readonly hour: number;
  /** How many world hours pass per real second there. SA's own default day is 1/60 (a 24-minute day). */
  readonly hoursPerSecond: number;
  /** The console's OWN monotonic clock when this arrived — never a timestamp minted on the server. */
  readonly receivedAtMs: number;
}

/** SA's day: 24 world hours in 24 real minutes, which is `24 / (24 * 60)` hours a second. */
export const SA_HOURS_PER_SECOND = 1 / 60;

/** Everything that can decide the hour, in one object so the resolution is one pure function. */
export interface WorldClock {
  /** The last anchor the feed delivered, or null while no server has spoken. */
  readonly anchor: null | WorldTimeAnchor;
  /** Where a `local` run starts from and how fast it goes — the no-server fallback. */
  readonly local: null | WorldTimeAnchor;
  /** What the operator pinned with the dial, or null while they have not. */
  readonly operatorHour: null | number;
}

/**
 * The hour an anchor implies right now.
 *
 * `nowMs` and the anchor's `receivedAtMs` are both the CONSOLE's clock, so this measures elapsed local time
 * and never a difference between two machines. Time going backwards (a monotonic source that was not) is
 * clamped rather than rewinding the world.
 */
export function hourFromAnchor(anchor: WorldTimeAnchor, nowMs: number): number {
  const elapsedSeconds = Math.max(0, nowMs - anchor.receivedAtMs) / 1000;

  return wrapHour(anchor.hour + elapsedSeconds * anchor.hoursPerSecond);
}

/**
 * Which hour the world draws at, and which of the three said so.
 *
 * **The operator wins, and that is a decision rather than an oversight.** A console showing a different hour
 * from the server it watches is showing something nobody else can see — but pinning the hour is how every
 * measurement in this repository is taken (`?hour=`, and 201/9's whole night series), and how an operator
 * inspects a scene. So the override stands and the surface has to SAY it is overriding; an unlabelled one
 * would be the console quietly disagreeing with the shift.
 */
export function resolveWorldHour(clock: WorldClock, nowMs: number): { hour: number; source: WorldClockSource } {
  if (clock.operatorHour !== null) {
    return { hour: wrapHour(clock.operatorHour), source: 'operator' };
  }
  if (clock.anchor !== null) {
    return { hour: hourFromAnchor(clock.anchor, nowMs), source: 'feed' };
  }
  if (clock.local !== null) {
    return { hour: hourFromAnchor(clock.local, nowMs), source: 'local' };
  }

  return { hour: wrapHour(DEFAULT_HOUR), source: 'local' };
}

/** Wrap any hour into 0..24, so a day that ran past midnight is the next morning rather than 25 o'clock. */
export function wrapHour(hour: number): number {
  const wrapped = hour % 24;

  return wrapped < 0 ? wrapped + 24 : wrapped;
}

/** Where a console with no server and no operator opens: mid-morning, the hour every 201 capture uses. */
export const DEFAULT_HOUR = 10;
