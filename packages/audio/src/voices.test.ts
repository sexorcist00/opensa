import { describe, expect, it } from 'vitest';

import type { AudioListener } from './spatial';
import type { FakeAudioBuffer } from './test/fake-context';

import { audibleGain } from './spatial';
import { FakeAudioContext, type FakeBufferSource, type FakeGain } from './test/fake-context';
import { ALERT_FLOOR, CAD_RESERVE, DUCK_DEPTH, LIMITER_THRESHOLD_DB, MAX_VOICES, VoicePool } from './voices';

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

/**
 * How many gain nodes the pool builds before any voice does: the master, then one a bus.
 *
 * Named rather than counted at each call site, because these tests reach into the graph by INDEX and the
 * indices all moved the day the buses landed — which is the sort of brittleness worth paying once.
 */
const FIXED_GAINS = 1 + 3;

/** One bus's gain, in the order the pool builds them. */
function busGain(context: FakeAudioContext, bus: 'cad' | 'map' | 'world'): FakeGain | undefined {
  return context.gains[1 + ['cad', 'map', 'world'].indexOf(bus)];
}

/** The master gain: the first node the pool ever builds. */
function masterGain(context: FakeAudioContext): FakeGain | undefined {
  return context.gains[0];
}

/** The gain of the n-th voice. */
function voiceGain(context: FakeAudioContext, index: number): number {
  return voiceGainNode(context, index)?.gain.value ?? Number.NaN;
}

/** The n-th voice's own gain node. */
function voiceGainNode(context: FakeAudioContext, index: number): FakeGain | undefined {
  return context.gains[index + FIXED_GAINS];
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

      expect(sourceOf(context, 0).connectedTo[0]).toBe(voiceGainNode(context, 0));
      expect(voiceGainNode(context, 0)?.connectedTo[0]).toBe(context.panners[0]);
      // …and the pan reaches the master through its BUS, which is what makes a level and a duck possible.
      expect(context.panners[0]?.connectedTo[0]).toBe(busGain(context, 'world'));
      expect(busGain(context, 'world')?.connectedTo[0]).toBe(masterGain(context));
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
      expect(voiceGainNode(context, 1)?.disconnected).toBe(true);
    });

    it('RAMPS a cut voice to zero rather than stepping it — a step is a click', () => {
      const context = new FakeAudioContext();
      context.currentTime = 5;
      const pool = new VoicePool(context, { maxVoices: 1 });
      pool.setListener(AT_ORIGIN);
      const first = pool.play({ buffer: buffer(context), gain: 0.02, position: [0, 200, 0] });

      pool.play({ buffer: buffer(context), gain: 1, position: [0, 5, 0] });

      const gain = voiceGainNode(context, 0);
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

      // The master reaches the speakers THROUGH the limiter (204/1-02), which is the last node in the chain.
      expect(masterGain(context)?.connectedTo[0]).toBe(context.compressors[0]);
      expect(context.compressors[0]?.connectedTo[0]).toBe(context.destination);
      // Every bus lands on the ONE master, so mute and volume are still a single value.
      for (const bus of ['cad', 'map', 'world'] as const) {
        expect(busGain(context, bus)?.connectedTo[0]).toBe(masterGain(context));
      }
      expect(context.panners[0]?.connectedTo[0]).toBe(busGain(context, 'world'));
      expect(context.panners[1]?.connectedTo[0]).toBe(busGain(context, 'world'));
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

describe('VoicePool buses', () => {
  describe('negative cases', () => {
    it('never refuses an alert, however full the world has made the pool', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);
      // Sixty-four engines at full scale, every one of them louder than the alert about to arrive.
      for (let at = 0; at < MAX_VOICES; at += 1) {
        pool.play({ buffer: buffer(context), gain: 1, position: null });
      }
      expect(pool.report().live).toBe(MAX_VOICES);

      const alert = pool.play({ buffer: buffer(context), bus: 'cad', gain: 0.8, position: null });

      // The defect this plan opened on: ranked by `audibleGain` alone, 0.8 loses to sixty-four 1.0s and
      // `play` answers null. A dispatcher's panic button may not lose to traffic.
      expect(alert).not.toBeNull();
      expect(pool.report().refusedByBus.cad).toBe(0);
    });

    it('refuses a world voice quieter than every other rather than growing past the ceiling', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);
      for (let at = 0; at < MAX_VOICES; at += 1) {
        pool.play({ buffer: buffer(context), gain: 1, position: null });
      }

      // Decision 4.2 is untouched INSIDE a bus: the quietest at the listener still decides.
      expect(pool.play({ buffer: buffer(context), gain: 0.1, position: null })).toBeNull();
      expect(pool.report().live).toBe(MAX_VOICES);
      expect(pool.report().refusedByBus.world).toBe(1);
    });

    it('does not let one bus take another bus below its reserve', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context, { maxVoices: 8 });
      for (let at = 0; at < CAD_RESERVE; at += 1) {
        pool.play({ buffer: buffer(context), bus: 'cad', gain: 0.5, position: null });
      }
      while (pool.report().live < 8) {
        pool.play({ buffer: buffer(context), gain: 1, position: null });
      }

      // The world is full and loud, and every cad voice is quieter — but they are its reserve.
      expect(pool.play({ buffer: buffer(context), gain: 1, position: null })).toBeNull();
      expect(pool.report().liveByBus.cad).toBe(CAD_RESERVE);
    });
  });

  describe('positive cases', () => {
    it('puts every voice through its own bus and then the master', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);
      pool.setBusGain('world', 0.5);

      pool.play({ buffer: buffer(context), gain: 1, position: null });

      expect(pool.report().busGain.world).toBe(0.5);
      expect(pool.report().busGain.cad).toBe(1);
    });

    it('steals within a bus before it reaches for another one', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context, { maxVoices: 4 });
      // The globally quietest voice is in the WORLD, and the arriving cad voice is louder than both of its
      // own. A rule that ranked across all buses at once would take the world's 0.05; the rule tidies its
      // own house first and takes its own 0.6.
      pool.play({ buffer: buffer(context), gain: 0.05, position: null });
      pool.play({ buffer: buffer(context), gain: 0.9, position: null });
      pool.play({ buffer: buffer(context), bus: 'cad', gain: 0.6, position: null });
      pool.play({ buffer: buffer(context), bus: 'cad', gain: 0.7, position: null });

      pool.play({ buffer: buffer(context), bus: 'cad', gain: 0.8, position: null });

      expect(pool.report().liveByBus).toMatchObject({ cad: 2, world: 2 });
    });

    it('counts a bus that is over its reserve as fair game for one that is under', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context, { maxVoices: 4 });
      for (let at = 0; at < 4; at += 1) {
        pool.play({ buffer: buffer(context), gain: 1, position: null });
      }

      expect(pool.play({ buffer: buffer(context), bus: 'cad', gain: 0.01, position: null })).not.toBeNull();
      expect(pool.report().liveByBus).toMatchObject({ cad: 1, world: 3 });
      expect(pool.report().steals).toBeGreaterThan(0);
    });

    it('defaults a voice that names no bus to the world, which is where the city is', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);

      pool.play({ buffer: buffer(context), gain: 1, position: null });

      expect(pool.report().liveByBus.world).toBe(1);
    });
  });
});

describe('VoicePool limiter', () => {
  describe('negative cases', () => {
    it('sits AFTER the master, so turning the volume down really does limit less', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);

      // Before the master, a master at 1.0 could push a limited signal back over full scale — the order is
      // what makes the ceiling a ceiling.
      expect(masterGain(context)?.connectedTo[0]).toBe(context.compressors[0]);
      expect(context.compressors[0]?.connectedTo[0]).toBe(context.destination);
      expect(pool.report().limiter.reduction).toBe(0);
    });

    it('is set as a LIMITER rather than as a musical compressor', () => {
      const context = new FakeAudioContext();
      new VoicePool(context);
      const limiter = context.compressors[0];

      // Values rather than the constants they came from: comparing a constant with itself passes whatever
      // it is set to, which is how a ratio of 4 — a musical compressor, not a ceiling — would slip through.
      expect(limiter?.knee.value).toBe(0);
      // 20 is the highest Web Audio allows, and a limiter wants a wall rather than a slope.
      expect(limiter?.ratio.value).toBe(20);
      // A ceiling near the top, not a squash: below about -12 dB every real mix is being flattened.
      expect(limiter?.threshold.value).toBeLessThan(0);
      expect(limiter?.threshold.value).toBeGreaterThan(-12);
      expect(limiter?.attack.value).toBeLessThanOrEqual(0.005);
      expect(limiter?.release.value).toBeGreaterThanOrEqual(0.1);
    });

    it('builds exactly one, however many voices come and go', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);
      for (let at = 0; at < 10; at += 1) {
        pool.play({ buffer: buffer(context), position: null });
      }

      expect(context.compressors).toHaveLength(1);
    });
  });

  describe('positive cases', () => {
    it('reports how hard the mix is pushing, which is a number about the CONTENT', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);

      // `reduction` is the browser's own read-only measurement; a rising one says the world is too hot for
      // the ceiling, which is a mixing verdict rather than a limiter fault.
      const limiter = context.compressors[0];
      if (limiter) {
        limiter.reduction = -4.5;
      }

      expect(pool.report().limiter.reduction).toBe(-4.5);
      expect(pool.report().limiter.thresholdDb).toBe(LIMITER_THRESHOLD_DB);
    });
  });
});

describe('VoicePool ducking', () => {
  /** What the `world` bus node is actually set to right now, ramps included. */
  function worldNow(context: FakeAudioContext): FakeGain | undefined {
    return busGain(context, 'world');
  }

  describe('negative cases', () => {
    it('leaves the world alone while nothing is on the cad bus', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);

      pool.play({ buffer: buffer(context), position: null });
      pool.play({ buffer: buffer(context), bus: 'map', position: null });

      expect(worldNow(context)?.gain.value).toBe(1);
      expect(pool.report().ducked).toBe(false);
    });

    it('never ducks the bus doing the ducking', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);

      pool.play({ buffer: buffer(context), bus: 'cad', position: null });

      // An alert that quietened itself would be a very thorough way to lose one.
      expect(busGain(context, 'cad')?.gain.ramps).toHaveLength(0);
      expect(busGain(context, 'cad')?.gain.value).toBe(1);
    });

    it('lets the world back up when the alert ends', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);
      pool.play({ buffer: buffer(context), bus: 'cad', position: null });
      expect(pool.report().ducked).toBe(true);

      sourceOf(context, 0).finish();

      expect(pool.report().ducked).toBe(false);
      const ramps = worldNow(context)?.gain.ramps ?? [];
      expect(ramps[ramps.length - 1]?.value).toBe(1);
    });
  });

  describe('positive cases', () => {
    it('pulls the world and the map down, and does it as a RAMP', () => {
      const context = new FakeAudioContext();
      context.currentTime = 2;
      const pool = new VoicePool(context);

      pool.play({ buffer: buffer(context), bus: 'cad', position: null });

      for (const bus of ['map', 'world'] as const) {
        const ramps = busGain(context, bus)?.gain.ramps ?? [];
        expect(ramps[ramps.length - 1]?.value).toBeCloseTo(DUCK_DEPTH, 9);
        // A step here would be a click on the very sound that must not draw attention to the mixer.
        expect(ramps[ramps.length - 1]?.time).toBeGreaterThan(2);
      }
      expect(pool.report().ducked).toBe(true);
    });

    it('MULTIPLIES the operator’s own level rather than replacing it', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);
      pool.setBusGain('world', 0.5);

      pool.play({ buffer: buffer(context), bus: 'cad', position: null });

      // The operator asked for half a city; a duck makes it a quarter of that, not a fixed number that
      // forgets what they asked for.
      const ramps = worldNow(context)?.gain.ramps ?? [];
      expect(ramps[ramps.length - 1]?.value).toBeCloseTo(0.5 * DUCK_DEPTH, 9);
      expect(pool.report().busGain.world).toBe(0.5);
    });

    it('stays down while ANY alert is live, not just the first', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);
      pool.play({ buffer: buffer(context), bus: 'cad', position: null });
      pool.play({ buffer: buffer(context), bus: 'cad', position: null });

      sourceOf(context, 0).finish();

      // Two alerts inside one bad second is ordinary; the world coming back between them is not.
      expect(pool.report().ducked).toBe(true);
    });
  });
});

describe('VoicePool alert floor', () => {
  describe('negative cases', () => {
    it('is a FLOOR and not an exemption: a muted alert is quiet, not full', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);
      pool.setBusGain('cad', 0);

      pool.play({ buffer: buffer(context), bus: 'cad', floored: true, position: null });

      // The operator asked for silence and gets something well under it — not their level ignored.
      expect(busGain(context, 'cad')?.gain.value).toBe(ALERT_FLOOR);
      expect(ALERT_FLOOR).toBeLessThan(0.5);
      expect(ALERT_FLOOR).toBeGreaterThan(0);
    });

    it('does not raise a bus for an ordinary alert', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);
      pool.setBusGain('cad', 0);

      // A routine chime is not a panic button; muting the bus really does silence it.
      pool.play({ buffer: buffer(context), bus: 'cad', position: null });

      expect(busGain(context, 'cad')?.gain.value).toBe(0);
    });

    it('drops back to the operator’s level once the floored voice ends', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);
      pool.setBusGain('cad', 0);
      pool.play({ buffer: buffer(context), bus: 'cad', floored: true, position: null });

      sourceOf(context, 0).finish();

      expect(busGain(context, 'cad')?.gain.value).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('never pulls a bus DOWN to the floor when the operator asked for more', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);
      pool.setBusGain('cad', 1);

      pool.play({ buffer: buffer(context), bus: 'cad', floored: true, position: null });

      expect(busGain(context, 'cad')?.gain.value).toBe(1);
    });

    it('says in the report that a floor is holding a bus open', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);
      pool.setBusGain('cad', 0);

      pool.play({ buffer: buffer(context), bus: 'cad', floored: true, position: null });

      // The operator's level is unchanged and the report says so; the floor is the mixer's doing.
      expect(pool.report().busGain.cad).toBe(0);
      expect(pool.report().flooring).toEqual(['cad']);
    });
  });
});

describe('VoicePool output peak', () => {
  describe('negative cases', () => {
    it('reports no peak before anything has been read — a level nobody measured is not zero, it is absent', () => {
      const pool = new VoicePool(new FakeAudioContext());

      expect(pool.report().peakSample).toBe(0);
    });

    it('reads silence as silence rather than as a peak nobody could trace', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);

      pool.sampleOutput();

      expect(pool.report().peakSample).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('holds the loudest sample seen, and measures MAGNITUDE rather than value', () => {
      // A waveform's worst excursion is as often negative as positive, and a peak that only looked at the
      // positive half would report a clipping mix as a quiet one.
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);
      const analyser = context.analysers[0];
      if (!analyser) {
        throw new Error('the pool built no output tap');
      }

      analyser.samples = new Float32Array([0.2, -0.81, 0.4]);
      pool.sampleOutput();

      expect(pool.report().peakSample).toBeCloseTo(0.81, 5);
    });

    it('never forgets a peak a later quiet read would hide', () => {
      // The number 1/02's arithmetic is judged on is the worst the mix ever reached, not where it is now.
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);
      const analyser = context.analysers[0];
      if (!analyser) {
        throw new Error('the pool built no output tap');
      }

      analyser.samples = new Float32Array([0.9]);
      pool.sampleOutput();
      analyser.samples = new Float32Array([0.01]);
      pool.sampleOutput();

      expect(pool.report().peakSample).toBeCloseTo(0.9, 5);
    });

    it('taps AFTER the limiter, so the number is what left the graph', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);
      const analyser = context.analysers[0];

      // The compressor feeds it; the master does not. A tap before the limiter would report a peak the
      // speakers never saw, which is the opposite of the question 5/01 asks.
      expect(context.compressors[0]?.connectedTo).toContain(analyser);
      expect(masterGain(context)?.connectedTo).not.toContain(analyser);
      void pool;
    });
  });
});

describe('VoicePool peak per bus', () => {
  describe('negative cases', () => {
    it('starts every bus at zero, including ones nothing ever played on', () => {
      const pool = new VoicePool(new FakeAudioContext());

      expect(pool.report().peakByBus).toEqual({ cad: 0, map: 0, world: 0 });
    });
  });

  describe('positive cases', () => {
    it('counts each bus SEPARATELY, which is the only way a reserve can be judged', () => {
      // Sixty-four voices at once is an ordinary city; the question 1/01's reserves are judged on is how
      // many of them were alerts, and a single total cannot answer it.
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);

      pool.play({ buffer: buffer(context), bus: 'world', position: null });
      pool.play({ buffer: buffer(context), bus: 'world', position: null });
      pool.play({ buffer: buffer(context), bus: 'cad', position: null });

      expect(pool.report().peakByBus).toEqual({ cad: 1, map: 0, world: 2 });
    });

    it('remembers a bus’s high-water mark after its voices have gone', () => {
      const context = new FakeAudioContext();
      const pool = new VoicePool(context);
      const first = pool.play({ buffer: buffer(context), bus: 'cad', position: null });
      pool.play({ buffer: buffer(context), bus: 'cad', position: null });

      first?.stop();

      expect(pool.report().peakByBus.cad).toBe(2);
      expect(pool.report().liveByBus.cad).toBe(1);
    });
  });
});
