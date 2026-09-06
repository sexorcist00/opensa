/**
 * The graphics control: one `<select>` of named rungs, and a line saying what the chosen one costs.
 *
 * **It is a control rather than a panel on purpose.** Every rung here is instant — the two levers rebuild
 * the bloom targets and nothing else — so there is nothing to confirm, nothing to apply and no dialog to
 * dismiss. A modal would add a step to a choice the operator wants to make while looking at the map, which
 * is the only way to judge it.
 *
 * **Native `<select>`, for the reasons the skin switcher already gives**: one target, in the tab order for
 * free, and on a phone it opens the OS picker, which is a better list than anything drawn here. That also
 * answers three of the five cross-platform questions at once — a finger hits it at `TOUCH_TARGET`, it needs
 * no hover, and it needs no keyboard
 * ([the restriction](../../../../docs/restrictions/cross-platform-surface.md)).
 *
 * **The detail line is not decoration.** 201's decisions forbid a SILENT quality ladder; the defence is that
 * the operator is told what the rung does to the picture before they pick it and while it is running. On a
 * compact layout the line is dropped rather than truncated — the `<select>`'s own option text carries the
 * name, and a half-sentence is worse than none.
 */
import type { ReactElement } from 'react';

import type { GraphicsPreset } from '../world/graphics';

import { GRAPHICS_PRESETS, PRESET_LABELS } from '../world/graphics';
import { COLORS } from './styles';
import { styles } from './styles';

export function GraphicsMenu({
  compact,
  onPreset,
  preset,
  touch,
}: {
  /** Narrow viewport: the detail line goes, the control stays. */
  readonly compact: boolean;
  readonly onPreset: (preset: GraphicsPreset) => void;
  /** The rung in force, or `null` when the URL pins a combination no rung names. */
  readonly preset: GraphicsPreset | null;
  /** Coarse pointer: the target grows to `TOUCH_TARGET` in both axes. */
  readonly touch: boolean;
}): ReactElement {
  const detail = preset === null ? 'Pinned by the link — not one of the presets' : PRESET_LABELS[preset].detail;

  return (
    <label
      style={{ alignItems: 'center', display: 'flex', gap: 6, minWidth: 0 }}
      title="How much the frame draws, and what it costs the picture"
    >
      {/* Same rule as the skin's label: decoration first out when the bar is short of room. */}
      {!compact && (
        <span aria-hidden style={{ color: COLORS.muted, letterSpacing: 0.6 }}>
          GFX
        </span>
      )}
      <span style={{ clip: 'rect(0 0 0 0)', height: 1, overflow: 'hidden', position: 'absolute', width: 1 }}>
        Graphics preset
      </span>
      <select
        onChange={(event) => onPreset(event.target.value as GraphicsPreset)}
        style={touch ? styles.selectTouch : styles.select}
        value={preset ?? ''}
      >
        {preset === null && <option value="">Custom</option>}
        {GRAPHICS_PRESETS.map((option) => (
          <option key={option} value={option}>
            {PRESET_LABELS[option].name}
          </option>
        ))}
      </select>
      {!compact && (
        <span style={{ color: COLORS.muted, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</span>
      )}
    </label>
  );
}
