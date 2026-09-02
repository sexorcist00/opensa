/**
 * When the cumulus field is re-baked, instead of every frame unconditionally (201/9-06).
 *
 * **The finding.** `engine.frame()` opened a `cloud-field` render pass on every frame whatever the sky was
 * doing: 256² with two fbm evaluations per pixel, for a field that scrolls at `t * 0.004` and is visually
 * identical for minutes. Both patterns it needed were already in the same function, within twenty lines —
 * `refreshSkyLut` keys its inputs and returns early when nothing moved, and `scheduleProbe` amortizes over a
 * frame interval. It is the clearest case in chain 9 of a solved problem sitting beside an unsolved copy of
 * itself.
 *
 * **It needs BOTH of those patterns, and that is the whole content of this file.** The bake has two inputs
 * of different kinds:
 *
 * - **`cloudScale`** (`frame.cloudTop.w`) is a step — the weather changes it and the field must change with
 *   it, that frame. Keyed, like the sky LUT.
 * - **time** is a scroll — it advances every frame by an amount nobody can see. Amortized, like the probe.
 *
 * Keying alone would freeze the drift; amortizing alone would hold a stale field across a weather change for
 * up to a rebake period. So the rule is *either*, and neither half is a fallback for the other.
 */

/**
 * The default rebake rate, Hz — a few per second, which is the order 9/06 named before this was built.
 *
 * It is the one number here that is chosen rather than derived, so it is named in one place and it is an
 * ARM: a capture can put every-frame back and price the difference, and the look verdict 9/06 owes ("the
 * clouds still move") is taken on the device rather than argued from this line.
 */
export const CLOUD_FIELD_HZ = 10;

/** What the bake decision needs to know about the last one. `null` means nothing has been baked yet. */
export interface CloudFieldBakeState {
  /** `performance.now()` when the field was last baked. */
  readonly atMs: number;
  /** The `cloudScale` that bake was made with. */
  readonly scale: number;
}

/**
 * Whether this frame must re-bake the cumulus field.
 *
 * @param hz rebake rate; `0` (or anything not positive) means every frame, which is the pre-9/06 behaviour
 *   and the other side of the arm.
 */
export function shouldBakeCloudField(options: {
  readonly hz: number;
  readonly nowMs: number;
  readonly previous: CloudFieldBakeState | null;
  readonly scale: number;
}): boolean {
  const { hz, nowMs, previous, scale } = options;
  if (previous === null || !Number.isFinite(hz) || hz <= 0) {
    return true;
  }
  if (previous.scale !== scale) {
    return true; // a step, not a scroll: the weather moved and the field is wrong NOW
  }

  return nowMs - previous.atMs >= 1000 / hz;
}
