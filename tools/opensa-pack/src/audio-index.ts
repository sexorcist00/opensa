import type { OsaudioBank, OsaudioIndex, OsaudioSound, OsaudioZone } from '@opensa/engine-formats';
/**
 * Bake `audio.osaudio` beside the pak (203/2-01): every sound in the game addressed by a byte range.
 *
 * **The whole SFX set is 364.1 MB of PCM against the chain's 64 MB budget**
 * ([the census](../../../docs/benchmarks/opensa-engine/2026-09-09-phone-audio-census.json)), so nothing here
 * copies audio and nothing loads a package. What ships is the INDEX — which package, which byte range, which
 * rate, where it loops — and the samples stay in the game dir to be fetched one range at a time. That is why
 * this stage runs in seconds and never touches the pak.
 *
 * **It reads 4 804 bytes per bank rather than the package.** A bank header is all that is needed and `SCRIPT`
 * alone is 304.9 MB, so the caller hands in a RANGE reader instead of the `AssetFileSystem` used for the
 * three small `audio/CONFIG/` files. 370 banks is 1.8 MB of reads on the stock game.
 *
 * **A game with no audio produces no file and no manifest field**, the way `districts.json` is absent when a
 * total conversion ships no `info.zon` — the consumer must have an answer for a silent world either way
 * (203's decision 4.3).
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { encodeOsaudio } from '@opensa/engine-formats';
import { normalizeDatPath } from '@opensa/renderware';
import {
  BANK_HEADER_BYTES,
  readBankHeader,
  readBankLookup,
  readPakFiles,
  soundRange,
} from '@opensa/renderware/audio/sfx-banks';
import { parseGtaDat } from '@opensa/renderware/parsers/text/gta-dat.parser';
import { parseIplAudioZones } from '@opensa/renderware/parsers/text/ipl.parser';
import { closeSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';

/** What the bake produced, or why a bank was left out of it. */
export interface AudioIndexBake {
  bytes: Uint8Array;
  manifest: { banks: number; file: string; sounds: number; zones: number };
  /** Banks whose header would not parse, with the reason. Empty on stock SA since 2026-09-09. */
  skipped: { bank: number; reason: string }[];
}

/** Reads `length` bytes at `offset` from `audio/SFX/<name>`, or `null` when the package is not there. */
export type AudioRangeReader = (packageName: string, offset: number, length: number) => null | Uint8Array;

/** The file this stage writes, next to the manifest. */
export const AUDIO_INDEX_FILE = 'audio.osaudio';

/**
 * Build the index, or `null` when this game has no `audio/CONFIG/`.
 *
 * Every bank is read through `readRange`; one that cannot be parsed is SKIPPED and named rather than
 * aborting the bake — a mod may ship a truncated package, and a world that loses one bank of sounds is a
 * better outcome than a build that stops.
 */
export function buildAudioIndex(fs: AssetFileSystem, readRange: AudioRangeReader): AudioIndexBake | null {
  const pakFiles = fs.get('audio/CONFIG/PakFiles.dat');
  const bankLkup = fs.get('audio/CONFIG/BankLkup.dat');
  if (!pakFiles || !bankLkup) {
    return null;
  }
  const packages = readPakFiles(pakFiles);
  const lookup = readBankLookup(bankLkup);

  const banks: OsaudioBank[] = [];
  const sounds: OsaudioSound[] = [];
  const skipped: { bank: number; reason: string }[] = [];

  lookup.forEach((bank, index) => {
    const name = packages[bank.packageIndex]?.name;
    const headerBytes = name ? readRange(name, bank.headerOffset, BANK_HEADER_BYTES) : null;
    if (!headerBytes) {
      skipped.push({ bank: index, reason: name ? `package '${name}' is not readable` : 'no such package' });

      return;
    }
    let header;
    try {
      // Copied rather than viewed: a range reader is free to hand back a window into a scratch buffer it
      // reuses on the next call, and 4 804 bytes is not a cost worth reasoning about.
      header = readBankHeader(new Uint8Array(headerBytes).buffer);
    } catch (error) {
      skipped.push({ bank: index, reason: error instanceof Error ? error.message : String(error) });

      return;
    }
    const firstSound = sounds.length;
    for (let slot = 0; slot < header.sounds.length; slot += 1) {
      const range = soundRange(bank, header, slot);
      sounds.push({
        byteLength: range.byteLength,
        byteOffset: range.byteOffset,
        durationSeconds: range.durationSeconds,
        headroom: header.sounds[slot]?.headroom ?? 0,
        loopOffset: range.loopOffset,
        sampleRate: range.sampleRate,
      });
    }
    banks.push({
      firstSound,
      headerOffset: bank.headerOffset,
      packageIndex: bank.packageIndex,
      sizeBytes: bank.sizeBytes,
      soundCount: header.sounds.length,
    });
  });

  const index: OsaudioIndex = {
    banks,
    packages: packages.map((entry) => entry.name),
    sounds,
    zones: collectZones(fs),
  };

  return {
    bytes: encodeOsaudio(index),
    manifest: { banks: banks.length, file: AUDIO_INDEX_FILE, sounds: sounds.length, zones: index.zones.length },
    skipped,
  };
}

/**
 * A range reader over a game dir's `audio/SFX/`, and the handles to close when the bake is done.
 *
 * `node:fs` rather than the game FS on purpose: `openGameDir` reads a loose file WHOLE and `SCRIPT` alone is
 * 304.9 MB, while all a bake needs is 4 804 bytes a bank — 1.8 MB across the 370 banks of stock SA.
 */
export function openAudioRanges(gameDir: string): { close: () => void; read: AudioRangeReader } {
  const handles = new Map<string, null | number>();

  return {
    close: (): void => {
      for (const handle of handles.values()) {
        if (handle !== null) {
          closeSync(handle);
        }
      }
      handles.clear();
    },
    read: (name, offset, length): null | Uint8Array => {
      let handle = handles.get(name);
      if (handle === undefined) {
        try {
          handle = openSync(join(gameDir, 'audio', 'SFX', name), 'r');
        } catch {
          handle = null;
        }
        handles.set(name, handle);
      }
      if (handle === null) {
        return null;
      }
      const buffer = new Uint8Array(length);

      return readSync(handle, buffer, 0, length, offset) === length ? buffer : null;
    },
  };
}

/**
 * Every `AUZO` row the map declares.
 *
 * On stock SA all 155 live in one file (`audiozon.ipl`) and no other IPL carries the section at all, but the
 * scan is over the whole `gta.dat` list because a mod is free to put them anywhere — and a zone that exists
 * in the game and not in the index is a silence nobody can explain.
 */
function collectZones(fs: AssetFileSystem): OsaudioZone[] {
  const datText = fs.getText('data/gta.dat');
  if (datText === null) {
    return [];
  }
  const zones: OsaudioZone[] = [];
  for (const iplPath of parseGtaDat(datText).ipl) {
    if (iplPath.toLowerCase().endsWith('.zon')) {
      continue;
    }
    const text = fs.getText(normalizeDatPath(iplPath));
    if (text === null) {
      continue;
    }
    for (const zone of parseIplAudioZones(text)) {
      zones.push(
        zone.shape === 'sphere'
          ? {
              active: zone.active,
              centre: zone.centre,
              id: zone.id,
              name: zone.name,
              radius: zone.radius,
              shape: 'sphere',
            }
          : { active: zone.active, id: zone.id, max: zone.max, min: zone.min, name: zone.name, shape: 'box' },
      );
    }
  }

  return zones;
}
