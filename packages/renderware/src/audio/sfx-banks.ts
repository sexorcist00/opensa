/**
 * SA's SFX index: which package holds a bank, and where a single sound sits inside it (203/1-02).
 *
 * Three little files under `audio/CONFIG/` describe every sound effect in the game, and together they make
 * one sound **addressable by arithmetic** — which is the fact the whole delivery design stands on
 * ([the concept](../../../../docs/plans/203-audio/concept.md) §1): a byte range can be computed and fetched
 * without unpacking, decoding or indexing anything at runtime.
 *
 * ```text
 * PakFiles.dat   52 bytes a name          → audio/SFX/<name>
 * BankLkup.dat   12 bytes an entry        → which package, and the bank header's offset in it
 * <package>      4 804 bytes a header     → 400 × SoundMeta, of which the first `numSounds` are real
 *                then the PCM buffers     → signed 16-bit mono, no encryption
 * ```
 *
 * **Everything here VALIDATES rather than assumes, and that is deliberate.** These numbers come from format
 * documentation, not from the files: the repository this ships in has no game data, so
 * [203/1-01](../../../../docs/plans/203-audio/readme.md) — a census on the real copy — is what turns them
 * from documentation into measurements. Until it has run, a reader that trusted the layout would mis-parse
 * silently and hand back plausible offsets into the wrong bytes. So each function refuses a buffer that
 * cannot be what it claims to be, and says what it saw.
 *
 * **A sound's LENGTH is not stored anywhere**, which is the one derivation in this file worth reading
 * twice. `SoundMeta` carries an offset and no size, so a sound runs until the next one begins, and the last
 * one runs to the end of the bank ({@link soundRange}).
 */
import { BinaryStream } from '../parsers/binary/binary-stream';

/** One entry of `BankLkup.dat`: where a bank's header lives, and how many bytes of PCM follow it. */
export interface SfxBank {
  /** Byte offset of the bank's 4 804-byte header inside its package. */
  readonly headerOffset: number;
  /** Index into {@link SfxPackage}. */
  readonly packageIndex: number;
  /** Total bytes of sound in the bank — the sum of its buffers, NOT including the header. */
  readonly sizeBytes: number;
}

/** A bank header: the sounds it declares, in slot order. */
export interface SfxBankHeader {
  readonly sounds: readonly SfxSound[];
}

/** One entry of `PakFiles.dat` — a file under `audio/SFX/`, addressed by its INDEX from the bank lookup. */
export interface SfxPackage {
  /** Its index, which is what `SfxBank.packageIndex` names. */
  readonly index: number;
  /** The file name as stored, NUL-terminated and `0xCD`-padded in the file, both stripped here. */
  readonly name: string;
}

/** One `SoundMeta` — 12 bytes, and the only description a sample gets. */
export interface SfxSound {
  /** Offset of the PCM buffer from the END of the bank header. */
  readonly bufferOffset: number;
  /** Volume adjustment as authored. Carried verbatim: it is the author's number, not ours to interpret. */
  readonly headroom: number;
  /** Loop start IN SAMPLES, or `-1` for a one-shot. Samples, never bytes — a loop point read as bytes is
   *  half a second early and sounds like a stutter rather than like a bug. */
  readonly loopOffset: number;
  readonly sampleRate: number;
}

/** Everything needed to fetch and play one sound, and nothing that has to be looked up again. */
export interface SfxSoundRange {
  /** Length of the PCM buffer in bytes — DERIVED, never stored (see {@link soundRange}). */
  readonly byteLength: number;
  /** Absolute offset in the package file: the header's offset, plus the header, plus the buffer's own. */
  readonly byteOffset: number;
  /** Seconds, from the byte count and the rate — 16-bit mono, so two bytes a sample. */
  readonly durationSeconds: number;
  readonly loopOffset: number;
  readonly sampleRate: number;
}

/** A package name is a fixed-width field, not a string: 52 bytes, NUL-terminated, `0xCD`-padded. */
const PACKAGE_NAME_BYTES = 52;
/** `PackageIndex` u8 · 3 padding · `BankHeaderOffset` u32 · `BankSize` u32. */
const BANK_ENTRY_BYTES = 12;
/**
 * `NumSounds` u16 · u16 padding · 400 × 12 — which is 4 804, and it is MEASURED rather than documented.
 *
 * **It was 4 084 here until 2026-09-09, and that was wrong by 720 bytes**: the arithmetic does not close
 * (4 + 400 × 12 = 4 804), and the census settled it off the real files rather than off a document. A bank is
 * a header followed by its PCM and `BankLkup` gives both the offset and the PCM size, so the gap between
 * consecutive bank offsets minus that size IS the header: **361 gaps in the stock game, every one of them
 * 4 804, none anything else.**
 *
 * **A wrong value here is SILENT in every direction that looks like a check.** Each sound's byte range
 * shifts by the same constant, so lengths stay positive, nothing runs past the end of its package, and every
 * offset is still plausible — the only thing that gives it away is a bank declaring more sounds than the
 * short header has room for, which is exactly how it surfaced (bank 366 declares 380, needing 4 564).
 */
export const BANK_HEADER_BYTES = 4804;
/** The header has room for exactly this many, whatever `NumSounds` says. */
const MAX_SOUNDS_PER_BANK = 400;
/** Signed 16-bit mono. */
const BYTES_PER_SAMPLE = 2;

/**
 * Read one bank header out of a package.
 *
 * Only the first `NumSounds` slots are returned: the header always carries 400, and the rest are whatever
 * the tool that wrote the file left there.
 *
 * @param offset where the header starts in `bytes` — {@link SfxBank.headerOffset} when reading a package
 *   whole, or 0 when the caller has already fetched the header alone.
 * @throws when there is not a header's worth of bytes at `offset`, or when the count is past the 400 the
 *   header has room for. Both mean the offset is wrong, and a wrong offset that parses is the failure this
 *   whole module is written to avoid.
 */
export function readBankHeader(bytes: ArrayBuffer, offset = 0): SfxBankHeader {
  if (offset < 0 || offset + BANK_HEADER_BYTES > bytes.byteLength) {
    throw new RangeError(
      `a bank header needs ${BANK_HEADER_BYTES} bytes at offset ${offset}, but the buffer is ${bytes.byteLength}`,
    );
  }
  const stream = new BinaryStream(bytes, offset, BANK_HEADER_BYTES);
  const declared = stream.u16();
  if (declared > MAX_SOUNDS_PER_BANK) {
    throw new RangeError(
      `bank header at offset ${offset} declares ${declared} sounds, past the ${MAX_SOUNDS_PER_BANK} it has room for`,
    );
  }
  stream.skip(2);
  const sounds: SfxSound[] = [];
  for (let index = 0; index < declared; index += 1) {
    // Read into locals FIRST: the stream is sequential, so field order IS parse order — and an object
    // literal's key order is not ours to keep. `perfectionist/sort-objects` sorted the four reads
    // alphabetically the first time this was linted (`bufferOffset, headroom, loopOffset, sampleRate`),
    // which silently swapped the loop point and the rate with the headroom. The tests caught it; nothing
    // else would have, since every field is a plausible number in the wrong place.
    const bufferOffset = stream.u32();
    const loopOffset = stream.i32();
    const sampleRate = stream.u16();
    const headroom = stream.i16();
    sounds.push({ bufferOffset, headroom, loopOffset, sampleRate });
  }

  return { sounds };
}

/**
 * Read `audio/CONFIG/BankLkup.dat`.
 *
 * @throws when the length is not a whole number of 12-byte entries.
 */
export function readBankLookup(bytes: ArrayBuffer): readonly SfxBank[] {
  if (bytes.byteLength === 0 || bytes.byteLength % BANK_ENTRY_BYTES !== 0) {
    throw new RangeError(
      `BankLkup.dat is ${bytes.byteLength} bytes, which is not a whole number of ${BANK_ENTRY_BYTES}-byte entries`,
    );
  }
  const stream = new BinaryStream(bytes);
  const banks: SfxBank[] = [];
  while (stream.remaining >= BANK_ENTRY_BYTES) {
    // Locals rather than a literal, for the reason spelled out in `readBankHeader`: a sequential read's
    // field order is the FORMAT's, and an object literal's key order belongs to the linter.
    const packageIndex = stream.u8();
    stream.skip(3);
    const headerOffset = stream.u32();
    const sizeBytes = stream.u32();
    banks.push({ headerOffset, packageIndex, sizeBytes });
  }

  return banks;
}

/**
 * Read `audio/CONFIG/PakFiles.dat`.
 *
 * @throws when the length is not a whole number of name fields — the file is a flat array and nothing else,
 *   so a remainder means this is not `PakFiles.dat` at all.
 */
export function readPakFiles(bytes: ArrayBuffer): readonly SfxPackage[] {
  if (bytes.byteLength === 0 || bytes.byteLength % PACKAGE_NAME_BYTES !== 0) {
    throw new RangeError(
      `PakFiles.dat is ${bytes.byteLength} bytes, which is not a whole number of ${PACKAGE_NAME_BYTES}-byte names`,
    );
  }
  const stream = new BinaryStream(bytes);
  const packages: SfxPackage[] = [];
  for (let index = 0; index * PACKAGE_NAME_BYTES < bytes.byteLength; index += 1) {
    packages.push({ index, name: stream.string(PACKAGE_NAME_BYTES) });
  }

  return packages;
}

/**
 * Where one sound's PCM lives in its package, and how long it is.
 *
 * **The length is DERIVED**, because `SoundMeta` does not carry one: a buffer runs until the next buffer
 * begins, and the last runs to the end of the bank. The end is taken as the SMALLEST offset greater than
 * this one rather than as "the next slot's", so the arithmetic does not depend on the slots being written
 * in ascending order — an assumption nothing in the format guarantees and no test on our own files could
 * ever falsify.
 *
 * @throws when `index` names a slot the bank does not have.
 */
export function soundRange(bank: SfxBank, header: SfxBankHeader, index: number): SfxSoundRange {
  const sound = header.sounds[index];
  if (!sound) {
    throw new RangeError(`bank at offset ${bank.headerOffset} has ${header.sounds.length} sounds, not ${index + 1}`);
  }
  let end = bank.sizeBytes;
  for (const other of header.sounds) {
    if (other.bufferOffset > sound.bufferOffset && other.bufferOffset < end) {
      end = other.bufferOffset;
    }
  }
  const byteLength = Math.max(0, end - sound.bufferOffset);

  return {
    byteLength,
    byteOffset: bank.headerOffset + BANK_HEADER_BYTES + sound.bufferOffset,
    durationSeconds: sound.sampleRate > 0 ? byteLength / BYTES_PER_SAMPLE / sound.sampleRate : 0,
    loopOffset: sound.loopOffset,
    sampleRate: sound.sampleRate,
  };
}
