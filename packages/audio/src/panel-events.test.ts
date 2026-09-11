import { describe, expect, it } from 'vitest';

import { COALESCE_MS, FLOORED, PANEL_CATEGORY, PanelEvents, VARY } from './panel-events';
import { PanelSounds } from './panel-sounds';
import { FakeAudioContext } from './test/fake-context';
import { PANEL_TONES } from './tones';
import { MAX_VOICES, VoicePool } from './voices';

/** What the `cad` bus node is set to right now. */
function busGainNow(context: FakeAudioContext): number {
  // The pool builds the master first, then one gain a bus in the order cad, map, world.
  return context.gains[1]?.gain.value ?? Number.NaN;
}

/** A player over a real pool and the synthesised floor — no files, which is the normal case. */
function harness(
  now?: () => number,
  random?: () => number,
): { context: FakeAudioContext; events: PanelEvents; pool: VoicePool } {
  const context = new FakeAudioContext();
  const pool = new VoicePool(context);

  return { context, events: new PanelEvents({ now, pool, random, sounds: PanelSounds.resolve(context) }), pool };
}

describe('PanelEvents', () => {
  describe('negative cases', () => {
    it('says a name nothing knows ONCE, however often it arrives', () => {
      const { events } = harness();

      for (let at = 0; at < 5; at += 1) {
        expect(events.event('shift_change')).toBeNull();
      }

      // A vocabulary mismatch between two repositories is one fact, not five.
      expect(events.report().unknown).toEqual(['shift_change']);
      expect(events.report().played).toBe(0);
    });

    it('plays nothing at all on a surface with no pool', () => {
      const events = new PanelEvents({ pool: null });

      expect(events.event('panic_button')).toBeNull();
      expect(events.report().played).toBe(0);
    });

    it('does not call a name UNKNOWN just because this build has no sound for it', () => {
      // A build with no AudioContext holds an empty sound set, so every contract name would resolve to
      // nothing. Listing them here would make the `?audio=0` baseline capture read exactly like a real
      // vocabulary mismatch with PCAD — the one failure this field exists to report.
      const events = new PanelEvents({ pool: null });

      events.event('panic_button');
      events.event('link_lost');
      events.event('shift_change');

      expect(events.report().unknown).toEqual(['shift_change']);
    });

    it('never lets an alert be refused, even with the world full', () => {
      const { context, events, pool } = harness();
      for (let at = 0; at < MAX_VOICES; at += 1) {
        pool.play({ buffer: context.createBuffer(1, 100, 22_050), gain: 1, position: null });
      }

      expect(events.event('panic_button')).not.toBeNull();
      expect(events.report().refused).toBe(0);
    });

    it('floors only the two events the whole chain exists for', () => {
      // A floor that covers everything is a mute that does not work.
      expect([...FLOORED].sort()).toEqual(['link_lost', 'panic_button']);
    });

    it('keeps a MUTED console reachable by a panic, and not by a chime', () => {
      const { context, events, pool } = harness();
      pool.setBusGain('cad', 0);

      events.event('notification');
      // A routine chime really is silenced: the operator asked for that.
      expect(busGainNow(context)).toBe(0);

      events.event('panic_button');

      // The reserve is not what does this — that is about SLOTS. This is the floor, and only a floored
      // event opens a muted bus.
      expect(busGainNow(context)).toBeGreaterThan(0);
      expect(pool.report().flooring).toEqual(['cad']);
    });
  });

  describe('positive cases', () => {
    it('plays an event on the bus its CATEGORY owns', () => {
      const { events, pool } = harness();

      events.event('panic_button');
      events.event('unit_arrived');

      expect(pool.report().liveByBus).toMatchObject({ cad: 1, map: 1 });
      expect(events.report().byCategory).toMatchObject({ cad: 1, map: 1, world: 0 });
    });

    it('measures the gap from when the EVENT happened, not from when it was asked to play', () => {
      let clock = 1_000;
      const { events } = harness(() => clock);

      // A message that took 200 ms to cross a socket and 1 ms to reach a speaker is a LATE alert; a number
      // that started its clock at the speaker would call it instant.
      clock = 1_200;
      events.event('panic_button', 1_000);

      expect(events.report().maxLatencyMs).toBe(200);
    });

    it('reads zero for an event this surface raised itself', () => {
      const clock = 500;
      const { events } = harness(() => clock);

      events.event('unit_arrived');

      expect(events.report().maxLatencyMs).toBe(0);
    });

    it('keeps the worst gap rather than the last', () => {
      let clock = 0;
      const { events } = harness(() => clock);
      clock = 90;
      events.event('notification', 0);
      clock = 100;
      events.event('notification', 95);

      expect(events.report().maxLatencyMs).toBe(90);
    });

    it('puts the board’s lifecycle in `map` and the plugin’s own events in `cad`', () => {
      // The contract's test, asserted rather than described: can the console SEE it in the board it holds?
      const mapNames = Object.keys(PANEL_CATEGORY)
        .filter((name) => PANEL_CATEGORY[name] === 'map')
        .sort();

      expect(mapNames).toEqual([
        'call_closed',
        'call_created_p1',
        'call_created_p2',
        'call_created_p3',
        'incident_created',
        'unit_arrived',
        'unit_assigned',
        'unit_stale',
      ]);
      // Nothing panel-shaped belongs on the world bus: that one is the city's.
      expect(Object.values(PANEL_CATEGORY)).not.toContain('world');
    });

    it('gives every name in the vocabulary a category, and every category a real bus', () => {
      for (const name of Object.keys(PANEL_TONES)) {
        // A name with a tone and no category would play on nothing; one with a category and no tone would be
        // silent. The two tables are the same contract and must not drift.
        expect(PANEL_CATEGORY[name], name).toBeDefined();
      }
      expect(Object.keys(PANEL_CATEGORY).sort()).toEqual(Object.keys(PANEL_TONES).sort());
    });
  });
});

describe('PanelEvents coalescing and variation', () => {
  describe('negative cases', () => {
    it('folds a burst of one name into the tone already sounding', () => {
      let clock = 0;
      const { events, pool } = harness(() => clock);

      // Ten calls arriving at once is an ordinary bad minute, and ten identical chimes is a machine gun.
      for (let at = 0; at < 10; at += 1) {
        clock += 10;
        events.event('call_created_p3');
      }

      expect(events.report().played).toBe(1);
      expect(events.report().coalesced).toBe(9);
      expect(pool.report().started).toBe(1);
    });

    it('never folds two DIFFERENT names together', () => {
      let clock = 0;
      const { events } = harness(() => clock);

      events.event('call_created_p3');
      clock += 10;
      // A panic during a burst of new calls is not a repetition of anything.
      events.event('panic_button');

      expect(events.report().played).toBe(2);
      expect(events.report().coalesced).toBe(0);
    });

    it('lets the same name through again once its window has passed', () => {
      let clock = 0;
      const { events } = harness(() => clock);
      events.event('notification');

      clock = COALESCE_MS + 1;
      events.event('notification');

      expect(events.report().played).toBe(2);
    });
  });

  describe('positive cases', () => {
    it('detunes every play, so a queue is not one recording repeated', () => {
      let clock = 0;
      let roll = 0;
      const { context, events } = harness(
        () => clock,
        () => {
          roll += 0.5;

          return roll % 1;
        },
      );

      events.event('notification');
      clock = COALESCE_MS + 1;
      events.event('notification');

      const rates = context.sources.map((source) => source.playbackRate.value);
      expect(rates[0]).not.toBe(rates[1]);
      // Small enough that nobody could name the interval.
      for (const rate of rates) {
        expect(Math.abs(rate - 1)).toBeLessThanOrEqual(VARY + 1e-9);
      }
    });

    it('keeps the window per name rather than globally', () => {
      let clock = 0;
      const { events } = harness(() => clock);

      for (const name of ['call_created_p1', 'call_created_p2', 'call_created_p3', 'unit_arrived']) {
        clock += 5;
        events.event(name);
      }

      expect(events.report().played).toBe(4);
    });
  });
});
