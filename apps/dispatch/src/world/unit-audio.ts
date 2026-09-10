/**
 * What the units on the board sound like (203/5-02).
 *
 * **An engine and a siren, and they come from two different places.** The engine is the game's own authored
 * data — a dummy bank, a pitch and a volume offset per model, voiced by
 * [SA's recovered dummy-engine model](../../../../packages/audio/src/vehicle-engine.ts). The siren is OURS:
 * San Andreas keeps which vehicle wails and with what in CODE, so [directive 1](../../../../docs/project-goals.md)
 * makes it a row of our own table, named `VEH_SIREN_<KIND>` ([the contract](../../../../docs/contracts/audio.md)).
 *
 * **A unit is voiced only while it is worth hearing.** A car at 900 m is inaudible by the falloff alone, but
 * an inaudible voice still costs a slot out of 64 — so a unit that resolves to nothing at the ear is not
 * started, and one that has drifted out is let go. The pool's own stealing rule is the backstop, not the
 * plan.
 */
import type { AudioEventTable, Vec3, Voice, VoicePool } from '@opensa/audio';
import type { AudioBufferLike } from '@opensa/audio';

import { DEFAULT_FALLOFF, distanceBetween, VehicleEngine, type VehicleVoiceTable } from '@opensa/audio';

import type { Unit } from '../ops/types';

/** How a caller turns a sound index into something the pool can play. */
export type BufferFor = (soundIndex: number) => null | WarmSound;

/** What a capture says about the units' own sound. */
export interface UnitAudioReport {
  /** Units with a live engine right now. */
  readonly engines: number;
  /** Sirens running. Should track the `enRoute` count. */
  readonly sirens: number;
  /** Units whose model this build cannot voice — a table built for a different game. */
  readonly unvoiced: number;
}

/** A sound the pool can play, and the playback-rate correction it needs. */
export interface WarmSound {
  readonly buffer: AudioBufferLike;
  /**
   * What the pitch must be multiplied by for the sound to play at its authored speed.
   *
   * **Web Audio's buffer floor is 3 000 Hz and the stock game has a sound below it**, so a buffer is made
   * at `max(rate, 3000)` and played back at `rate / bufferRate`. `DispatchAudio.play` applies that itself;
   * a caller that builds its own `pitch` — an engine does — has to be handed it or that one sound plays
   * about half again too fast and too short.
   */
  readonly pitchScale: number;
}

/** The event name a unit kind's siren is authored under. */
export function sirenNameFor(kind: Unit['kind']): string {
  return `VEH_SIREN_${kind.toUpperCase()}`;
}

/**
 * How far a unit's ENGINE may be and still be worth a voice, in world units.
 *
 * **A gain threshold would have been dead code and a test caught it.** `audibleGain` uses Web Audio's own
 * `inverse` model, which CLAMPS the distance at `maxDistance` rather than falling to zero — deliberately, so
 * a city heard from 900 m is faint and not switched off — so a car is never quieter than about 0.017 however
 * far away it is, and a floor of a thousandth would never have fired once.
 *
 * Past `maxDistance` the model stops telling one distance from another, which is exactly where a voice stops
 * carrying information. That is the rule, and it is derived rather than picked: the number comes from the
 * falloff the sound itself was given.
 *
 * It matters because a car is TWO voices: without it a board of 150 units asks for 300 slots out of 64, and
 * the pool's stealing rule — the backstop, not the plan — would spend every tick churning them.
 */
export const AUDIBLE_REACH = DEFAULT_FALLOFF.maxDistance;

/** A voice plus the rate correction it was started with. */
interface LiveLoop {
  readonly scale: number;
  readonly voice: Voice;
}

/** One unit's live voices. */
interface UnitVoices {
  engine: VehicleEngine;
  /** The rate correction of the engine's two loops, remembered so the reuse path does not refetch. */
  engineScale: number;
  idle: null | Voice;
  rev: null | Voice;
  siren: null | Voice;
  sirenScale: number;
}

/** Holds a voice pair per unit and keeps them in step with the board. */
export class UnitAudio {
  private readonly buffers: BufferFor;
  private readonly events: () => AudioEventTable;
  private readonly live = new Map<string, UnitVoices>();
  private readonly pool: VoicePool;
  private unvoiced = 0;
  private readonly vehicles: () => VehicleVoiceTable;

  constructor(options: {
    bufferFor: BufferFor;
    events: () => AudioEventTable;
    pool: VoicePool;
    vehicles: () => VehicleVoiceTable;
  }) {
    this.buffers = options.bufferFor;
    this.events = options.events;
    this.pool = options.pool;
    this.vehicles = options.vehicles;
  }

  report(): UnitAudioReport {
    let engines = 0;
    let sirens = 0;
    for (const voices of this.live.values()) {
      if (voices.idle || voices.rev) {
        engines += 1;
      }
      if (voices.siren) {
        sirens += 1;
      }
    }

    return { engines, sirens, unvoiced: this.unvoiced };
  }

  /** Let every unit voice go. */
  stop(): void {
    for (const id of [...this.live.keys()]) {
      this.release(id);
    }
  }

  /**
   * One tick: the board as it is, and where the ear is.
   *
   * @param gapSeconds the real gap the audio clock measured — the engine's crossfade is a duration.
   */
  update(units: readonly Unit[], ear: Vec3, gapSeconds: number): void {
    const seen = new Set<string>();
    this.unvoiced = 0;
    for (const unit of units) {
      seen.add(unit.id);
      this.drive(unit, ear, gapSeconds);
    }
    for (const id of [...this.live.keys()]) {
      if (!seen.has(id)) {
        this.release(id);
      }
    }
  }

  /** Start, update or drop one unit's voices. */
  private drive(unit: Unit, ear: Vec3, gapSeconds: number): void {
    const car = this.vehicles().find(unit.model);
    if (car === null) {
      this.unvoiced += 1;
      this.release(unit.id);

      return;
    }
    const at: Vec3 = [unit.at[0], unit.at[1], unit.elevation];
    if (distanceBetween(ear, at) > this.reachFor(unit)) {
      this.release(unit.id);

      return;
    }
    const voices = this.live.get(unit.id) ?? {
      engine: new VehicleEngine(),
      engineScale: 1,
      idle: null,
      rev: null,
      siren: null,
      sirenScale: 1,
    };
    this.live.set(unit.id, voices);

    const ratio = car.maxSpeedMs > 0 ? unit.speed / car.maxSpeedMs : 0;
    const voicing = voices.engine.update(ratio, gapSeconds);
    const offset = 10 ** (car.volumeOffsetDb / 20);
    const idle = this.loop(voices.idle, car.idleSound, {
      at,
      gain: voicing.idleGain * offset,
      pitch: car.enginePitch * voicing.idlePitch,
      scale: voices.engineScale,
    });
    const rev = this.loop(voices.rev, car.revSound, {
      at,
      gain: voicing.revGain * offset,
      pitch: car.enginePitch * voicing.revPitch,
      scale: voices.engineScale,
    });
    voices.engineScale = idle?.scale ?? rev?.scale ?? voices.engineScale;
    voices.idle = idle?.voice ?? null;
    voices.rev = rev?.voice ?? null;
    const siren = this.siren(voices.siren, unit, at, voices.sirenScale);
    voices.siren = siren?.voice ?? null;
    voices.sirenScale = siren?.scale ?? voices.sirenScale;
  }

  /**
   * Keep one looping voice in step: start it, move it, re-gain it, or let it go when it falls silent.
   *
   * The pitch is set on the SOURCE rather than by picking a different sample, which is what a pitched loop
   * is — and it is why the engine model hands back a multiplier rather than a sound to play.
   */
  private loop(
    voice: null | Voice,
    soundIndex: number,
    at: { at: Vec3; gain: number; pitch: number; scale: number },
  ): LiveLoop | null {
    if (at.gain <= 0) {
      voice?.stop();

      return null;
    }
    if (voice && voice.live) {
      this.pool.setPosition(voice, at.at);
      this.pool.setGain(voice, at.gain);
      // The rate correction is remembered rather than re-read: the cache could evict the buffer under a
      // playing voice, and losing the scale then would make the engine jump in pitch for no reason a
      // listener could account for.
      this.pool.setPitch(voice, at.pitch * at.scale);

      return { scale: at.scale, voice };
    }
    const warm = this.buffers(soundIndex);
    if (warm === null) {
      return null;
    }
    const started = this.pool.play({
      buffer: warm.buffer,
      bus: 'world',
      gain: at.gain,
      loop: true,
      pitch: at.pitch * warm.pitchScale,
      position: at.at,
    });

    return started === null ? null : { scale: warm.pitchScale, voice: started };
  }

  /**
   * How far this unit may be and still be worth a voice.
   *
   * **The engine's reach and the siren's are not the same number.** An engine plays at the default falloff;
   * a siren plays at the one its ROW authored, and a `VEH_SIREN_PATROL … 900` row means an operator should
   * hear it from 900 m. Culling both at 300 would silence that row with nothing reported — so the reach is
   * the larger of the two, which is the distance past which NEITHER model can still tell one distance from
   * another.
   */
  private reachFor(unit: Unit): number {
    if (unit.status !== 'enRoute') {
      return AUDIBLE_REACH;
    }
    // `has` before `find` so a build that authored no siren for this service is not reported once per kind
    // per tick — the absence for a missing siren is said where the siren is actually wanted.
    const name = sirenNameFor(unit.kind);
    const siren = this.events().has(name) ? this.events().find(name) : null;

    return Math.max(AUDIBLE_REACH, siren?.falloff.maxDistance ?? 0);
  }

  /** Drop everything one unit holds. */
  private release(id: string): void {
    const voices = this.live.get(id);
    if (!voices) {
      return;
    }
    voices.idle?.stop();
    voices.rev?.stop();
    voices.siren?.stop();
    this.live.delete(id);
  }

  /** The siren, which runs while a unit is on its way and at no other time. */
  private siren(voice: null | Voice, unit: Unit, at: Vec3, scale: number): LiveLoop | null {
    if (unit.status !== 'enRoute') {
      voice?.stop();

      return null;
    }
    if (voice && voice.live) {
      this.pool.setPosition(voice, at);

      return { scale, voice };
    }
    const event = this.events().find(sirenNameFor(unit.kind));
    const warm = event === null ? null : this.buffers(event.soundIndex);
    if (event === null || warm === null) {
      return null;
    }
    const started = this.pool.play({
      buffer: warm.buffer,
      // A siren is a thing in the world that a unit is driving, not a panel alert about it.
      bus: 'world',
      falloff: event.falloff,
      gain: event.gain,
      loop: true,
      loopStartSeconds: event.loopStartSeconds,
      // Without this the one stock sound below Web Audio's 3 000 Hz floor wails half again too fast.
      pitch: warm.pitchScale,
      position: at,
    });

    return started === null ? null : { scale: warm.pitchScale, voice: started };
  }
}
