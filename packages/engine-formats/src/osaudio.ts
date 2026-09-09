/**
 * `.osaudio` — the audio index that ships beside the pak (203/2-01).
 *
 * **A surface streaming a pak over HTTP has no game dir**, so everything needed to fetch one sound has to be
 * decided while the game is BUILT ([build-vs-runtime](../../../docs/restrictions/build-vs-runtime.md)). This
 * container is that decision written down: which package a sound lives in, the byte range to ask for, the
 * rate to play it at, where it loops, and the map's audio zones — small enough to be one fetch at boot and
 * complete enough that nothing downstream ever opens `audio/CONFIG/` again.
 *
 * **The offsets here are ABSOLUTE inside the package file**, already carrying the bank header and the
 * buffer's own offset. That is the whole point of baking: the runtime never learns that a bank header is
 * 4 804 bytes, and the day that constant is wrong again ([it was, by 720 bytes, until the census measured
 * it](../../../docs/benchmarks/opensa-engine/2026-09-09-phone-audio-census.json)) the mistake is in one
 * build rather than in every consumer.
 *
 * ```text
 * header    28 bytes  magic · version · four counts · the string blob's length
 * strings             NUL-terminated UTF-8, padded to 4 — package and zone names, addressed by offset
 * packages  4 each    a name offset; a bank names its package by INDEX into this table
 * banks     16 each   package · sound count · header offset · PCM size · first sound
 * sounds    16 each   byte range · rate · headroom · loop point
 * zones     36 each   name · id · shape · active · six floats read per shape
 * ```
 *
 * **Duration is NOT stored.** It is `byteLength / 2 / sampleRate` exactly, and a stored copy is one more
 * thing that can disagree with the range beside it; {@link decodeOsaudio} computes it on the way out. The
 * plan's step (2/01) lists duration among what the index carries, and it does — as a derived field of the
 * decoded record rather than as bytes on disk.
 */
import { ByteReader, ByteWriter } from './binary';

export const OSAUDIO_MAGIC = 0x3141534f; // 'OSA1' little-endian
export const OSAUDIO_VERSION_MAJOR = 1;
export const OSAUDIO_VERSION_MINOR = 0;

const HEADER_BYTES = 28;
const PACKAGE_RECORD_BYTES = 4;
const BANK_RECORD_BYTES = 16;
const SOUND_RECORD_BYTES = 16;
const ZONE_RECORD_BYTES = 36;
/** Signed 16-bit mono, so two bytes a sample — the one fact about the PCM this container assumes. */
const BYTES_PER_SAMPLE = 2;
/** How `zone.shape` is stored. A byte rather than a string: the record is fixed-width so it can be indexed. */
const SHAPE_BOX = 0;
const SHAPE_SPHERE = 1;

/** One bank: a run of sounds inside one package, kept so a consumer can talk about banks at all. */
export interface OsaudioBank {
  /** Index of this bank's first sound in the flat sound table. */
  readonly firstSound: number;
  /** The bank header's offset in its package — carried for diagnostics, never needed to fetch a sound. */
  readonly headerOffset: number;
  readonly packageIndex: number;
  readonly sizeBytes: number;
  readonly soundCount: number;
}

/** Everything the index knows, decoded. */
export interface OsaudioIndex {
  readonly banks: readonly OsaudioBank[];
  /** File names under `audio/SFX/`, addressed by {@link OsaudioBank.packageIndex}. */
  readonly packages: readonly string[];
  readonly sounds: readonly OsaudioSound[];
  readonly zones: readonly OsaudioZone[];
}

/** One sound, ready to fetch and play without another lookup. */
export interface OsaudioSound {
  /** Length of the PCM in bytes. */
  readonly byteLength: number;
  /** ABSOLUTE offset in the package file — the bank header and the buffer offset are already in it. */
  readonly byteOffset: number;
  /** DERIVED on decode from the byte count and the rate; never stored. */
  readonly durationSeconds: number;
  /** The author's volume adjustment, carried verbatim. */
  readonly headroom: number;
  /** Loop start IN SAMPLES, or -1 for a one-shot. */
  readonly loopOffset: number;
  readonly sampleRate: number;
}

/** One audio zone from the map's `AUZO` rows. */
export type OsaudioZone = OsaudioZoneBox | OsaudioZoneSphere;

export interface OsaudioZoneBox extends OsaudioZoneBase {
  readonly max: readonly [number, number, number];
  readonly min: readonly [number, number, number];
  readonly shape: 'box';
}

export interface OsaudioZoneSphere extends OsaudioZoneBase {
  readonly centre: readonly [number, number, number];
  readonly radius: number;
  readonly shape: 'sphere';
}

interface OsaudioZoneBase {
  /** `flags == 1` in the IPL row — anything else starts the zone switched off. */
  readonly active: boolean;
  readonly id: number;
  readonly name: string;
}

/** Deduplicating string blob: every distinct name written once, addressed by its offset. */
class StringBlob {
  private length = 0;
  private readonly offsets = new Map<string, number>();
  private readonly parts: Uint8Array[] = [];

  add(value: string): number {
    const known = this.offsets.get(value);
    if (known !== undefined) {
      return known;
    }
    const encoded = new TextEncoder().encode(value);
    const record = new Uint8Array(encoded.byteLength + 1);
    record.set(encoded);
    const at = this.length;
    this.parts.push(record);
    this.length += record.byteLength;
    this.offsets.set(value, at);

    return at;
  }

  bytes(): Uint8Array {
    const padded = this.length + ((4 - (this.length % 4)) % 4);
    const blob = new Uint8Array(padded);
    let at = 0;
    for (const part of this.parts) {
      blob.set(part, at);
      at += part.byteLength;
    }

    return blob;
  }
}

/**
 * Read an index back.
 *
 * @throws when the magic or the major version is not ours, or when a section runs past the buffer. A
 *   container that cannot be what it claims is refused rather than half-read: the offsets inside it address
 *   hundreds of megabytes of somebody's PCM.
 */
export function decodeOsaudio(bytes: Uint8Array): OsaudioIndex {
  const reader = new ByteReader(bytes);
  const magic = reader.u32();
  if (magic !== OSAUDIO_MAGIC) {
    throw new Error(`not an .osaudio index (magic 0x${magic.toString(16)})`);
  }
  const major = reader.u16();
  reader.u16();
  if (major !== OSAUDIO_VERSION_MAJOR) {
    throw new Error(`.osaudio major version ${major}, expected ${OSAUDIO_VERSION_MAJOR}`);
  }
  const packageCount = reader.u32();
  const bankCount = reader.u32();
  const soundCount = reader.u32();
  const zoneCount = reader.u32();
  const stringBytes = reader.u32();

  const needed =
    HEADER_BYTES +
    stringBytes +
    packageCount * PACKAGE_RECORD_BYTES +
    bankCount * BANK_RECORD_BYTES +
    soundCount * SOUND_RECORD_BYTES +
    zoneCount * ZONE_RECORD_BYTES;
  if (needed > bytes.byteLength) {
    throw new Error(`.osaudio declares ${needed} bytes of sections but the buffer is ${bytes.byteLength}`);
  }

  const strings = readStrings(bytes.subarray(HEADER_BYTES, HEADER_BYTES + stringBytes));
  reader.seek(HEADER_BYTES + stringBytes);

  const packages: string[] = [];
  for (let index = 0; index < packageCount; index += 1) {
    packages.push(strings(reader.u32()));
  }

  const banks: OsaudioBank[] = [];
  for (let index = 0; index < bankCount; index += 1) {
    const packageIndex = reader.u8();
    reader.u8();
    const soundsInBank = reader.u16();
    const headerOffset = reader.u32();
    const sizeBytes = reader.u32();
    const firstSound = reader.u32();
    banks.push({ firstSound, headerOffset, packageIndex, sizeBytes, soundCount: soundsInBank });
  }

  const sounds: OsaudioSound[] = [];
  for (let index = 0; index < soundCount; index += 1) {
    const byteOffset = reader.u32();
    const byteLength = reader.u32();
    const sampleRate = reader.u16();
    const headroom = reader.i16();
    const loopOffset = reader.i32();
    sounds.push({
      byteLength,
      byteOffset,
      durationSeconds: sampleRate > 0 ? byteLength / BYTES_PER_SAMPLE / sampleRate : 0,
      headroom,
      loopOffset,
      sampleRate,
    });
  }

  const zones: OsaudioZone[] = [];
  for (let index = 0; index < zoneCount; index += 1) {
    const name = strings(reader.u32());
    const id = reader.i32();
    const shape = reader.u8();
    const active = reader.u8() === 1;
    reader.u16();
    const numbers = [reader.f32(), reader.f32(), reader.f32(), reader.f32(), reader.f32(), reader.f32()];
    zones.push(
      shape === SHAPE_SPHERE
        ? { active, centre: [numbers[0], numbers[1], numbers[2]], id, name, radius: numbers[3], shape: 'sphere' }
        : {
            active,
            id,
            max: [numbers[3], numbers[4], numbers[5]],
            min: [numbers[0], numbers[1], numbers[2]],
            name,
            shape: 'box',
          },
    );
  }

  return { banks, packages, sounds, zones };
}

/** Write an index. The inverse of {@link decodeOsaudio} byte for byte — the round trip is what tests it. */
export function encodeOsaudio(index: OsaudioIndex): Uint8Array {
  const strings = new StringBlob();
  const packageOffsets = index.packages.map((name) => strings.add(name));
  const zoneOffsets = index.zones.map((zone) => strings.add(zone.name));
  const blob = strings.bytes();

  const writer = new ByteWriter(HEADER_BYTES + blob.byteLength + index.sounds.length * SOUND_RECORD_BYTES + 1024);
  writer.u32(OSAUDIO_MAGIC);
  writer.u16(OSAUDIO_VERSION_MAJOR);
  writer.u16(OSAUDIO_VERSION_MINOR);
  writer.u32(index.packages.length);
  writer.u32(index.banks.length);
  writer.u32(index.sounds.length);
  writer.u32(index.zones.length);
  writer.u32(blob.byteLength);
  writer.raw(blob);

  for (const offset of packageOffsets) {
    writer.u32(offset);
  }
  for (const bank of index.banks) {
    writer.u8(bank.packageIndex);
    writer.u8(0);
    writer.u16(bank.soundCount);
    writer.u32(bank.headerOffset);
    writer.u32(bank.sizeBytes);
    writer.u32(bank.firstSound);
  }
  for (const sound of index.sounds) {
    writer.u32(sound.byteOffset);
    writer.u32(sound.byteLength);
    writer.u16(sound.sampleRate);
    writer.i16(sound.headroom);
    writer.i32(sound.loopOffset);
  }
  index.zones.forEach((zone, at) => {
    writer.u32(zoneOffsets[at] ?? 0);
    writer.i32(zone.id);
    writer.u8(zone.shape === 'sphere' ? SHAPE_SPHERE : SHAPE_BOX);
    writer.u8(zone.active ? 1 : 0);
    writer.u16(0);
    const numbers =
      zone.shape === 'sphere'
        ? [zone.centre[0], zone.centre[1], zone.centre[2], zone.radius, 0, 0]
        : [zone.min[0], zone.min[1], zone.min[2], zone.max[0], zone.max[1], zone.max[2]];
    for (const value of numbers) {
      writer.f32(value);
    }
  });

  return writer.bytes();
}

/** Reader for the string blob: an offset in, the NUL-terminated name out. */
function readStrings(blob: Uint8Array): (offset: number) => string {
  const decoder = new TextDecoder();

  return (offset: number): string => {
    if (offset >= blob.byteLength) {
      return '';
    }
    let end = offset;
    while (end < blob.byteLength && blob[end] !== 0) {
      end += 1;
    }

    return decoder.decode(blob.subarray(offset, end));
  };
}
