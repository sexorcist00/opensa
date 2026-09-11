/**
 * Where a panel sound comes from, and why it can never be missing (204/2-02).
 *
 * **Two layers, and the order is the reliability argument.** A deployment that ships the authored set sounds
 * like PCAD, which is the whole point of a shared vocabulary; one that cannot still alerts, because the
 * floor under it is [arithmetic](./tones.ts) rather than a file. A name therefore always resolves to
 * something, and which layer answered is in the report rather than in a guess.
 *
 * **It holds AudioBuffers, not bytes.** A panel sound is wanted within
 * [50 ms of the event](../../../docs/plans/204-panel-audio/readme.md) — an order of magnitude under 203's
 * cold-start budget, because a sound answering an action reads as a coincidence if it is late — so nothing
 * on that path may fetch, decode or convert. Everything is built once, on load.
 */
import type { AudioBufferLike, AudioContextLike } from './audio-host.interface';

import { PANEL_TONES, renderTone } from './tones';

/** What a capture says about the panel's own sounds. */
export interface PanelSoundsReport {
  /** Names served by an authored file. */
  readonly files: number;
  /** Names served by the synthesised floor. A build on the floor is a fact worth having in a capture. */
  readonly tones: number;
}

/** Which layer answered for a name. */
export type SoundSource = 'file' | 'tone';

/**
 * The lowest rate a `createBuffer` will take, and what the tones are rendered at.
 *
 * A tone is a sine and a sine needs nothing above twice its own frequency; 22 050 is far more than the
 * 1 174 Hz the vocabulary tops out at, and it keeps the whole set to a few hundred kilobytes of memory.
 */
export const TONE_RATE = 22_050;

/** Every panel sound this build can make, built once and held. */
export class PanelSounds {
  private readonly buffers = new Map<string, AudioBufferLike>();
  private readonly sources = new Map<string, SoundSource>();

  private constructor() {
    // Built through `resolve`, which is the only shape that can state what answered for each name.
  }

  /** A set with nothing in it — a surface with no context to build buffers on. */
  static empty(): PanelSounds {
    return new PanelSounds();
  }

  /**
   * Build every name, preferring an authored file and falling back to a tone.
   *
   * @param files decoded authored buffers by name, from whatever the app bundled. Empty is normal.
   */
  static resolve(context: AudioContextLike, files: ReadonlyMap<string, AudioBufferLike> = new Map()): PanelSounds {
    const sounds = new PanelSounds();
    // **Every name resolves, structurally.** The set is the UNION of the tone table and whatever the app
    // bundled, so a name is either a file (served as one) or a tone (rendered), and there is no third case
    // to report. A `missing` list here was written and then deleted: a mutation proved the branch could not
    // be reached, and a guard that cannot fire is worse than no guard — it reads as protection.
    for (const name of new Set([...Object.keys(PANEL_TONES), ...files.keys()])) {
      const file = files.get(name);
      if (file) {
        sounds.buffers.set(name, file);
        sounds.sources.set(name, 'file');
        continue;
      }
      sounds.buffers.set(name, toBuffer(context, renderTone(PANEL_TONES[name] ?? [], TONE_RATE)));
      sounds.sources.set(name, 'tone');
    }

    return sounds;
  }

  /** The buffer for a name, or `null` — which should only ever happen for a name nothing knows. */
  find(name: string): AudioBufferLike | null {
    return this.buffers.get(name) ?? null;
  }

  report(): PanelSoundsReport {
    let files = 0;
    let tones = 0;
    for (const source of this.sources.values()) {
      if (source === 'file') {
        files += 1;
      } else {
        tones += 1;
      }
    }

    return { files, tones };
  }

  /** Which layer answered for a name — what makes *this build is on the floor* a fact rather than a guess. */
  sourceOf(name: string): null | SoundSource {
    return this.sources.get(name) ?? null;
  }
}

/** Samples into a mono buffer at the tone rate. */
function toBuffer(context: AudioContextLike, samples: Float32Array): AudioBufferLike {
  const buffer = context.createBuffer(1, samples.length, TONE_RATE);
  buffer.copyToChannel(samples, 0);

  return buffer;
}
