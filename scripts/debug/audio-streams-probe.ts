import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { gameArg, gameDir } from '../lib/game';

/**
 * What `audio/streams/` actually costs (plan 203, the 4/02 question).
 *
 * **The chain's v1 excludes the streams, and the reason was never a measurement.** It was three arguments:
 * a second container with an obfuscation layer, a Vorbis decode Safari only grew in 18.4, and radio being a
 * feature a dispatch map does not need. None of those says how BIG a stream is — and against a 64 MB audio
 * budget that is the number the decision turns on, because `decodeAudioData` wants a whole file rather than
 * a byte range.
 *
 * So this reads the shelf: every file, its size, and — for one — the header underneath the obfuscation.
 *
 * **The obfuscation is a repeating 16-byte XOR** (`EA 3A C4 A1 …`), not encryption, and the proof it worked
 * is free: after the header the payload must say `OggS`. If it does not, the key or the layout is wrong and
 * this script says so instead of printing numbers nobody should trust.
 *
 * ```bash
 * npx tsx scripts/debug/audio-streams-probe.ts             # the shelf
 * npx tsx scripts/debug/audio-streams-probe.ts --file AA   # one file's header
 * ```
 */

/** The key the whole file is XOR'd with, byte `i` against key `i % 16`. */
const KEY = [0xea, 0x3a, 0xc4, 0xa1, 0x9a, 0xa8, 0x14, 0xf3, 0x48, 0xb0, 0xd7, 0x23, 0x9d, 0xe8, 0xff, 0xf1];
/** 1 000 beat entries of 8 bytes, 8 length pairs of two DWORDs, a 4-byte footer. */
const HEADER_BYTES = 8068;
const BEATS = 1000;
/** How many tracks one file can hold — the length-pair table's own size. */
const TRACKS = 8;

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main(): void {
  const game = gameArg();
  const tree = flag('--dir') ?? gameDir(game);
  const streams = join(tree, 'audio', 'streams');
  if (!existsSync(streams)) {
    console.log(`[streams] SKIPPED — '${streams}' is not there.`);
    process.exit(0);
  }
  const files = readdirSync(streams)
    .map((name) => ({ bytes: statSync(join(streams, name)).size, name }))
    .sort((a, b) => b.bytes - a.bytes);
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  console.log(`[streams] ${files.length} files · ${(total / 1048576).toFixed(1)} MB in ${streams}`);
  for (const file of files) {
    console.log(`  ${file.name.padEnd(12)} ${(file.bytes / 1048576).toFixed(1).padStart(7)} MB`);
  }

  const asked = flag('--file') ?? files[0]?.name;
  if (asked === undefined) {
    return;
  }
  readHeader(join(streams, asked), asked);
}

/** De-obfuscate one file's header and say what it declares. */
function readHeader(file: string, name: string): void {
  const raw = readFileSync(file);
  if (raw.byteLength < HEADER_BYTES + 4) {
    console.log(`  ${name}: only ${raw.byteLength} bytes — no header to read`);

    return;
  }
  const head = new Uint8Array(HEADER_BYTES + 4);
  for (let at = 0; at < head.length; at += 1) {
    head[at] = (raw[at] ?? 0) ^ (KEY[at % KEY.length] ?? 0);
  }
  const view = new DataView(head.buffer);

  let beats = 0;
  for (let at = 0; at < BEATS; at += 1) {
    if (view.getInt32(at * 8, true) >= 0) {
      beats += 1;
    }
  }
  const tracks: { bytes: number; offset: number }[] = [];
  for (let at = 0; at < TRACKS; at += 1) {
    const base = BEATS * 8 + at * 8;
    tracks.push({ bytes: view.getUint32(base + 4, true), offset: view.getUint32(base, true) });
  }
  const magic = String.fromCharCode(
    head[HEADER_BYTES] ?? 0,
    head[HEADER_BYTES + 1] ?? 0,
    head[HEADER_BYTES + 2] ?? 0,
    head[HEADER_BYTES + 3] ?? 0,
  );

  console.log(`\n  ${name} — ${(raw.byteLength / 1048576).toFixed(1)} MB`);
  console.log(
    `  payload magic after the ${HEADER_BYTES}-byte header: '${magic}' ${magic === 'OggS' ? '— the key and the layout are right' : '— WRONG: do not trust the numbers below'}`,
  );
  console.log(`  ${beats} of ${BEATS} beat entries carry a timing`);
  tracks.forEach((track, at) => {
    if (track.bytes === 0 && track.offset === 0) {
      return;
    }
    console.log(`    track ${at}: ${(track.bytes / 1048576).toFixed(2)} MB at ${track.offset}`);
  });
}

main();
