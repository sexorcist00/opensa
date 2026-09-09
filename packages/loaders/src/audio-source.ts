/**
 * Where a SOUND's bytes come from (203/2-02) — one range request, no archive, no decode.
 *
 * The same shape `model-source.ts` uses for cars, for the same reason: the pak carries the world and nothing
 * about audio, so the samples are read out of the built game dir that is already served beside it. What
 * makes it cheap is that the addressing was decided at build time — `audio.osaudio` holds the absolute byte
 * range of every sound — so a voice costs ONE `Range:` request and the 364 MB of PCM never moves.
 *
 * **Everything here degrades to `null` rather than to an error** (203's decision 4.3): a pak served without
 * its game dir, a total conversion with no `audio/SFX/`, a host that does not do ranges. Each is silence
 * plus one line naming the package, never a throw into a frame.
 *
 * **It hands back PCM, not an `AudioBuffer`.** This package must not know that Web Audio exists — the
 * conversion to float and the buffer creation belong to `@opensa/audio`, which owns the context. A loader
 * that returned an `AudioBuffer` would drag a browser API into every consumer of this one.
 */
import type { OsaudioIndex } from '@opensa/engine-formats';

/** One sound's samples, by its position in the index's flat sound table. */
export interface AudioSource {
  /** Package names that could not be read — what the report counts and the log names, once each. */
  readonly missing: ReadonlySet<string>;
  /**
   * Signed 16-bit mono samples, or `null` when this build cannot produce them.
   *
   * @param soundIndex position in {@link OsaudioIndex.sounds} — the id 5/01's event table resolves to.
   */
  read(soundIndex: number): Promise<Int16Array | null>;
}

/**
 * Open the audio source for a served game dir, or `null` when there is no game dir (the demo, a pak-only
 * deploy). The packages themselves are never probed: a sound that cannot be fetched says so when it is
 * asked for, because probing nine files at boot to learn what a first request would tell you is a boot cost
 * for nothing.
 */
export function openAudioSource(gameDir: string, index: OsaudioIndex): AudioSource | null {
  if (gameDir === '' || index.sounds.length === 0) {
    return null;
  }
  const packageOfSound = mapSoundsToPackages(index);
  const missing = new Set<string>();

  return {
    missing,
    async read(soundIndex: number): Promise<Int16Array | null> {
      const sound = index.sounds[soundIndex];
      const packageName = index.packages[packageOfSound[soundIndex] ?? -1];
      if (!sound || packageName === undefined || sound.byteLength <= 0) {
        return null;
      }
      const url = `${gameDir}/audio/SFX/${packageName}`;
      const end = sound.byteOffset + sound.byteLength - 1;
      let bytes: Uint8Array;
      try {
        const response = await fetch(url, { headers: { Range: `bytes=${sound.byteOffset}-${end}` } });
        if (!response.ok) {
          missing.add(packageName);

          return null;
        }
        bytes = new Uint8Array(await response.arrayBuffer());
      } catch {
        missing.add(packageName);

        return null;
      }
      // A host that ignores `Range:` answers 200 with the WHOLE package — 304.9 MB for SCRIPT — and the
      // first samples of the file are a plausible-sounding wrong answer. Length is the only tell, and it is
      // exact: the index states what was asked for.
      if (bytes.byteLength !== sound.byteLength) {
        missing.add(packageName);

        return null;
      }

      return toSamples(bytes);
    },
  };
}

/** Which package each sound lives in, resolved once from the bank table — one byte a sound. */
function mapSoundsToPackages(index: OsaudioIndex): Uint8Array {
  const owners = new Uint8Array(index.sounds.length).fill(0xff);
  for (const bank of index.banks) {
    const end = Math.min(bank.firstSound + bank.soundCount, owners.length);
    for (let at = bank.firstSound; at < end; at += 1) {
      owners[at] = bank.packageIndex;
    }
  }

  return owners;
}

/**
 * Bytes to samples.
 *
 * Copied into a fresh buffer rather than viewed, because a `fetch` body is not guaranteed to be 2-aligned
 * once a caller has sliced it, and an `Int16Array` view of an odd offset throws. An odd LENGTH is truncated
 * to the sample below: half a sample is not a sample, and the alternative is refusing a sound over one byte.
 */
function toSamples(bytes: Uint8Array): Int16Array {
  const samples = new Int16Array(Math.floor(bytes.byteLength / 2));
  new Uint8Array(samples.buffer).set(bytes.subarray(0, samples.byteLength));

  return samples;
}
