import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { decodeScript } from '../core/decode';
import { createRecordingHost } from './recording-host';
import { ScriptRunner } from './runner';

/** Real corpus scripts on the real decoder — the plan 03 headless integration. */
const CORPUS = 'tests/original/cleo';

const load = (name: string): ReturnType<typeof decodeScript> =>
  decodeScript(new Uint8Array(readFileSync(`${CORPUS}/${name}.cs`)));

describe.skipIf(!existsSync(CORPUS))('corpus on the VM', () => {
  describe('positive cases', () => {
    it('Ferris Wheel produces the expected host-call story headless', () => {
      const host = createRecordingHost();
      const runner = new ScriptRunner({ host });
      runner.spawn(load('ferris'), 'ferris');
      for (let frame = 0; frame < 60; frame += 1) {
        runner.tick(1000 / 60);
      }
      expect(runner.faults).toEqual([]);

      // The story: request the four models (14644-14647), poll, then build — the base (#1), the
      // wheel HD+LOD (#2/#3, linked), the lights HD+LOD (#4/#5, linked) and SIXTEEN seats.
      expect(host.calls.filter((line) => line.startsWith('models.request'))).toHaveLength(4);
      expect(host.calls.filter((line) => line.startsWith('models.isAvailable'))).toHaveLength(4);
      expect(host.calls.filter((line) => line.startsWith('objects.create'))).toHaveLength(21);
      expect(host.calls).toContain('objects.connectLods 2 3');
      expect(host.calls).toContain('objects.connectLods 4 5');
      // …then per frame: the wheel and lights rotate, and every seat rides the rim (sin/cos).
      expect(host.calls.filter((line) => line.startsWith('objects.setRotation')).length).toBeGreaterThan(50);
      expect(host.calls.filter((line) => line.startsWith('objects.setCoordinates')).length).toBeGreaterThan(500);
    });

    it('the Ferris rotation angle ADVANCES across frames (the wheel actually turns)', () => {
      const host = createRecordingHost();
      const runner = new ScriptRunner({ host });
      runner.spawn(load('ferris'), 'ferris');
      for (let frame = 0; frame < 120; frame += 1) {
        runner.tick(1000 / 60);
      }
      // The wheel is #2; its rotation is (0, angle, 90) — the middle component advances with time
      // (0079 ADD_TIMED_VAL: ~4.8° over the first second).
      const angles = host.calls
        .filter((line) => line.startsWith('objects.setRotation #2 '))
        .map((line) => Number(line.split(' ')[2].split(',')[1]));
      expect(angles.length).toBeGreaterThan(50);
      expect(angles[angles.length - 1]).toBeGreaterThan(angles[0] + 5);
      // Monotone non-decreasing — the wheel never jumps backwards.
      for (let index = 1; index < angles.length; index += 1) {
        expect(angles[index]).toBeGreaterThanOrEqual(angles[index - 1]);
      }
    });

    it('Wind Farm runs to its model-request loop with stdlib + mocked facets only', () => {
      const host = createRecordingHost();
      const runner = new ScriptRunner({ host });
      const thread = runner.spawn(load('windfarm'), 'windfarm');
      for (let frame = 0; frame < 120; frame += 1) {
        runner.tick(1000 / 60);
      }
      expect(runner.faults).toEqual([]);
      expect(thread.terminated).toBe(false);
      // The four models the mod ships, resolved by NAME (0E9C) — each found (id ≥ 20000).
      for (const name of ['windturb_base', 'windturb_fan', 'lodwindturb_base', 'lodwindturb_fan']) {
        expect(namedId(host.calls, name)).toBeGreaterThanOrEqual(20000);
      }
      // Its native READ_MEMORY reads surface as unimplemented (plan 05's domain), never as faults.
      expect(host.calls.some((line) => line.startsWith('onUnimplemented 0A8D'))).toBe(true);
    });

    it('cardoor (class C) degrades cleanly: unimplemented ped-task ops, zero faults', () => {
      const host = createRecordingHost();
      const runner = new ScriptRunner({ host });
      runner.spawn(load('cardoor-coach'), 'cardoor');
      for (let frame = 0; frame < 60; frame += 1) {
        runner.tick(1000 / 60);
      }
      expect(runner.faults).toEqual([]);
    });

    it('rhino ticks within budget headless (empty world — the full loop needs plan 05 natives)', () => {
      const host = createRecordingHost();
      const runner = new ScriptRunner({ host });
      const thread = runner.spawn(load('rhino'), 'rhino');
      const counts: number[] = [];
      for (let frame = 0; frame < 60; frame += 1) {
        runner.tick(1000 / 60);
        counts.push(runner.instructionsLastTick);
      }
      expect(runner.faults).toEqual([]);
      expect(thread.terminated).toBe(false);
      expect(Math.max(...counts)).toBeLessThan(10_000);
    });
  });
});

function namedId(calls: readonly string[], name: string): number {
  const line = calls.find((entry) => entry.startsWith(`models.byName ${name} -> `));

  return line ? Number(line.split(' -> ')[1]) : -1;
}
