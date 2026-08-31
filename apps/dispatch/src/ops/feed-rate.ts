/**
 * How often the board changes, and why that is a fact rather than a preference (201/9-02).
 *
 * **The mock ran at 80× the rate of the interface it stands in for.** `useOperations` ticked at 50 ms and
 * `stepOperations` returns a freshly spread object every tick, while `RenderGate` compares the board by
 * IDENTITY — so the board forced a draw twenty times a second and render-on-demand could never rest longer
 * than 50 ms, on a console whose feed publishes every **four seconds**. Every 150-unit row this chain has
 * taken was taken under that churn, so each of them measured the mock as much as the product.
 *
 * **Four seconds is read out of PCAD, not chosen here.** `cadui.lua`'s `sendPositionUpdate` thread publishes
 * `pos_x, pos_y, pos_z, heading, vehicleId` every 4 s and only while the unit is in a vehicle
 * ([202 §4](../../../../docs/plans/202-pcad-dispatch/readme.md)). It is the hardest constraint on this map
 * and the one thing about the feed that was not knowable before the client was read.
 *
 * **And publishing faster is a behaviour the console has already ruled out.** [201/8-02](../../../../docs/plans/201-dispatch-console/8-the-time-axis/readme.md)
 * settled that a track answers with the last fix and STEPS between two of them rather than sliding. A
 * 4-second step of ~110 m is what the real feed does and what the map is required to show; a board
 * rehearsing 20 Hz is a board rehearsing a smoothness this product does not have.
 */

/**
 * The mock board's publish interval, ms — PCAD's own rate.
 *
 * It is not a frame budget and not a render rate: the console draws on demand, and this is how often there
 * is anything new to draw.
 */
export const PUBLISH_INTERVAL_MS = 4000;

/**
 * How often the shift clock advances while REPLAYING, ms.
 *
 * Playback is not the feed. A scrub is the operator dragging time, and a clock that stepped in four-second
 * jumps would make `×2` and `×4` a slideshow — so while `clock.mode` is `replay` the loop runs at this
 * cadence and the board underneath still steps at {@link PUBLISH_INTERVAL_MS}. In `live` the clock needs no
 * cadence of its own at all: `advance` pins it to the wall clock, and the timeline reads its span off the
 * history window rather than off `clock.t`.
 */
export const REPLAY_TICK_MS = 50;

/**
 * The board's tick, ms — {@link PUBLISH_INTERVAL_MS} unless `?tick=` says otherwise.
 *
 * The override exists so the churn can be put back for one capture rather than argued about: every row
 * filed before 2026-08-31 was taken at `?tick=50`, and a comparison against one of them needs the old rate
 * available. Out-of-range and unparseable values fall back to the feed's rate — a mistyped tick that
 * silently measured something else is the failure this whole step is about.
 */
export function boardTickMs(params: URLSearchParams): number {
  const asked = Number(params.get('tick'));

  return Number.isFinite(asked) && asked >= 16 && asked <= 60_000 ? Math.round(asked) : PUBLISH_INTERVAL_MS;
}
