import { describe, expect, it } from 'vitest';

import type { Incident, Operations, Unit } from '../ops/types';

import { boardEvents } from './board-events';

function board(units: Unit[] = [], incidents: Incident[] = []): Operations {
  return { incidents, log: [], now: 0, units };
}

function call(over: Partial<Incident> = {}): Incident {
  return {
    assigned: [],
    at: [0, 0],
    code: '10-50',
    id: 'i1',
    opened: 0,
    place: 'Ganton',
    priority: 2,
    remaining: 10,
    status: 'pending',
    title: 'Traffic collision',
    ...over,
  };
}

function unit(over: Partial<Unit> = {}): Unit {
  return {
    at: [0, 0],
    callsign: '1-ADAM-12',
    elevation: 0,
    heading: 0,
    id: 'u1',
    incident: null,
    kind: 'patrol',
    model: 'copcarla',
    speed: 0,
    status: 'available',
    target: null,
    ...over,
  };
}

describe('boardEvents', () => {
  describe('negative cases', () => {
    it('says nothing about the FIRST board it ever sees', () => {
      // Every call on it is already there rather than newly arrived, and a console that announced its whole
      // roster at open is one somebody mutes in the first minute.
      expect(boardEvents(null, board([unit()], [call()]))).toEqual([]);
    });

    it('says nothing when nothing changed', () => {
      const now = board([unit()], [call()]);

      expect(boardEvents(now, now)).toEqual([]);
    });

    it('does not announce a unit coming on duty', () => {
      const after = boardEvents(board([]), board([unit({ incident: 'i1', status: 'enRoute' })]));

      // A unit appearing mid-shift is not a dispatch event; the contract gives it no name.
      expect(after).toEqual([]);
    });

    it('does not raise a closure twice for a call that stays closed', () => {
      const closed = board([], [call({ status: 'closed' })]);

      expect(boardEvents(closed, closed)).toEqual([]);
    });

    it('does not raise an arrival for a unit that was already on scene', () => {
      const there = board([unit({ status: 'onScene' })]);

      expect(boardEvents(there, there)).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('announces a unit RE-DIRECTED from one call to another', () => {
      // `assignUnit` moves a unit straight from one incident to another without passing through patrol, and
      // a dispatcher re-directing a unit mid-run is exactly the moment worth hearing.
      const before = board([unit({ incident: 'i1', status: 'enRoute' })]);
      const after = board([unit({ incident: 'i2', status: 'enRoute' })]);

      expect(boardEvents(before, after)).toEqual(['unit_assigned']);
    });

    it('codes a new call by its PRIORITY, because every other channel does', () => {
      for (const [priority, name] of [
        [1, 'call_created_p1'],
        [2, 'call_created_p2'],
        [3, 'call_created_p3'],
      ] as const) {
        expect(boardEvents(board(), board([], [call({ id: `i${priority}`, priority })]))).toEqual([name]);
      }
    });

    it('raises an assignment when a unit takes a call', () => {
      const before = board([unit()]);
      const after = board([unit({ incident: 'i1', status: 'enRoute' })]);

      expect(boardEvents(before, after)).toEqual(['unit_assigned']);
    });

    it('raises an arrival when a unit reaches its scene', () => {
      const before = board([unit({ incident: 'i1', status: 'enRoute' })]);
      const after = board([unit({ incident: 'i1', status: 'onScene' })]);

      expect(boardEvents(before, after)).toEqual(['unit_arrived']);
    });

    it('raises a closure when a call clears', () => {
      const before = board([], [call({ status: 'onScene' })]);
      const after = board([], [call({ status: 'closed' })]);

      expect(boardEvents(before, after)).toEqual(['call_closed']);
    });

    it('reports everything that happened on one tick, not just the first', () => {
      const before = board([unit()], [call()]);
      const after = board([unit({ incident: 'i1', status: 'onScene' })], [call(), call({ id: 'i2', priority: 1 })]);

      expect(boardEvents(before, after)).toEqual(['call_created_p1', 'unit_assigned', 'unit_arrived']);
    });
  });
});
