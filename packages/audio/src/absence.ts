/**
 * When there is no sound, and how a surface can tell that apart from a broken one (203/3-04).
 *
 * **Absence is the NORMAL case here**, not an error path: a pak served without its game dir, a total
 * conversion that ships no `audio/`, a build whose index predates a name, a mod naming a sound nothing
 * carries. Each of those is silence — and 203's decision 4.3 fixes what silence must do: **play nothing, say
 * ONE line per name, and carry a count in the report.**
 *
 * **The one line matters more than it looks.** The class of defect this is written against cost this project
 * three days in September: every patrolling unit in the shareable demo was drawn by nothing, silently, while
 * the roster still said 150 ([the restriction](../../../docs/restrictions/architecture.md)). A world with no
 * audio must be legible from its own report, or the first question — *is it silent or is it broken?* —
 * cannot be answered without a debugger.
 *
 * **Once per distinct thing, ever.** A missing footstep asked for sixty times a second would otherwise fill
 * a console with one fact.
 */

/** What a capture states about what could NOT be heard. */
export interface AudioAbsenceReport {
  /**
   * Data files a consumer needed and this build does not serve — `data/handling.cfg` and its neighbours.
   *
   * **Added 2026-09-11, after the first panel-audio flight**, where a missing
   * `gtasa_vehicleAudioSettings.cfg` made a 150-unit board sound like an empty one: every file was turned
   * into an empty map, nothing was reported, and the capture stayed complete and plausible with
   * `vehicles: 0` as the only trace. A reader had to already know what that number meant.
   */
  readonly files: number;
  /** Distinct sound names nothing in the index carries — a mod's own name, or a typo in the event table. */
  readonly names: number;
  /** True when there is no index at all: this build carries no `audio.osaudio`. */
  readonly noIndex: boolean;
  /** True when there is no source: no game dir, so no package can ever be fetched. */
  readonly noSource: boolean;
  /** Distinct packages that could not be read — served without `audio/SFX/`, or a host with no ranges. */
  readonly packages: number;
  /** The lines, in the order they were first said, so a report carries WHAT was missing and not only how
   *  many. Capped: a total conversion could otherwise put thousands of names in a capture. */
  readonly reasons: readonly string[];
  /** Distinct sound ids the index does not have — an event table built against a different index. */
  readonly sounds: number;
}

/** How many distinct reasons a report carries before it stops listing them. The COUNTS stay exact. */
const MAX_REASONS = 32;

/** Records what could not be heard, once each. */
export class AudioAbsence {
  /** Whether anything at all was missing — the one question a surface asks before drawing an indicator. */
  get silentForAReason(): boolean {
    return (
      this.noIndex || this.noSource || this.names.size + this.packages.size + this.sounds.size + this.files.size > 0
    );
  }
  private readonly files = new Set<string>();
  private readonly log: (message: string) => void;
  private readonly names = new Set<string>();
  private noIndex = false;
  private noSource = false;
  private readonly packages = new Set<string>();
  private readonly reasons: string[] = [];

  private readonly sounds = new Set<number>();

  constructor(log: (message: string) => void) {
    this.log = log;
  }

  /** This build has no audio index. Said once, whatever asks. */
  indexAbsent(): void {
    if (this.noIndex) {
      return;
    }
    this.noIndex = true;
    this.say('[audio] this build carries no audio index — the world is silent by construction, not by fault');
  }

  /**
   * A data file a consumer asked for and this build does not serve.
   *
   * @param what what goes quiet without it, in words — the count alone cannot say that a missing table
   *   means every car on the board is unvoiced.
   */
  missingFile(path: string, what: string): void {
    if (this.files.has(path)) {
      return;
    }
    this.files.add(path);
    this.say(`[audio] '${path}' is not served — ${what}`);
  }

  /** A package that could not be read. */
  missingPackage(name: string): void {
    if (this.packages.has(name)) {
      return;
    }
    this.packages.add(name);
    this.say(`[audio] package '${name}' is not readable — every sound in it is silent`);
  }

  /** A sound id the index does not carry. */
  missingSound(id: number): void {
    if (this.sounds.has(id)) {
      return;
    }
    this.sounds.add(id);
    this.say(`[audio] sound ${id} is not in this index — nothing plays for it`);
  }

  report(): AudioAbsenceReport {
    return {
      files: this.files.size,
      names: this.names.size,
      noIndex: this.noIndex,
      noSource: this.noSource,
      packages: this.packages.size,
      reasons: [...this.reasons],
      sounds: this.sounds.size,
    };
  }

  /** There is no game dir, so no package can ever be fetched. Said once. */
  sourceAbsent(): void {
    if (this.noSource) {
      return;
    }
    this.noSource = true;
    this.say('[audio] no game dir is served beside this pak — the index is readable and the samples are not');
  }

  /** A name the event table could not resolve to a sound. */
  unknownName(name: string): void {
    if (this.names.has(name)) {
      return;
    }
    this.names.add(name);
    this.say(`[audio] nothing carries a sound named '${name}'`);
  }

  /**
   * A row of the event table that names a sound the index does not have.
   *
   * Counted with the unknown NAMES, because the effect on a consumer is the same — asking for it plays
   * nothing — but said differently, because the cause is not: the table has the name and it points nowhere,
   * which is a mod author's row to fix rather than a caller's typo.
   */
  unresolvedRow(name: string, reason: string): void {
    if (this.names.has(name)) {
      return;
    }
    this.names.add(name);
    this.say(`[audio] '${name}' is in the event table but ${reason} — nothing plays for it`);
  }

  private say(message: string): void {
    if (this.reasons.length < MAX_REASONS) {
      this.reasons.push(message);
    }
    this.log(message);
  }
}
