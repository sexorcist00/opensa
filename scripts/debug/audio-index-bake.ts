import { decodeOsaudio } from '@opensa/engine-formats';
import { buildAudioIndex, openAudioRanges } from '@opensa/opensa-pack/audio-index';
import { openGameDir } from '@opensa/opensa-pack/game-fs';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { gameArg, gameDir } from '../lib/game';

/**
 * The audio index, baked and read back (plan 203/2-01) — what `audio.osaudio` COSTS, on the real files.
 *
 * The bake itself belongs to the pak build, where it runs beside `water.bin` and `districts.json`. This is
 * the same stage on its own, because a full `sa` run is ~10 minutes and the only question here is a byte
 * size and a round trip: **seconds against an hour**, which is the standing rule for the one-model
 * instruments (`docs/debug/README.md`).
 *
 * It reads 4 804 bytes a bank and never opens a package — `SCRIPT` alone is 304.9 MB — and it decodes what
 * it wrote, because an index that encodes and cannot be read back is the one failure a byte count hides.
 *
 * **`--pak <dir>` puts the result into a pak that was built without one**, which is the whole reason this
 * flag exists: a pak from before the audio stage carries no `audio.osaudio` and no `audio` field in its
 * manifest, so the console loads nothing however good the event table is — and the honest fix, a rebuild,
 * is ten minutes to an hour on the device that has the game. This writes the same two things the pack
 * writes, from the same function, and the pack's next run overwrites them identically.
 *
 * Run: `npx tsx scripts/debug/audio-index-bake.ts [--game original] [--dir <tree>] [--out <file>] [--pak <dir>]`
 */

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main(): void {
  const game = gameArg();
  const tree = flag('--dir') ?? gameDir(game);
  if (!existsSync(join(tree, 'audio', 'CONFIG', 'BankLkup.dat'))) {
    console.log(`[audio-index] SKIPPED — '${tree}' carries no audio/CONFIG/BankLkup.dat, so there is nothing to bake.`);
    process.exit(0);
  }

  const startedAt = Date.now();
  const fs = openGameDir(tree);
  const ranges = openAudioRanges(tree);
  let bake;
  try {
    bake = buildAudioIndex(fs, ranges.read);
  } finally {
    ranges.close();
  }
  if (bake === null) {
    console.log(`[audio-index] SKIPPED — ${tree} has no audio/CONFIG/PakFiles.dat or BankLkup.dat`);
    process.exit(0);
  }
  const bakedMs = Date.now() - startedAt;

  const index = decodeOsaudio(bake.bytes);
  const bytes = bake.bytes.byteLength;
  console.log(`[audio-index] ${tree}`);
  console.log(
    `  ${index.packages.length} packages · ${index.banks.length} banks · ${index.sounds.length} sounds · ` +
      `${index.zones.length} zones`,
  );
  console.log(`  ${(bytes / 1024).toFixed(1)} kB (${bytes} bytes) · baked in ${(bakedMs / 1000).toFixed(1)}s`);
  console.log(`  ${(bytes / Math.max(1, index.sounds.length)).toFixed(1)} bytes a sound, index and all`);
  const pcm = index.sounds.reduce((total, sound) => total + sound.byteLength, 0);
  const seconds = index.sounds.reduce((total, sound) => total + sound.durationSeconds, 0);
  console.log(
    `  it addresses ${(pcm / 1048576).toFixed(1)} MB of PCM — ${(seconds / 60).toFixed(1)} minutes of sound — ` +
      `at ${((bytes / Math.max(1, pcm)) * 100).toFixed(3)} % of its size`,
  );
  for (const row of bake.skipped.slice(0, 10)) {
    console.log(`  SKIPPED bank ${row.bank}: ${row.reason}`);
  }
  const longest = [...index.sounds].sort((a, b) => b.durationSeconds - a.durationSeconds)[0];
  if (longest) {
    console.log(`  longest sound ${longest.durationSeconds.toFixed(1)}s at ${longest.sampleRate} Hz`);
  }

  const pak = flag('--pak');
  if (pak !== undefined) {
    patchPak(pak, bake);
  }
  const out = flag('--out');
  if (out) {
    writeFileSync(out, bake.bytes);
    console.log(`  wrote ${out}`);
  }
}

/**
 * Put an index into an existing pak: the file beside the manifest, and the manifest's own `audio` field.
 *
 * Both halves are needed and the second is the one that is easy to forget — `loadAudio` reads the manifest
 * FIRST and answers "this build has no audio" without ever looking for the file.
 */
function patchPak(pak: string, bake: { bytes: Uint8Array; manifest: Record<string, unknown> }): void {
  const manifestPath = join(pak, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.log(`[audio-index] no manifest.json in '${pak}' — nothing patched`);

    return;
  }
  writeFileSync(join(pak, String(bake.manifest.file)), bake.bytes);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.audio = { ...bake.manifest };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(
    `[audio-index] patched ${pak}: ${String(bake.manifest.file)} written and manifest.audio set — ` +
      `the pack's next run writes exactly the same two things`,
  );
}

main();
