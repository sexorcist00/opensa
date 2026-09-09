import { describe, expect, it } from 'vitest';

import type { AudioListener } from './spatial';
import type { FakeAudioBuffer } from './test/fake-context';

import { audibleGain } from './spatial';
import { FakeAudioContext, type FakeBufferSource } from './test/fake-context';
import { MAX_VOICES, VoicePool } from './voices';

/** A listener at the origin looking down +Y with +X to its right. */
const AT_ORIGIN: AudioListener = { forward: [0, 1, 0], position: [0, 0, 0], right: [1, 0, 0] };

/** Half a second of 12 kHz mono — the rate 59 % of stock SA's sounds are authored at. */
function buffer(context: FakeAudioContext): FakeAudioBuffer {
  return context.createBuffer(1, 6_000, 12_000) as FakeAudioBuffer;
}

/** The source behind the n-th voice the pool started. */
function sourceOf(context: FakeAudioContext, index: number): FakeBufferSource {
  const source = context.sources[index];
  if (!source) {
    throw new Error(`no source ${index}`);
  }

  return source;
}

/** The gain of the n-th voice. The pool builds its MASTER gain first, so a voice's own is one along. */
function voiceGain(context: FakeAudioContext, index: number): number {
  return context.gains[index + 1]?.gain.value ?? Number.NaN;
}

describe('VoicePool', () => {
  describe('negative cases', () => {
    it('REFUSES a sound quieter than every voice already playing rather than stealing for it', () => {
      // The rule is "keep the 64 loudest things". A newcomer that would be the quietest of them all takes
      // nobody's slot — starting it can only make the mix worse.
      const context = new FakeAudioContext();
      const pool = new VoicePool(context, { maxVoices: 2 });
      pool.setListener(AT_ORIGIN);
      pool.play({ buffer: buffer(context), position: [0, 5, 0] });
      pool.play({ buffer: buffer(context), position: [0, 5, 0] });

      const refused = pool.play({ buffer: buffer(context), position: [0, 900, 0] });

      expect(refused).toBeNull();
      expect(pool.report()).toMatchObject({ live: 2, refused: 1, steals: 0 });
    });

    it('never exceeds its ceiling, however many sounds are thrown at it', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context, { maxVoices: 4 });
      pool.setListener(AT_ORIGIN);

      for (let at = 0; at < 40; at += 1) {
        pool.play({ buffer: buffer(context), position: [0, 5 + at, 0] });
        expect(pool.report().live).toBeLessThanOrEqual(4);
      }

      expect(pool.report()).toMatchObject({ ceiling: 4, live: 4, peak: 4 });
    });

    it('does nothing when told to move or stop a voice it no longer has', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);
      const voice = pool.play({ buffer: buffer(context) });
      voice?.stop();

      voice?.stop();
      pool.setPosition(voice ?? { id: 99, live: false, stop: () => undefined }, [1, 2, 3]);

      expect(pool.report().live).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('steals the QUIETEST at the listener, not the furthest and not the oldest', () => {
      // The two are different sounds: a loud siren 200 m away can be worth more than a quiet footstep at
      // 40 m, and the rule ranks by what reaches the ear rather than by geometry.
      const context = new FakeAudioContext();
      const pool = new VoicePool(context, { maxVoices: 2 });
      pool.setListener(AT_ORIGIN);
      const loudFar = pool.play({ buffer: buffer(context), gain: 1, position: [0, 200, 0] });
      const quietNear = pool.play({ buffer: buffer(context), gain: 0.02, position: [0, 40, 0] });

      expect(audibleGain(AT_ORIGIN, [0, 200, 0], 1)).toBeGreaterThan(audibleGain(AT_ORIGIN, [0, 40, 0], 0.02));
      pool.play({ buffer: buffer(context), gain: 1, position: [0, 5, 0] });

      expect(quietNear?.live).toBe(false);
      expect(loudFar?.live).toBe(true);
      expect(pool.report()).toMatchObject({ live: 2, steals: 1 });
    });

    it('plays a voice at exactly the gain the ranking used', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);
      pool.setListener(AT_ORIGIN);

      pool.play({ buffer: buffer(context), gain: 0.8, position: [0, 55, 0] });

      expect(voiceGain(context, 0)).toBeCloseTo(audibleGain(AT_ORIGIN, [0, 55, 0], 0.8), 10);
    });

    it('wires source → gain → pan → destination, and starts it', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);

      pool.play({ buffer: buffer(context), position: [10, 0, 0] });

      expect(sourceOf(context, 0).connectedTo[0]).toBe(context.gains[1]);
      expect(context.gains[1]?.connectedTo[0]).toBe(context.panners[0]);
      expect(context.panners[0]?.connectedTo[0]).toBe(context.gains[0]);
      expect(sourceOf(context, 0).startedAt).not.toBeNull();
      expect(context.panners[0]?.pan.value).toBe(1);
    });

    it('loops from the AUTHORED loop point, and a one-shot does not loop', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);

      pool.play({ buffer: buffer(context), loop: true, loopStartSeconds: 0.25 });
      pool.play({ buffer: buffer(context) });

      expect(sourceOf(context, 0).loop).toBe(true);
      expect(sourceOf(context, 0).loopStart).toBe(0.25);
      expect(sourceOf(context, 0).loopEnd).toBeCloseTo(0.5, 6);
      expect(sourceOf(context, 1).loop).toBe(false);
    });

    it('carries pitch through as the playback rate', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);

      pool.play({ buffer: buffer(context), pitch: 1.25 });

      expect(sourceOf(context, 0).playbackRate.value).toBe(1.25);
    });

    it('frees a slot when a one-shot ENDS, with nothing polling for it', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context, { maxVoices: 1 });
      const voice = pool.play({ buffer: buffer(context) });

      sourceOf(context, 0).finish();

      expect(voice?.live).toBe(false);
      expect(pool.report().live).toBe(0);
      expect(pool.play({ buffer: buffer(context) })).not.toBeNull();
    });

    it('re-gains and re-pans every live voice when the ear moves', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);
      pool.setListener(AT_ORIGIN);
      pool.play({ buffer: buffer(context), gain: 1, position: [0, 100, 0] });

      pool.setListener({ ...AT_ORIGIN, position: [0, 95, 0] });

      expect(voiceGain(context, 0)).toBeCloseTo(
        audibleGain({ ...AT_ORIGIN, position: [0, 95, 0] }, [0, 100, 0], 1),
        10,
      );
    });

    it('follows a source that moves — a siren left where it was fired is a bug people hear', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);
      pool.setListener(AT_ORIGIN);
      const voice = pool.play({ buffer: buffer(context), gain: 1, position: [0, 200, 0] });

      if (voice) {
        pool.setPosition(voice, [0, 6, 0]);
      }

      expect(voiceGain(context, 0)).toBeGreaterThan(0.5);
    });

    it('centres a sound with no position and gives it its gain everywhere', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);
      pool.setListener({ ...AT_ORIGIN, position: [900, 900, 900] });

      pool.play({ buffer: buffer(context), gain: 0.4, position: null });

      expect(voiceGain(context, 0)).toBe(0.4);
      expect(context.panners[0]?.pan.value).toBe(0);
    });

    it('stops everything on request, and lets the nodes go when the fade has run', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);
      pool.play({ buffer: buffer(context) });
      pool.play({ buffer: buffer(context) });

      pool.stopAll();

      // The SLOT is free at once — the budget is about slots — while the nodes live out the fade.
      expect(pool.report().live).toBe(0);
      expect(sourceOf(context, 0).stoppedAt).toBeGreaterThan(0);
      expect(sourceOf(context, 0).disconnected).toBe(false);

      sourceOf(context, 0).finish();
      sourceOf(context, 1).finish();

      expect(sourceOf(context, 0).disconnected).toBe(true);
      expect(context.gains[2]?.disconnected).toBe(true);
    });

    it('RAMPS a cut voice to zero rather than stepping it — a step is a click', () => {
      const context = new FakeAudioContext();
      context.currentTime = 5;
      const pool = new VoicePool(context, { maxVoices: 1 });
      pool.setListener(AT_ORIGIN);
      const first = pool.play({ buffer: buffer(context), gain: 0.02, position: [0, 200, 0] });

      pool.play({ buffer: buffer(context), gain: 1, position: [0, 5, 0] });

      const gain = context.gains[1];
      expect(first?.live).toBe(false);
      expect(gain?.gain.cancelledAt).toBe(5);
      expect(gain?.gain.setAt[gain.gain.setAt.length - 1]?.time).toBe(5);
      expect(gain?.gain.ramps[gain.gain.ramps.length - 1]).toEqual({ time: 5.008, value: 0 });
      expect(sourceOf(context, 0).stoppedAt).toBeCloseTo(5.008, 6);
    });

    it('routes every voice through ONE master gain, which is what mute and volume set', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);
      pool.play({ buffer: buffer(context) });
      pool.play({ buffer: buffer(context) });

      pool.setMasterGain(0.25);

      expect(context.gains[0]?.connectedTo[0]).toBe(context.destination);
      expect(context.panners[0]?.connectedTo[0]).toBe(context.gains[0]);
      expect(context.panners[1]?.connectedTo[0]).toBe(context.gains[0]);
      expect(pool.report().masterGain).toBe(0.25);
    });

    it('clamps the master to 0..1, and a muted pool goes on playing and counting', () => {
      // Mute is a gain of zero and nothing else: unmuting is instant, and a capture still says how many
      // voices the world asked for while nobody could hear them.
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);

      pool.setMasterGain(-2);
      expect(pool.report().masterGain).toBe(0);
      pool.play({ buffer: buffer(context) });
      expect(pool.report().live).toBe(1);

      pool.setMasterGain(9);
      expect(pool.report().masterGain).toBe(1);
    });

    it('states the budget it was built with', () => {
      expect(new VoicePool(new FakeAudioContext()).report().ceiling).toBe(MAX_VOICES);
      expect(MAX_VOICES).toBe(64);
    });
  });
});
