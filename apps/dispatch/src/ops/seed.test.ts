import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { UNITS_ON_SCREEN } from './budget';
import { BoardHistory } from './history';
import { DEMO_MODELS, demoModel, initialOperations } from './seed';

describe('initialOperations', () => {
  describe('negative cases', () => {
    it('seeds nothing when the board is asked for nothing', () => {
      const ops = initialOperations(0, { calls: 0, units: 0 });

      expect(ops.units).toHaveLength(0);
      expect(ops.incidents).toHaveLength(0);
    });

    it('never puts two units on the same id', () => {
      const ops = initialOperations(0, { calls: 4, units: UNITS_ON_SCREEN });
      const ids = new Set(ops.units.map((unit) => unit.id));

      expect(ids.size).toBe(UNITS_ON_SCREEN);
    });
  });

  describe('positive cases', () => {
    it('opens the demo shift with the nine named cars', () => {
      const ops = initialOperations(1000);

      expect(ops.units).toHaveLength(9);
      expect(ops.units[0].callsign).toBe('1-ADAM-12');
      expect(ops.incidents).toHaveLength(2);
    });

    it('loads the board to the declared worst case', () => {
      const ops = initialOperations(0, { calls: 40, units: UNITS_ON_SCREEN });

      expect(ops.units).toHaveLength(UNITS_ON_SCREEN);
      expect(ops.incidents).toHaveLength(40);
      expect(ops.log[0]).toContain('150 units on duty');
    });

    it('is deterministic — the same size is the same board twice', () => {
      expect(initialOperations(0, { calls: 6, units: 60 })).toEqual(initialOperations(0, { calls: 6, units: 60 }));
    });

    it('scatters the generated cars instead of stacking them on the landmarks', () => {
      const ops = initialOperations(0, { calls: 0, units: UNITS_ON_SCREEN });
      const places = new Set(ops.units.slice(9).map((unit) => `${unit.at[0]},${unit.at[1]}`));

      expect(places.size).toBe(UNITS_ON_SCREEN - 9);
    });
  });
});

/**
 * `scripts/phone.sh`'s default vehicle subset, as the script itself declares it.
 *
 * The field run converts a HANDFUL of cars because the roster costs hours on a phone, so which handful is a
 * decision, and on 2026-08-30 it was a stale one: the script carried `admiral,infernus,comet` from before the
 * console drew units as models, and THE FIELD RUN measured 150 symbols against a budget written for 150
 * models (201/5-02). Nothing failed — the console logged three lines and drew the fallback — which is why the
 * two lists get held together here rather than by a reader noticing.
 */
function phoneDefaultVehicles(): readonly string[] {
  const script = readFileSync(new URL('../../../../scripts/phone.sh', import.meta.url), 'utf8');
  const declared = /^VEHICLES="\$\{VEHICLES:-(.+?)\}"$/m.exec(script);

  return declared ? declared[1].split(',') : [];
}

describe('the empty board THE FIELD RUN opens on', () => {
  describe('negative cases', () => {
    it('seeds nothing at all at `?units=0&calls=0`, rather than falling back to the default shift', () => {
      // The user's call, 2026-08-31: the map is optimised first, so the field run carries no board. A
      // fallback here would put nine units and two calls into every window meant to price the map.
      const ops = initialOperations(0, { calls: 0, units: 0 });

      expect(ops.units).toEqual([]);
      expect(ops.incidents).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('is a board the history can be asked about without a unit on it', () => {
      const history = new BoardHistory();
      const ops = initialOperations(0, { calls: 0, units: 0 });
      history.record(ops);

      expect(history.trails(ops.now).size).toBe(0);
      expect(history.fixAges(ops.now).size).toBe(0);
      // No samples means no span, and `null` is the honest answer rather than a zero-width one: the
      // timeline disables its scrub on exactly this value (`timeline-bar.tsx`), so an invented window
      // would give the operator a slider over nothing.
      expect(history.window()).toBeNull();
    });
  });
});

describe('the mock board against the pak the field run converts', () => {
  describe('negative cases', () => {
    it('names no model stock San Andreas does not have — `copcarls` was one for a week', () => {
      // The LS police car is `copcarla`; `copcarls` is in no roster, so every patrol unit resolved to nothing
      // on every pak and drew as a symbol. The fallback and a thin convert leave the SAME line in the log.
      expect(Object.values(DEMO_MODELS).flat()).not.toContain('copcarls');
    });
  });

  describe('positive cases', () => {
    it('asks for nothing `phone.sh` leaves out of its default convert', () => {
      const converted = phoneDefaultVehicles();

      expect(converted.length).toBeGreaterThan(0);
      expect(converted).toEqual(expect.arrayContaining([...Object.values(DEMO_MODELS).flat()]));
    });

    it('puts FIVE model types on the board, because the type count is what the budget scales on', () => {
      // `ops/budget.ts`: a shift is a handful of TYPES however many units it has. Three types measured three;
      // 201's budget says a handful, so patrol drives the three real police cars rather than one.
      expect(new Set(Object.values(DEMO_MODELS).flat()).size).toBe(5);
    });

    it('gives a service its cars in a stable order, so the same board comes back every run', () => {
      // A fixture that shuffles is a fixture no capture can be compared against.
      expect([0, 1, 2, 3].map((index) => demoModel('patrol', index))).toEqual([
        'copcarla',
        'copcarsf',
        'copcarvg',
        'copcarla',
      ]);
      expect(demoModel('ambulance', 7)).toBe('ambulan');
    });
  });
});
