import { createRecordingHost, decodeScript, ScriptRunner } from '@opensa/cleo';
import { describe, expect, it } from 'vitest';

import { compileScript } from '../../sdk/src/build';
import { script as definition, SPEC } from './script';

const FRAME_MS = 1000 / 60;
const CAR = 257;
/** Anything that is not the hotring — a stock car in the same street. */
const OTHER_MODEL = 400;

interface RunOptions {
  /** Cars in range, as (handle, model) pairs. Default: one hotring. */
  readonly cars?: readonly { handle: number; model: number }[];
  readonly frames?: number;
}

const run = (options: RunOptions = {}): { budget: number; calls: readonly string[] } => {
  const host = createRecordingHost({
    cars: options.cars ?? [{ handle: CAR, model: SPEC.HOTRING_MODEL }],
  });
  const runner = new ScriptRunner({ host });
  runner.spawn(decodeScript(compileScript(definition).bytes), definition.name);
  let budget = 0;
  for (let frame = 0; frame < (options.frames ?? 60); frame += 1) {
    runner.tick(FRAME_MS);
    budget = Math.max(budget, runner.instructionsLastTick);
  }
  expect(runner.faults).toEqual([]);

  return { budget, calls: host.calls };
};

/** The light-status writes, in order. */
const smashes = (calls: readonly string[]): readonly string[] =>
  calls.filter((line) => line.startsWith('natives.setLightStatus'));

describe('no-lights (the authored hotring light-killer)', () => {
  describe('negative cases', () => {
    it('leaves every other car alone — one model compare decides it', () => {
      const { calls } = run({ cars: [{ handle: CAR, model: OTHER_MODEL }] });

      expect(smashes(calls)).toEqual([]);
    });

    it('does nothing with no cars in range, and never faults doing it', () => {
      const { calls } = run({ cars: [] });

      expect(smashes(calls)).toEqual([]);
    });

    it('touches only the hotring when it shares the street with other cars', () => {
      const { calls } = run({
        cars: [
          { handle: CAR, model: OTHER_MODEL },
          { handle: CAR + 256, model: SPEC.HOTRING_MODEL },
          { handle: CAR + 512, model: OTHER_MODEL },
        ],
      });

      expect(new Set(smashes(calls).map((line) => line.split(' ')[1]))).toEqual(new Set([`car#${CAR + 256}`]));
    });
  });

  describe('positive cases', () => {
    it('smashes all four lamps, in SA’s own eLights order', () => {
      const { calls } = run({ frames: 2 });

      expect(smashes(calls)).toEqual(
        SPEC.LIGHTS.map((light) => `natives.setLightStatus car#${CAR} light ${light} -> SMASHED`),
      );
    });

    it('POLLS rather than running every frame — the effect is idempotent and permanent', () => {
      // 60 frames at 60 fps is one second: a 400 ms poll must fire ~3 times, not 60.
      const { calls } = run({ frames: 60 });

      const polls = smashes(calls).length / SPEC.LIGHTS.length;
      expect(polls).toBeGreaterThanOrEqual(2);
      expect(polls).toBeLessThanOrEqual(4);
    });

    it('stays inside its declared per-tick budget on the poll frame the budget describes', () => {
      // The declared budget is a POLL tick with the hotring plus 16 cars of traffic in range — assert it
      // against exactly that, not against the one-car case the other tests use.
      const { budget } = run({
        cars: [
          { handle: CAR, model: SPEC.HOTRING_MODEL },
          ...Array.from({ length: 16 }, (_, index) => ({ handle: CAR + (index + 1) * 256, model: OTHER_MODEL })),
        ],
      });

      expect(budget).toBeLessThanOrEqual(definition.budgetPerTick);
    });
  });
});
