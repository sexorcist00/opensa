import type { OsaudioZone } from '@opensa/engine-formats';

import { describe, expect, it } from 'vitest';

import type { AmbienceHost, AmbienceLoop } from './ambience';
import type { Voice } from './voices';

import {
  Ambience,
  BED_FULL_HEIGHT,
  BED_SILENT_HEIGHT,
  bedGainForHeight,
  bedLayerNames,
  bedNameFor,
  CROSSFADE_SECONDS,
  DEFAULT_BED,
  TWIN_SWAP_MAX_MS,
  TWIN_SWAP_MIN_MS,
  TWIN_SWAP_SECONDS,
} from './ambience';

/** One `startLoop` call, as the fake saw it. */
interface StartedLoop {
  fraction: number;
  /** The LEVEL the bed asked for, before the row's own gain. */
  gain: number;
  name: string;
  voice: number;
}

/** A host that answers immediately and writes down everything it was asked. */
class FakeHost implements AmbienceHost {
  readonly beddless: string[] = [];
  readonly gains: { gain: number; seconds: number; voice: number }[] = [];
  now = 0;
  readonly refused = new Set<string>();
  /** Refuse every call from this one on — how a pool that filled up looks from here. */
  refuseFrom = Number.POSITIVE_INFINITY;
  /** What the table says every row of this fake is authored at. */
  rowGain = 1;
  readonly started: StartedLoop[] = [];
  readonly stopped: number[] = [];
  private at = 0;
  private calls = 0;
  private readonly names: ReadonlySet<string>;
  private nextVoice = 1;
  private readonly randoms: readonly number[];

  constructor(names: readonly string[], randoms: readonly number[] = [0.5]) {
    this.names = new Set(names);
    this.randoms = randoms;
  }

  has(name: string): boolean {
    return this.names.has(name);
  }

  noLayers(bed: string): void {
    this.beddless.push(bed);
  }

  nowMs(): number {
    return this.now;
  }

  random(): number {
    const value = this.randoms[this.at % this.randoms.length] ?? 0;
    this.at += 1;

    return value;
  }

  setGain(voice: Voice, gain: number, seconds: number): void {
    this.gains.push({ gain, seconds, voice: voice.id });
  }

  async startLoop(name: string, startFraction: number, level: number): Promise<AmbienceLoop | null> {
    await Promise.resolve();
    this.calls += 1;
    if (this.refused.has(name) || this.calls > this.refuseFrom) {
      return null;
    }
    const id = this.nextVoice;
    this.nextVoice += 1;
    this.started.push({ fraction: startFraction, gain: level, name, voice: id });

    return {
      gain: this.rowGain,
      voice: {
        id,
        live: true,
        stop: (): void => {
          this.stopped.push(id);
        },
      },
    };
  }
}

/** Let every `startLoop` promise settle. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** A box zone the listener is always inside. */
function zone(name: string, id = 1): OsaudioZone {
  return {
    active: true,
    id,
    max: [1_000, 1_000, 1_000],
    min: [-1_000, -1_000, -1_000],
    name,
    shape: 'box',
  };
}

describe('ambience', () => {
  describe('negative cases', () => {
    it('falls back to the default bed when the zone names one the table has not got', () => {
      const host = new FakeHost([DEFAULT_BED]);
      const ambience = new Ambience(host);

      ambience.update(zone('LS_CLUB'), [0, 0, 0], 0.1);

      expect(ambience.report().bed).toBe(DEFAULT_BED);
    });

    it('starts nothing when the table carries no ambience rows at all', async () => {
      const host = new FakeHost([]);
      const ambience = new Ambience(host);

      ambience.update(null, [0, 0, 0], 0.1);
      await settle();

      expect(host.started).toHaveLength(0);
      expect(ambience.report()).toMatchObject({ bed: DEFAULT_BED, layers: 0, starts: 0 });
      // Said once, and it is what `docs/in-reserve/audio-stream-tracks.md` is triggered from.
      expect(host.beddless).toEqual([DEFAULT_BED]);
    });

    it('stops a voice whose bed was retired while its fetch was in flight', async () => {
      const host = new FakeHost([DEFAULT_BED]);
      const ambience = new Ambience(host);

      ambience.update(null, [0, 0, 0], 0.1);
      ambience.stop();
      await settle();

      expect(host.stopped).toHaveLength(2);
      expect(ambience.report().starts).toBe(0);
    });

    it('never swaps a twin whose other half never started, and keeps the one that did', async () => {
      const host = new FakeHost([DEFAULT_BED]);
      // The second voice never arrives: a pool that was full, or a fetch that failed.
      host.refuseFrom = 1;
      const ambience = new Ambience(host);
      ambience.update(null, [0, 0, 0], CROSSFADE_SECONDS);
      await settle();
      expect(ambience.report().starts).toBe(1);
      host.gains.length = 0;

      host.now = TWIN_SWAP_MAX_MS + 1;
      ambience.update(null, [0, 0, 0], 0.1);

      expect(ambience.report().swaps).toBe(0);
      expect(host.gains).toEqual([{ gain: 1, seconds: 0.1, voice: 1 }]);
    });

    it('is silent at and above the height the bed stops carrying', () => {
      expect(bedGainForHeight(BED_SILENT_HEIGHT)).toBe(0);
      expect(bedGainForHeight(BED_SILENT_HEIGHT + 500)).toBe(0);
    });

    it('drops a layer the table does not carry rather than stopping at the gap', () => {
      const has = (name: string): boolean => name === 'AMB_X' || name === 'AMB_X_3';

      expect(bedLayerNames('AMB_X', has)).toEqual(['AMB_X', 'AMB_X_3']);
    });
  });

  describe('positive cases', () => {
    it('names a zone bed from the zone, upper-cased and with the separators folded', () => {
      expect(bedNameFor(zone('ls beach.1'))).toBe('AMB_LS_BEACH_1');
      expect(bedNameFor(null)).toBe(DEFAULT_BED);
    });

    it('is at full volume below the height rule and falls linearly above it', () => {
      expect(bedGainForHeight(0)).toBe(1);
      expect(bedGainForHeight(BED_FULL_HEIGHT)).toBe(1);
      expect(bedGainForHeight((BED_FULL_HEIGHT + BED_SILENT_HEIGHT) / 2)).toBeCloseTo(0.5, 6);
    });

    it('starts a twin as two voices of one sound, one audible and one muted', async () => {
      const host = new FakeHost([DEFAULT_BED]);
      const ambience = new Ambience(host);

      ambience.update(null, [0, 0, 0], 0.1);
      await settle();

      expect(host.started).toHaveLength(2);
      expect(host.started.map((one) => one.name)).toEqual([DEFAULT_BED, DEFAULT_BED]);
      expect(host.started[1]?.gain).toBe(0);
      expect(ambience.report()).toMatchObject({ layers: 1, starts: 2 });
    });

    it('draws the two start points at least a third of the loop apart', async () => {
      for (const randoms of [[0], [0.5], [0.99], [0.2, 0.8], [0.7, 0.1]]) {
        const host = new FakeHost([DEFAULT_BED], randoms);
        const ambience = new Ambience(host);
        ambience.update(null, [0, 0, 0], 0.1);
        await settle();
        const [first, second] = host.started;
        const apart = Math.abs((first?.fraction ?? 0) - (second?.fraction ?? 0));

        expect(Math.min(apart, 1 - apart)).toBeGreaterThanOrEqual(1 / 3 - 1e-9);
      }
    });

    it('fades a bed in over the crossfade rather than starting it at full volume', () => {
      const host = new FakeHost([DEFAULT_BED]);
      const ambience = new Ambience(host);

      ambience.update(null, [0, 0, 0], CROSSFADE_SECONDS / 4);
      expect(ambience.report().level).toBeCloseTo(0.25, 6);

      ambience.update(null, [0, 0, 0], CROSSFADE_SECONDS / 4);
      expect(ambience.report().level).toBeCloseTo(0.5, 6);

      ambience.update(null, [0, 0, 0], CROSSFADE_SECONDS);
      expect(ambience.report().level).toBe(1);
    });

    it('crossfades to the zone bed and retires the old one once it is out', async () => {
      const host = new FakeHost([DEFAULT_BED, 'AMB_LS_BEACH']);
      const ambience = new Ambience(host);
      ambience.update(null, [0, 0, 0], CROSSFADE_SECONDS);
      await settle();
      const outgoing = host.started.map((one) => one.voice);

      ambience.update(zone('ls beach'), [0, 0, 0], 0.1);
      await settle();
      expect(ambience.report()).toMatchObject({ bed: 'AMB_LS_BEACH', changes: 2, fading: 1 });
      expect(host.stopped).toHaveLength(0);

      ambience.update(zone('ls beach'), [0, 0, 0], CROSSFADE_SECONDS);

      expect(ambience.report().fading).toBe(0);
      expect([...host.stopped].sort()).toEqual([...outgoing].sort());
    });

    it('exchanges the twin volumes at its interval and re-rolls the next one', async () => {
      const host = new FakeHost([DEFAULT_BED]);
      const ambience = new Ambience(host);
      ambience.update(null, [0, 0, 0], CROSSFADE_SECONDS);
      await settle();
      host.gains.length = 0;

      host.now = TWIN_SWAP_MAX_MS + 1;
      ambience.update(null, [0, 0, 0], 0.1);

      const exchanged = host.gains.filter((one) => one.seconds !== 0.1);
      expect(exchanged).toHaveLength(2);
      expect(exchanged.map((one) => one.gain)).toEqual([1, 0]);
      // Ramped, never stepped. SA exchanges the two volumes instantly, and a step in an envelope is a click.
      expect(exchanged.every((one) => one.seconds > 0 && one.seconds < 0.1)).toBe(true);
      expect(exchanged[0]?.seconds).toBe(TWIN_SWAP_SECONDS);
      expect(exchanged[0]?.voice).toBe(2);
      expect(ambience.report().swaps).toBe(1);

      host.gains.length = 0;
      ambience.update(null, [0, 0, 0], 0.1);
      expect(ambience.report().swaps).toBe(1);
    });

    it('never swaps before the window opens', async () => {
      const host = new FakeHost([DEFAULT_BED], [0]);
      const ambience = new Ambience(host);
      ambience.update(null, [0, 0, 0], CROSSFADE_SECONDS);
      await settle();

      host.now = TWIN_SWAP_MIN_MS - 1;
      ambience.update(null, [0, 0, 0], 0.1);

      expect(ambience.report().swaps).toBe(0);
    });

    it('scales the bed by the height rule, so a console at altitude is quiet', async () => {
      const host = new FakeHost([DEFAULT_BED]);
      const ambience = new Ambience(host);
      ambience.update(null, [0, 0, 0], CROSSFADE_SECONDS);
      await settle();
      host.gains.length = 0;

      ambience.update(null, [0, 0, (BED_FULL_HEIGHT + BED_SILENT_HEIGHT) / 2], 0.1);

      expect(host.gains[0]?.gain).toBeCloseTo(0.5, 6);
    });

    it("keeps the ROW's authored gain under the envelope rather than replacing it", async () => {
      const host = new FakeHost([DEFAULT_BED]);
      host.rowGain = 0.3;
      const ambience = new Ambience(host);
      ambience.update(null, [0, 0, 0], CROSSFADE_SECONDS);
      await settle();
      host.gains.length = 0;

      ambience.update(null, [0, 0, 0], 0.1);

      // Envelope 1 x row 0.3. Handing the pool a bare 1 would collapse a 0.5/0.3/0.2 bed to three 1.0s and
      // play a zone authored SILENT at full volume.
      expect(host.gains[0]?.gain).toBeCloseTo(0.3, 9);
    });

    it('stacks every authored layer of one bed', async () => {
      const host = new FakeHost([DEFAULT_BED, `${DEFAULT_BED}_2`, `${DEFAULT_BED}_4`]);
      const ambience = new Ambience(host);

      ambience.update(null, [0, 0, 0], 0.1);
      await settle();

      expect(ambience.report()).toMatchObject({ layers: 3, starts: 6 });
    });
  });
});
