/**
 * Whether this page was in FRONT for the whole window it was measured in (201/9, §6).
 *
 * **The debt this closes is not the one it was written as.** §6 asks how many browser tabs competed with a
 * capture, and that number does not exist: no web API exposes another tab, and Termux on an unrooted phone
 * cannot see another app's processes either. So it cannot be measured, and a doc line saying so would leave
 * the real failure unmeasured beside it.
 *
 * **The real failure is this page losing the foreground, and the field has already paid for it.** Android
 * suspends a tab that is not in front: the 2026-08-31 run raised the console three times, each raise
 * answered for 40–80 s and then stopped polling, and the flight that DID have the world resident was lost
 * before it could be read. Nothing in a capture said so — a window that spent half its time backgrounded
 * files exactly like one that did not, and `windowMs` covers both.
 *
 * `hiddenMs` and `hiddenSpells` are what a reader needs: a window with either non-zero was not measured on
 * a page somebody was looking at, whatever every other field says. A tab pushed to the back is also the
 * only shape of "something else was competing" that this page can honestly observe — the competitor is
 * unnameable, but the loss of the foreground is not.
 */

/** What the watch needs of a document, so a test hands it an object rather than a global. */
export interface VisibilityDocument extends EventTarget {
  readonly visibilityState: DocumentVisibilityState;
}

/** Whether the page held the foreground for the window, and what it lost if not. */
export interface VisibilityReport {
  /** Ms the document spent hidden inside the window. Non-zero voids any per-frame claim in the row. */
  readonly hiddenMs: number;
  /** How many times it went away — one long suspend and six quick switches are different accidents. */
  readonly hiddenSpells: number;
  /** Whether it was in front when the report was taken. */
  readonly visibleAtReport: boolean;
}

/**
 * Counts the time this page spent out of the foreground.
 *
 * The clock is injected for the reason every collector in this folder injects one: a test asserts on
 * milliseconds, and a test that waits for them is a test that is flaky on a busy machine.
 */
export class VisibilityWatch {
  private hiddenMs = 0;
  private hiddenSince: null | number = null;
  private hiddenSpells = 0;

  constructor(
    private readonly document: VisibilityDocument,
    private readonly now: () => number,
  ) {
    // The window may open on a page that is ALREADY hidden — a capture link raised behind another app, or
    // a tab restored in the background. Starting from `visible` would credit that time to a page nobody saw.
    if (document.visibilityState === 'hidden') {
      this.hiddenSince = now();
      this.hiddenSpells = 1;
    }
    document.addEventListener('visibilitychange', () => this.change());
  }

  report(): VisibilityReport {
    const open = this.hiddenSince === null ? 0 : Math.max(0, this.now() - this.hiddenSince);

    return {
      // A spell still running is counted up to NOW rather than left out: a report taken while the page is
      // hidden is the case where the omission would matter most.
      hiddenMs: this.hiddenMs + open,
      hiddenSpells: this.hiddenSpells,
      visibleAtReport: this.hiddenSince === null,
    };
  }

  private change(): void {
    if (this.document.visibilityState === 'hidden') {
      if (this.hiddenSince === null) {
        this.hiddenSince = this.now();
        this.hiddenSpells += 1;
      }

      return;
    }
    if (this.hiddenSince !== null) {
      this.hiddenMs += Math.max(0, this.now() - this.hiddenSince);
      this.hiddenSince = null;
    }
  }
}
