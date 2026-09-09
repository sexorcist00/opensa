import { decodeOsaudio, type OsaudioIndex } from '@opensa/engine-formats';
import { buildAudioIndex, openAudioRanges } from '@opensa/opensa-pack/audio-index';
import { openGameDir } from '@opensa/opensa-pack/game-fs';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { gameArg, gameDir } from '../lib/game';

/**
 * What is actually IN the SFX banks — and a way to hear one (plan 203/5-02, and 4/02's blocked question).
 *
 * The census counted the banks; this one opens them. **Nothing in the data says what a sound IS**: SA keeps
 * the event→sound mapping in code, so `GENRL` bank 40 slot 2 is a name nobody wrote down. The only way to
 * write the event table is to look at the shape of a sound — its length, its rate, whether it LOOPS — and
 * then to listen to the candidates.
 *
 * So this prints the shape, and `--wav` writes one out as a playable file: on the phone that is a tap in the
 * file manager, which turns *"which slot is the city hum"* from a research task into a few seconds.
 *
 * **`--loops` is the one that matters right now.** A looping sound is what a bed is made of, and the stock
 * game has 351 of them. Whether an ambience bed can be assembled from SFX loops at all — rather than taken
 * from `audio/streams`, which this chain's v1 excludes — is the question 4/02 is blocked on, and this is the
 * evidence for it.
 *
 * ```bash
 * npx tsx scripts/debug/audio-bank-probe.ts --loops            # every looping sound, longest first
 * npx tsx scripts/debug/audio-bank-probe.ts --bank 40          # one bank, slot by slot
 * npx tsx scripts/debug/audio-bank-probe.ts --wav 40 2 --out /tmp/hum.wav
 * ```
 */

/** How many rows a listing prints before it says how many more there were. */
const LISTED = 40;
/** Below this a sound is a click rather than a bed — the loop listing's own floor. */
const BED_SECONDS = 1;

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function has(name: string): boolean {
  return process.argv.includes(name);
}

/** One bank, slot by slot — what a `--wav` is picked from. */
function listBank(index: OsaudioIndex, at: number): void {
  const bank = index.banks[at];
  if (!bank) {
    console.log(`[bank-probe] no bank ${at} — this build has ${index.banks.length}`);

    return;
  }
  console.log(
    `[bank-probe] bank ${at} · package ${index.packages[bank.packageIndex] ?? '?'} · ${bank.soundCount} sounds`,
  );
  for (let slot = 0; slot < bank.soundCount; slot += 1) {
    const sound = index.sounds[bank.firstSound + slot];
    if (!sound) {
      continue;
    }
    console.log(
      `  ${String(slot).padStart(3)} ${sound.durationSeconds.toFixed(2).padStart(7)}s ` +
        `${String(sound.sampleRate).padStart(6)} Hz ${sound.loopOffset >= 0 ? `loop@${sound.loopOffset}` : 'one-shot'} ` +
        `· ${sound.byteLength} bytes at ${sound.byteOffset}`,
    );
  }
}

/** Every bank, with what it holds — the map to pick a `--bank` from. */
function listBanks(index: OsaudioIndex): void {
  console.log(`[bank-probe] ${index.banks.length} banks in ${index.packages.length} packages`);
  index.banks.forEach((bank, at) => {
    const sounds = index.sounds.slice(bank.firstSound, bank.firstSound + bank.soundCount);
    const seconds = sounds.reduce((total, sound) => total + sound.durationSeconds, 0);
    const loops = sounds.filter((sound) => sound.loopOffset >= 0).length;
    if (at < LISTED) {
      console.log(
        `  ${String(at).padStart(3)} ${(index.packages[bank.packageIndex] ?? '?').padEnd(7)} ` +
          `${String(bank.soundCount).padStart(3)} sounds · ${seconds.toFixed(1)}s · ${loops} looping`,
      );
    }
  });
  if (index.banks.length > LISTED) {
    console.log(`  … and ${index.banks.length - LISTED} more (use --bank <n>)`);
  }
}

/** Every looping sound long enough to be a bed, longest first — 4/02's evidence. */
function listLoops(index: OsaudioIndex): void {
  const owner = new Map<number, number>();
  index.banks.forEach((bank, at) => {
    for (let slot = 0; slot < bank.soundCount; slot += 1) {
      owner.set(bank.firstSound + slot, at);
    }
  });
  const loops = index.sounds
    .map((sound, at) => ({ at, sound }))
    .filter(({ sound }) => sound.loopOffset >= 0 && sound.durationSeconds >= BED_SECONDS)
    .sort((a, b) => b.sound.durationSeconds - a.sound.durationSeconds);
  const total = index.sounds.filter((sound) => sound.loopOffset >= 0).length;
  console.log(`[bank-probe] ${total} looping sounds · ${loops.length} of them at least ${BED_SECONDS}s`);
  for (const { at, sound } of loops.slice(0, LISTED)) {
    const bank = owner.get(at) ?? -1;
    const slot = at - (index.banks[bank]?.firstSound ?? 0);
    console.log(
      `  bank ${String(bank).padStart(3)} slot ${String(slot).padStart(3)} · ${sound.durationSeconds.toFixed(2)}s ` +
        `${sound.sampleRate} Hz · package ${index.packages[index.banks[bank]?.packageIndex ?? 0] ?? '?'}`,
    );
  }
  if (loops.length > LISTED) {
    console.log(`  … and ${loops.length - LISTED} more`);
  }
}

function main(): void {
  const game = gameArg();
  const tree = flag('--dir') ?? gameDir(game);
  if (!existsSync(join(tree, 'audio', 'CONFIG', 'BankLkup.dat'))) {
    console.log(`[bank-probe] SKIPPED — '${tree}' carries no audio/CONFIG/BankLkup.dat.`);
    process.exit(0);
  }
  const ranges = openAudioRanges(tree);
  try {
    const bake = buildAudioIndex(openGameDir(tree), ranges.read);
    if (bake === null) {
      console.log(`[bank-probe] SKIPPED — ${tree} has no audio index to build`);
      process.exit(0);
    }
    const index = decodeOsaudio(bake.bytes);
    const wav = flag('--wav');
    if (wav !== undefined) {
      writeWav(index, Number(wav), Number(process.argv[process.argv.indexOf('--wav') + 2]), ranges.read, flag('--out'));

      return;
    }
    if (has('--loops')) {
      listLoops(index);

      return;
    }
    const bank = flag('--bank');
    if (bank !== undefined) {
      listBank(index, Number(bank));

      return;
    }
    listBanks(index);
  } finally {
    ranges.close();
  }
}

/** A 44-byte RIFF header in front of the PCM — signed 16-bit mono, which is what every SA sound is. */
function wavBytes(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) {
      bytes[at + i] = text.charCodeAt(i);
    }
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  bytes.set(pcm, 44);

  return bytes;
}

/** Write one sound out as a WAV, so somebody can hear what a slot actually is. */
function writeWav(
  index: OsaudioIndex,
  bankAt: number,
  slot: number,
  read: (name: string, offset: number, length: number) => null | Uint8Array,
  out: string | undefined,
): void {
  const bank = index.banks[bankAt];
  const sound = bank ? index.sounds[bank.firstSound + slot] : undefined;
  if (!bank || !sound) {
    console.log(`[bank-probe] no bank ${bankAt} slot ${slot}`);

    return;
  }
  const name = index.packages[bank.packageIndex] ?? '';
  const pcm = read(name, sound.byteOffset, sound.byteLength);
  if (!pcm) {
    console.log(`[bank-probe] could not read ${sound.byteLength} bytes at ${sound.byteOffset} of ${name}`);

    return;
  }
  const file = out ?? `bank${bankAt}-slot${slot}.wav`;
  writeFileSync(file, wavBytes(pcm, sound.sampleRate));
  console.log(
    `[bank-probe] wrote ${file} — ${sound.durationSeconds.toFixed(2)}s at ${sound.sampleRate} Hz ` +
      `(${name} bank ${bankAt} slot ${slot}${sound.loopOffset >= 0 ? `, loops from sample ${sound.loopOffset}` : ''})`,
  );
}

main();
