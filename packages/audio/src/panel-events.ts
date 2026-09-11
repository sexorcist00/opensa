/**
 * What happens when a panel event arrives (204/2-03).
 *
 * **The whole path is resident.** A panel sound is wanted within **50 ms** of the event — an order of
 * magnitude under 203's cold-start budget, because a sound answering an action reads as a coincidence rather
 * than a response if it is late — so nothing here fetches, decodes or converts. Every buffer was built on
 * load ([panel-sounds.ts](./panel-sounds.ts)), and `play` is a lookup and a voice.
 *
 * **The vocabulary below is the [contract](../../../docs/contracts/panel-audio.md), in code.** Which
 * category owns a name decides which bus it plays on, which decides what it ducks and what can steal from
 * it; and the two FLOORED names are the two this whole chain exists to deliver.
 */
import type { AudioBus, Voice, VoicePool } from './voices';

import { PanelSounds } from './panel-sounds';

/**
 * How long one name stays quiet after it has played (204/2-04).
 *
 * **Ten calls arriving in a burst is one tone and a count, not a machine gun.** The chain already learned
 * this from the original once: `CAETwinLoopSoundEntity` randomises its swap interval precisely because
 * *a fixed one makes a rhythm, and a rhythm is what an ear learns and then cannot stop hearing*
 * ([the recovered design](../../../docs/gta-sa-original/audio-ambience.md)). One-shot alerts have the same
 * problem in a sharper form — a queue filling is exactly when an operator most needs to be able to think.
 *
 * **Per NAME rather than globally**, so a panic during a burst of new calls is still heard: coalescing is
 * about repetition, and two different events are not a repetition.
 */
export const COALESCE_MS = 900;

/**
 * How far a repeat is detuned, as a fraction of its pitch.
 *
 * Small enough that nobody could name the interval, large enough that two plays are not the same recording
 * twice — which is the difference between a console and a car alarm.
 */
export const VARY = 0.03;

/** What a capture says about the panel's events. */
export interface PanelEventReport {
  /** Events played, per category. */
  readonly byCategory: Readonly<Record<AudioBus, number>>;
  /** Events folded into one that was already sounding. A rising count is a busy board, not a fault. */
  readonly coalesced: number;
  /**
   * The worst event → audible gap seen, in milliseconds.
   *
   * **Measured from when the EVENT happened rather than from when this was called**, because that is what
   * the budget is about: a message that took 200 ms to cross a socket and 1 ms to reach a speaker is a late
   * alert, and a number that started its clock at the speaker would call it instant.
   */
  readonly maxLatencyMs: number;
  readonly played: number;
  /** Events the pool turned away. For `cad` this is a budget and its value is zero. */
  readonly refused: number;
  /** Names no build knows, said once each — a vocabulary mismatch between two repositories. */
  readonly unknown: readonly string[];
}

/* eslint-disable camelcase -- CONTRACT names, shared verbatim with PCAD's trigger table. Renaming one here
   silently stops matching the other repository, which is what the contract exists to prevent. */

/** Which category owns each name, and therefore which bus it plays on. */
export const PANEL_CATEGORY: Readonly<Record<string, AudioBus>> = {
  alpr_hit: 'cad',
  assist_request: 'cad',
  bolo_new: 'cad',
  call_closed: 'map',
  call_created_p1: 'map',
  call_created_p2: 'map',
  call_created_p3: 'map',
  incident_created: 'map',
  link_back: 'cad',
  link_lost: 'cad',
  notification: 'cad',
  panic_button: 'cad',
  simplex_accepted: 'cad',
  simplex_declined: 'cad',
  simplex_request: 'cad',
  unit_arrived: 'map',
  unit_assigned: 'map',
  unit_stale: 'map',
};

/**
 * The two events a mute makes QUIET rather than silent.
 *
 * A dispatcher working a frozen board that looks live is this product's worst failure, and a unit pressing
 * panic is the reason anybody is listening at all. Nothing else is on this list, and nothing else should
 * be: a floor that covers everything is a mute that does not work.
 */
export const FLOORED: ReadonlySet<string> = new Set(['link_lost', 'panic_button']);

/* eslint-enable camelcase */

/** Plays the panel's own vocabulary. */
export class PanelEvents {
  private coalesced = 0;
  private readonly counts: Record<AudioBus, number> = { cad: 0, map: 0, world: 0 };
  /** When each name last sounded, for the coalescing window. */
  private readonly lastPlayed = new Map<string, number>();
  private maxLatencyMs = 0;
  private readonly now: () => number;
  private played = 0;
  private readonly pool: null | VoicePool;
  private readonly random: () => number;
  private refused = 0;
  private readonly said = new Set<string>();

  private readonly sounds: PanelSounds;

  private readonly unknown: string[] = [];

  constructor(options: { now?: () => number; pool: null | VoicePool; random?: () => number; sounds?: PanelSounds }) {
    this.pool = options.pool;
    this.sounds = options.sounds ?? PanelSounds.empty();
    this.now = options.now ?? ((): number => performance.now());
    this.random = options.random ?? ((): number => Math.random());
  }

  /**
   * Play one event, or answer `null`.
   *
   * @param atMs when the EVENT happened, on the same clock as `now`. Absent, now — which is right for an
   *   event this surface raised itself and wrong for one that crossed a socket, so a caller that has the
   *   arrival time passes it.
   */
  event(name: string, atMs?: number): null | Voice {
    const bus = PANEL_CATEGORY[name];
    if (bus === undefined) {
      // **`unknown` is about the VOCABULARY and nothing else.** A build with no context has no buffers at
      // all (`PanelSounds.empty()`), and listing every contract name here would make the silent baseline
      // capture indistinguishable from a real mismatch between two repositories — which is the one thing
      // this field exists to report. A name the table knows but this build cannot voice is an ABSENCE, and
      // absence is already what `played` being zero says.
      if (!this.said.has(name)) {
        this.said.add(name);
        this.unknown.push(name);
      }

      return null;
    }
    const buffer = this.sounds.find(name);
    if (buffer === null) {
      return null;
    }
    const at = this.now();
    const last = this.lastPlayed.get(name);
    if (last !== undefined && at - last < COALESCE_MS) {
      this.coalesced += 1;

      return null;
    }
    this.lastPlayed.set(name, at);
    const voice =
      this.pool?.play({
        buffer,
        bus,
        floored: FLOORED.has(name),
        gain: 1,
        // Detuned a little on every play. A queue of identical chimes is a rhythm, and a rhythm is the one
        // thing an ear cannot stop hearing.
        pitch: 1 + (this.random() * 2 - 1) * VARY,
        position: null,
      }) ?? null;
    if (voice === null) {
      this.refused += 1;

      return null;
    }
    this.played += 1;
    this.counts[bus] += 1;
    this.maxLatencyMs = Math.max(this.maxLatencyMs, at - (atMs ?? at));

    return voice;
  }

  report(): PanelEventReport {
    return {
      byCategory: { ...this.counts },
      coalesced: this.coalesced,
      maxLatencyMs: this.maxLatencyMs,
      played: this.played,
      refused: this.refused,
      unknown: [...this.unknown],
    };
  }
}
