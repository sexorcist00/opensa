/**
 * Which sounds a DRAFT ambience bed is made of (203/4-02's verification).
 *
 * 4/02 built the bed and nothing can be heard through it, because no build ships the `AMB_` rows it reads
 * ([the contract](../../docs/contracts/audio.md)). **Nothing in the game data says what a sound IS** — SA
 * keeps the event→sound mapping in code — so a first table cannot be derived, only drafted and then judged
 * by an ear.
 *
 * This is the draft rule, and it is deliberately thin: *long, looping, GENERAL rather than mission, and not
 * several siblings of one set*. It lives here rather than in the script so it can be tested without a game
 * tree, which is the difference between iterating on a desk and iterating on a phone.
 */
import type { OsaudioIndex } from '@opensa/engine-formats';

/** One drafted layer. */
export interface BedLayer {
  readonly bank: number;
  readonly seconds: number;
  readonly slot: number;
}

/** Below this a sound is a click rather than a bed. */
export const BED_SECONDS = 1;

/** The package a bed is drafted from: the world's general effects, not mission audio and not speech. */
export const BED_PACKAGE = 'GENRL';

/** The drafted layers as an `audio-events.dat`, comments and all. */
export function bedTable(layers: readonly BedLayer[], gains: readonly number[]): string {
  const rows = layers.map(({ bank, slot }, at) => {
    const name = at === 0 ? 'AMB_DEFAULT' : `AMB_DEFAULT_${at + 1}`;

    return `${name}, ${bank}, ${slot}, ${gains[at] ?? gains[gains.length - 1] ?? 0.2}, loop`;
  });

  return [
    '# Drafted by scripts/debug/audio-bank-probe.ts --bed. Nothing in the game data says what a sound IS,',
    `# so these are the longest ${BED_PACKAGE} loops, one per bank — a starting point for an ear, not an answer.`,
    '# The rules for these names are docs/contracts/audio.md.',
    ...rows,
    '',
  ].join('\n');
}

/**
 * Merge a drafted bed into a table that may already exist.
 *
 * **A draft may not destroy authored rows.** The same file carries the `VEH_SIREN_*` rows 5/02 needs and
 * anything else an ear has settled on, and a plain overwrite would take them with it — silently, since a
 * table is only ever read by a browser. Every row that is not one of the bed's own is kept, in its own
 * order, and the drafted layers are appended.
 */
export function mergeBedTable(existing: string, drafted: string): string {
  const kept = existing
    .split(/\r?\n/u)
    .filter((line) => !isBedRow(line))
    .join('\n')
    .replace(/\n+$/u, '');
  const rows = drafted
    .split(/\r?\n/u)
    .filter((line) => isBedRow(line))
    .join('\n');

  return kept === '' ? drafted : `${kept}\n${rows}\n`;
}

/**
 * The layers, longest first, at most one per BANK.
 *
 * **One per bank is the rule that matters.** The census found eight loops of identical length inside one
 * GENRL bank — *"which reads as a set"* — and three layers taken from one set are one texture played three
 * times, which is the opposite of what layering is for.
 */
export function pickBedLayers(index: OsaudioIndex, layers: number): readonly BedLayer[] {
  const owner = new Map<number, number>();
  index.banks.forEach((bank, at) => {
    for (let slot = 0; slot < bank.soundCount; slot += 1) {
      owner.set(bank.firstSound + slot, at);
    }
  });
  const candidates = index.sounds
    .map((sound, at) => ({ at, bank: owner.get(at) ?? -1, sound }))
    .filter(
      ({ bank, sound }) =>
        sound.loopOffset >= 0 &&
        sound.durationSeconds >= BED_SECONDS &&
        index.packages[index.banks[bank]?.packageIndex ?? -1] === BED_PACKAGE,
    )
    // Longest first, and by bank then slot when two are the same length, so the same tree always drafts the
    // same bed — a draft nobody can reproduce is not evidence.
    .sort((a, b) => b.sound.durationSeconds - a.sound.durationSeconds || a.at - b.at);

  const picked: BedLayer[] = [];
  const used = new Set<number>();
  for (const { at, bank, sound } of candidates) {
    if (picked.length >= layers) {
      break;
    }
    if (used.has(bank)) {
      continue;
    }
    used.add(bank);
    picked.push({ bank, seconds: sound.durationSeconds, slot: at - (index.banks[bank]?.firstSound ?? 0) });
  }

  return picked;
}

/** Whether a line is one of the default bed's own rows — the only ones a draft may replace. */
function isBedRow(line: string): boolean {
  return /^\s*AMB_DEFAULT(?:_\d+)?\s*[,\s]/iu.test(line);
}
