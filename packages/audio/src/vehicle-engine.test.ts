import { describe, expect, it } from 'vitest';

import {
  CRZ_FADE_SECONDS,
  gainOf,
  IDLE_FADE_SECONDS,
  IDLE_RATIO,
  idleProgress,
  REV_RATIO,
  revProgress,
  VehicleEngine,
} from './vehicle-engine';

/** Settle an engine at one ratio: enough ticks for both fades to finish. */
function settled(engine: VehicleEngine, ratio: number): ReturnType<VehicleEngine['update']> {
  let voicing = engine.update(ratio, 0);
  for (let tick = 0; tick < 20; tick += 1) {
    voicing = engine.update(ratio, Math.max(IDLE_FADE_SECONDS, CRZ_FADE_SECONDS));
  }

  return voicing;
}

describe('VehicleEngine', () => {
  describe('negative cases', () => {
    it('is silent on both loops when the engine is not running', () => {
      const engine = new VehicleEngine();

      const voicing = engine.update(0.8, 0.1, false);

      expect(voicing).toMatchObject({ idleGain: 0, revGain: 0, state: 'off' });
    });

    it('drops the rev loop entirely once a car has settled into idling', () => {
      const voicing = settled(new VehicleEngine(), 0);

      // Not "very quiet" — actually zero, which is one fewer voice against the 64 for every parked car.
      expect(voicing.revGain).toBe(0);
      expect(voicing.idleGain).toBeGreaterThan(0);
    });

    it('does not flip state inside the hysteresis band the original leaves', () => {
      const engine = new VehicleEngine();
      settled(engine, 0.9);
      expect(engine.update(0.9, 0.1).state).toBe('crz');

      // 0.17 is below the idle threshold and above the rev one: a cruising car stays cruising.
      expect(engine.update(0.17, 0.1).state).toBe('crz');

      // From a standstill the same 0.17 is idling — the two thresholds are different numbers on purpose.
      const cold = new VehicleEngine();
      expect(cold.update(0.17, 0.1).state).toBe('id');
    });

    it('clamps a ratio outside 0..1 rather than extrapolating the curves', () => {
      const over = settled(new VehicleEngine(), 5);
      const at = settled(new VehicleEngine(), 1);

      expect(over.revPitch).toBeCloseTo(at.revPitch, 9);
    });

    it('answers a gain of zero for a dB figure at the floor rather than an infinity', () => {
      expect(gainOf(-100)).toBe(0);
      expect(gainOf(-200)).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('pitches the idle loop across the range the original states', () => {
      expect(settled(new VehicleEngine(), 0).idlePitch).toBeCloseTo(0.85, 6);
      // Just under the threshold, so the car is still idling and the range is the bare one.
      expect(settled(new VehicleEngine(), IDLE_RATIO - 1e-6).idlePitch).toBeCloseTo(1.2, 5);
    });

    it('drops the idle loop a sixth in pitch once the rev loop has taken over', () => {
      // AT the threshold the car is cruising, and a cruising idle loop is multiplied by 0.85 (0x8CC0EC) —
      // 1.2 x 0.85. It is the sound of the idle bed stepping back rather than being cut.
      expect(settled(new VehicleEngine(), IDLE_RATIO).idlePitch).toBeCloseTo(1.02, 6);
    });

    it('pitches the rev loop across its own range, which starts where the rev ratio does', () => {
      expect(revProgress(REV_RATIO)).toBe(0);
      expect(revProgress(1)).toBe(1);
      expect(settled(new VehicleEngine(), 1).revPitch).toBeCloseTo(1.5, 6);
    });

    it('reaches full idle progress at the idle ratio and not before', () => {
      expect(idleProgress(0)).toBe(0);
      expect(idleProgress(IDLE_RATIO / 2)).toBeCloseTo(0.5, 9);
      expect(idleProgress(IDLE_RATIO)).toBe(1);
      expect(idleProgress(1)).toBe(1);
    });

    it('hands the sound from idle to rev as a car goes from stopped to flat out', () => {
      const parked = settled(new VehicleEngine(), 0);
      const flatOut = settled(new VehicleEngine(), 1);

      expect(parked.idleGain).toBeGreaterThan(parked.revGain);
      expect(flatOut.revGain).toBeGreaterThan(flatOut.idleGain);
    });

    it('crossfades over the stated DURATION rather than switching in one tick', () => {
      const engine = new VehicleEngine();
      settled(engine, 0);
      // The tick that changes state restarts both fades; the ones after it walk them.
      engine.update(1, 0.1);

      const midway = engine.update(1, CRZ_FADE_SECONDS / 2);
      const done = engine.update(1, CRZ_FADE_SECONDS / 2);

      expect(midway.state).toBe('crz');
      // Half way through, the idle loop is still carrying the sound and the rev loop is under it.
      expect(midway.idleGain).toBeGreaterThan(0.5);
      expect(midway.revGain).toBeGreaterThan(0.5);
      // A fade later the handover is finished, and it took the whole duration to get there.
      expect(done.idleGain).toBeLessThan(0.01);
      expect(done.revGain).toBeGreaterThan(midway.revGain);
    });

    it('honours a positive volume offset by leaving room above unity gain', () => {
      // A truck authors +6 dB in column O; a model that clamped at 1 could not say a rig is louder.
      expect(gainOf(6)).toBeGreaterThan(1.9);
      expect(gainOf(0)).toBe(1);
    });
  });
});
