/**
 * What the OPERATOR is allowed to trade, and what each trade is worth.
 *
 * 201's decisions forbid a **silent** quality ladder — a console that quietly draws less on a device it
 * has decided is slow, so that two operators see different worlds and neither is told. This is the opposite
 * of that and is what makes it allowed: the ladder is named, it is chosen, it says what each rung buys, and
 * the report states which rung ran.
 *
 * **Every rung here has a measured number behind it, because the chain's own rule is that nothing is tuned
 * before its arm is run.** The two levers are the bloom chain's presence and where its pyramid starts:
 *
 * | rung | what changes | measured |
 * | --- | --- | --- |
 * | `full` | prefilter at full resolution | the pre-2026-09-05 default. Its half-res replacement measured **−4.4 ms** and the operator chose it at night ([9-05](../../../../docs/plans/201-dispatch-console/9-the-mobile-frame/readme.md)) |
 * | `balanced` | prefilter at half resolution | what shipped on 2026-09-05 morning, and the default until that evening |
 * | `smooth` | no bloom chain at all | **44.6 % of frame pairs stutter → 7.9 %**, 5.6x ([the row](../../../../docs/benchmarks/opensa-engine/2026-09-05-mobile-frame-pacing.json)). **THE DEFAULT since 2026-09-05**, by the operator's night verdict: no difference to the eye, much smoother |
 *
 * **What is deliberately NOT here.** Resolution, sample count and scene format are the standing refusal
 * (the user's call, 2026-09-04): frame time may not be bought with resolution, sampling or anti-aliasing,
 * and `?scale=`, `?msaa=` and `?scene=` stay measurement arms. They also could not be live if they were
 * wanted — the pipelines are compiled against them at init — where these two rebuild the targets and
 * nothing else, which is why the whole ladder applies without a page load.
 */
import type { JsonStorage } from '../map/storage';

import { readJson, STORAGE_KEYS, writeJson } from '../map/storage';

/** The rungs, in the order they are offered. `balanced` is the shipped default. */
export const GRAPHICS_PRESETS = ['full', 'balanced', 'smooth'] as const;

export type GraphicsPreset = (typeof GRAPHICS_PRESETS)[number];

/** What the operator chose. One object so the panel, the URL and storage all speak the same shape. */
export interface GraphicsSettings {
  /** Whether the bloom chain runs at all. `false` skips every one of its passes. */
  readonly bloom: boolean;
  /** Where the bloom pyramid starts, as a fraction of the render size. Ignored while {@link bloom} is off. */
  readonly bloomScale: 0.5 | 1;
}

/**
 * The rung the console ships on, and what an unreadable stored value falls back to.
 *
 * **`smooth`, by the operator's verdict of 2026-09-05** — the second of two that day, and the one that went
 * further than the first. Shown the whole chain removed at NIGHT (`night` against `nightnobloom`, differing
 * by the ablation alone), the answer was that there is no difference to the eye at all and that the picture
 * is much smoother without it. Beside that verdict sits the measurement: **44.6 % of consecutive frame pairs
 * stutter against 7.9 %**. The look it gives up is one tap away in `full` and `balanced`, so this is a
 * default moving rather than a capability going ([the protected list](../../../../docs/plans/201-dispatch-console/1-the-map-profile/protected-list.md)).
 */
export const DEFAULT_PRESET: GraphicsPreset = 'smooth';

const SETTINGS: Readonly<Record<GraphicsPreset, GraphicsSettings>> = {
  balanced: { bloom: true, bloomScale: 0.5 },
  full: { bloom: true, bloomScale: 1 },
  smooth: { bloom: false, bloomScale: 0.5 },
};

/** What each rung is called and what it BUYS, in the operator's words rather than the renderer's. */
export const PRESET_LABELS: Readonly<Record<GraphicsPreset, { detail: string; name: string }>> = {
  balanced: { detail: 'Bloom at half resolution — the default until 2026-09-05', name: 'Balanced' },
  full: { detail: 'Bloom at full resolution — the most light, the least steady', name: 'Full' },
  smooth: { detail: 'No bloom — steadiest frame, and what the console ships with', name: 'Smooth' },
};

/**
 * The rung to open on: what the URL pins, else what the operator last chose, else the shipped default.
 *
 * A URL wins over storage for the same reason it does for the skin — a shared link has to reproduce what
 * its sender was looking at, and the receiver's own preference reasserts itself the moment they touch the
 * control.
 */
export function initialPreset(params?: URLSearchParams, storage?: JsonStorage): GraphicsPreset {
  const asked = params?.get('graphics');
  if (asked !== null && asked !== undefined) {
    const match = GRAPHICS_PRESETS.find((preset) => preset === asked);
    if (match !== undefined) {
      return match;
    }
  }
  const stored = readJson(STORAGE_KEYS.graphics, storage);

  return GRAPHICS_PRESETS.find((preset) => preset === stored) ?? DEFAULT_PRESET;
}

/**
 * Which rung a pair of settings IS, or `null` when it is none of them.
 *
 * The panel offers rungs and the URL can carry either, so the two can disagree — a shared link may pin
 * `bloomscale=1` with bloom on, which is `full`, or a combination no rung names. Saying `null` rather than
 * rounding to the nearest rung is the point: a control that claims a preset the frame is not running is the
 * same defect as an arm that restates the default.
 */
export function presetOf(settings: GraphicsSettings): GraphicsPreset | null {
  for (const preset of GRAPHICS_PRESETS) {
    const rung = SETTINGS[preset];
    // With bloom off the pyramid's start cannot be seen, so it does not decide which rung this is.
    if (rung.bloom === settings.bloom && (!settings.bloom || rung.bloomScale === settings.bloomScale)) {
      return preset;
    }
  }

  return null;
}

export function savePreset(preset: GraphicsPreset, storage?: JsonStorage): void {
  writeJson(STORAGE_KEYS.graphics, preset, storage);
}

export function settingsFor(preset: GraphicsPreset): GraphicsSettings {
  return SETTINGS[preset];
}
