import { PANEL_CATEGORY } from '@opensa/audio';
import { describe, expect, it } from 'vitest';

import type { Operations, Unit } from '../ops/types';

import { CadMock, MOCK_MEAN_SECONDS } from './cad-mock';

function board(units: readonly Unit[]): Operations {
  return { incidents: [], log: [], now: 0, units: [...units] };
}

/** A random that returns each number in turn and then repeats the last — enough to drive one draw. */
function scripted(...values: readonly number[]): () => number {
  let at = 0;

  return () => values[Math.min(at++, values.length - 1)];
}

function unit(id: string): Unit {
  return {
    at: [0, 0],
    callsign: `1-ADAM-${id}`,
    elevation: 0,
    heading: 0,
    id,
    incident: null,
    kind: 'patrol',
    model: 'copcarla',
    speed: 0,
    status: 'available',
    target: null,
  };
}

describe('CadMock', () => {
  describe('negative cases', () => {
    it('says nothing on a board with no units — a panic from nobody is unactionable', () => {
      expect(new CadMock(scripted(0)).step(board([]), 1)).toBeNull();
    });

    it('says nothing across no time at all, so a tick that did not advance cannot draw', () => {
      expect(new CadMock(scripted(0)).step(board([unit('12')]), 0)).toBeNull();
    });

    it('draws against the declared MEAN rather than against the gap, so its rate does not follow the clock', () => {
      // The number that matters is messages per MINUTE: the same mock on a 10 Hz tick and on a 2 Hz one has
      // to sound the same, which it only does if the gap is divided by the mean. At 10 Hz the threshold is
      // one tick in 450.
      const gap = 0.1;
      const threshold = gap / MOCK_MEAN_SECONDS;

      expect(new CadMock(scripted(threshold * 0.99, 0, 0)).step(board([unit('12')]), gap)).not.toBeNull();
      expect(new CadMock(scripted(threshold * 1.01)).step(board([unit('12')]), gap)).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('speaks when the draw lands, about a unit that is on the board, with a name the panel knows', () => {
      const mock = new CadMock(scripted(0, 0, 0));

      const said = mock.step(board([unit('12')]), 1);

      expect(said?.sound).toBe('assist_request');
      expect(said?.body).toContain('1-ADAM-12');
    });

    it('only ever names sounds the contract carries on the cad bus', () => {
      // The stand-in exists to exercise the `cad` budget; a name on another bus would exercise the wrong one.
      const seen = new Set<string>();
      for (let draw = 0; draw < 32; draw += 1) {
        const said = new CadMock(scripted(0, 0, draw / 32)).step(board([unit('12')]), MOCK_MEAN_SECONDS);
        if (said?.sound !== undefined) {
          seen.add(said.sound);
        }
      }

      expect(seen.size).toBeGreaterThan(1);
      for (const name of seen) {
        expect(PANEL_CATEGORY[name]).toBe('cad');
      }
    });

    it('always carries the sound field, which is what the contract asks the real CAD for', () => {
      for (let draw = 0; draw < 16; draw += 1) {
        expect(new CadMock(scripted(0, 0, draw / 16)).step(board([unit('12')]), 1)?.sound).toBeDefined();
      }
    });
  });
});
