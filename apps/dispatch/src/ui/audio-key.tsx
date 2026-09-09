import type { AudioAvailability } from '@opensa/audio';
/**
 * The sound control (203/6-01's indicator and 6-02's volume in ONE key).
 *
 * **One control, two jobs, because the cross-platform rule allows exactly one.** A slider beside a mute
 * button is two targets and ~120 px of a bar that already clips at 360 CSS px
 * ([the restriction](../../../../docs/restrictions/cross-platform-surface.md)); this is one target at
 * `TOUCH_TARGET`, it needs no hover, no keyboard and no popover, and it says its own state. It steps
 * full → half → quiet → muted → full, which is *volume and mute* in the only shape that fits.
 *
 * **The glyph is monochrome on purpose**, like every other key in this cluster (`⟲`, `▲`, `☑`): a colour
 * emoji would be the one coloured thing on a console whose whole palette is a decision.
 *
 * **And the label is where the meaning lives.** A `title` is hover-only and a phone has no hover, so the
 * accessible name states both the level and what pressing does — which is also what a screen reader gets.
 */
import type { ReactElement } from 'react';

import { styles } from './styles';

/** What the key shows and says, per state. `press` completes "press to …" in the accessible name. */
interface KeyFace {
  readonly glyph: string;
  readonly label: string;
}

export function AudioKey({
  availability,
  disabled = false,
  onStep,
  touch = false,
  volume,
}: {
  /** What the browser allows right now — the honest half of the indicator. */
  readonly availability: AudioAvailability;
  readonly disabled?: boolean;
  /** Step the volume. It resumes the context too: pressing the sound control IS the gesture. */
  readonly onStep: () => void;
  readonly touch?: boolean;
  /** The step the volume is on, 0..1. */
  readonly volume: number;
}): ReactElement {
  const face = audioKeyFace(availability, volume);
  const unavailable = availability === 'unsupported';

  return (
    <button
      aria-label={face.label}
      disabled={disabled || unavailable}
      onClick={onStep}
      style={touch ? styles.mapNavKeyTouch : styles.mapNavKey}
      title={face.label}
      type="button"
    >
      {face.glyph}
    </button>
  );
}

/**
 * The glyph and the sentence for one state.
 *
 * Exported because it is the whole of this control's behaviour and the only part a headless test can
 * reach — the JSX around it is one `<button>` (`docs/development/e2e.md` owns the rendered half).
 */
export function audioKeyFace(availability: AudioAvailability, volume: number): KeyFace {
  if (availability === 'unsupported') {
    return { glyph: '⊘', label: 'Sound is not available on this surface' };
  }
  if (availability !== 'running') {
    // Waiting for a first touch, suspended by a hidden tab, or interrupted by a phone call: all three are
    // "press and it plays", and none of them is a fault worth three different words.
    return { glyph: '♪', label: 'Turn sound on' };
  }
  if (volume <= 0) {
    return { glyph: '⊘', label: 'Muted — press for full sound' };
  }
  if (volume <= 0.2) {
    return { glyph: '▁', label: 'Sound: quiet — press to mute' };
  }
  if (volume <= 0.5) {
    return { glyph: '▄', label: 'Sound: half — press for quiet' };
  }

  return { glyph: '█', label: 'Sound: full — press for half' };
}
