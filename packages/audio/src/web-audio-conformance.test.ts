import { describe, expect, it } from 'vitest';

import type {
  AudioBufferSourceLike,
  AudioContextLike,
  DynamicsCompressorLike,
  GainLike,
  StereoPannerLike,
} from './audio-host.interface';

export type BufferSourceConforms = MustSatisfy<AudioBufferSourceLike, AudioBufferSourceNode>;

export type CompressorConforms = MustSatisfy<DynamicsCompressorLike, DynamicsCompressorNode>;
export type ContextConforms = MustSatisfy<AudioContextLike, AudioContext>;
export type GainConforms = MustSatisfy<GainLike, GainNode>;
export type StereoPannerConforms = MustSatisfy<StereoPannerLike, StereoPannerNode>;
/**
 * A COMPILE-TIME test, and the only kind that can catch this class.
 *
 * Every structural type in this package is a hand-written subset of Web Audio, and the real context enters
 * through a constructor cast — so nothing would tell us if a member drifted from the API it claims to
 * describe until a browser did, at runtime, in silence. The aliases below make `tsc` do it: each real DOM
 * type must satisfy ours, member for member and signature for signature. `npm run lint:ts` is what runs it,
 * and the `it` at the bottom is only here so the file reads as what it is.
 *
 * **It has already earned its place.** The first version of `AudioContextLike` declared `state` as
 * `'closed' | 'running' | 'suspended'`, and this line is what said otherwise: Apple's platforms also have
 * **`interrupted`**, entered when a phone call or Siri takes the hardware. A host that did not know the
 * state would have handled it by luck.
 */
type MustSatisfy<Expected, Actual extends Expected> = Actual;

describe('the Web Audio subset this package declares', () => {
  describe('positive cases', () => {
    it('is satisfied by the browser’s own types — the aliases above are the assertion, tsc is the runner', () => {
      expect(true).toBe(true);
    });
  });
});
