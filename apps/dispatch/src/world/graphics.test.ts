/**
 * The ladder is allowed only because it is not silent, so the negative cases are the ways it could go
 * quiet: a rung that claims to be a rung it is not, and a rung that changes nothing.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PRESET,
  GRAPHICS_PRESETS,
  initialPreset,
  PRESET_LABELS,
  presetOf,
  savePreset,
  settingsFor,
} from './graphics';

/** A storage that answers, so the fallback path is not the only one a test ever sees. */
function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));

  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

describe('graphics presets', () => {
  describe('negative cases', () => {
    it('does not name a preset for settings that are none of them', () => {
      expect(presetOf({ bloom: true, bloomScale: 0.5 })).toBe('balanced');
      // A URL is free to pin a combination no rung offers; rounding it to the nearest rung would put a
      // label on a frame that is not running it.
      expect(presetOf({ bloom: true, bloomScale: 0.75 as 0.5 })).toBeNull();
    });

    it('never offers two rungs that render the same thing', () => {
      const rendered = GRAPHICS_PRESETS.map((preset) => {
        const settings = settingsFor(preset);

        // With the chain off the pyramid's start draws nothing, so it is not part of what is rendered.
        return settings.bloom ? `bloom@${settings.bloomScale}` : 'none';
      });

      expect(new Set(rendered).size).toBe(GRAPHICS_PRESETS.length);
    });

    it('does not let the pyramid decide the rung when the chain is off — it draws nothing either way', () => {
      expect(presetOf({ bloom: false, bloomScale: 1 })).toBe('smooth');
      expect(presetOf({ bloom: false, bloomScale: 0.5 })).toBe('smooth');
    });

    it('buys no frame time with resolution, sampling or anti-aliasing — the standing refusal', () => {
      for (const preset of GRAPHICS_PRESETS) {
        expect(Object.keys(settingsFor(preset)).sort()).toEqual(['bloom', 'bloomScale']);
      }
    });
    it('falls back to the shipped rung rather than trusting a stored value it does not offer', () => {
      const storage = memoryStorage({ 'opensa.dispatch.graphics': '"ultra"' });

      expect(initialPreset(undefined, storage)).toBe(DEFAULT_PRESET);
    });

    it('ignores a URL asking for a rung that does not exist', () => {
      const storage = memoryStorage();

      expect(initialPreset(new URLSearchParams('graphics=potato'), storage)).toBe(DEFAULT_PRESET);
    });
  });

  describe('positive cases', () => {
    it('lets a shared link reproduce what its sender was looking at, over the receiver own choice', () => {
      const storage = memoryStorage({ 'opensa.dispatch.graphics': '"smooth"' });

      expect(initialPreset(new URLSearchParams('graphics=full'), storage)).toBe('full');
    });

    it('reopens on the rung the operator last chose', () => {
      const storage = memoryStorage();

      savePreset('smooth', storage);

      expect(initialPreset(undefined, storage)).toBe('smooth');
    });

    // The operator's night verdict, 2026-09-05: no difference to the eye with the chain gone, and much
    // smoother without it. A test rather than a constant nobody re-reads, because moving this back is a
    // decision that has to be taken deliberately rather than by an edit that looks like a tidy-up.
    it('ships with the bloom chain OFF, by the field verdict that released it', () => {
      expect(settingsFor(DEFAULT_PRESET)).toEqual({ bloom: false, bloomScale: 0.5 });
    });

    it('keeps the released look one tap away rather than deleting it', () => {
      expect(settingsFor('balanced')).toEqual({ bloom: true, bloomScale: 0.5 });
      expect(settingsFor('full')).toEqual({ bloom: true, bloomScale: 1 });
    });

    it('round-trips every rung through the settings it stands for', () => {
      for (const preset of GRAPHICS_PRESETS) {
        expect(presetOf(settingsFor(preset))).toBe(preset);
      }
    });

    it('says what each rung costs the picture, so the choice is not a number', () => {
      for (const preset of GRAPHICS_PRESETS) {
        expect(PRESET_LABELS[preset].name).not.toBe('');
        expect(PRESET_LABELS[preset].detail).toMatch(/[Bb]loom/);
      }
    });
  });
});
