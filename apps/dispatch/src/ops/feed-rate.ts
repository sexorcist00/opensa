/**
 * How often the board changes, and why that is a fact rather than a preference (201/9-02).
 *
 * **The mock ran at 80× the rate of the interface it stands in for.** `useOperations` ticked at 50 ms and
 * `stepOperations` returns a freshly spread object every tick, while `RenderGate` compares the board by
 * IDENTITY — so the board forced a draw twenty times a second and render-on-demand could never rest longer
 * than 50 ms, on a console whose feed publishes every **four seconds**. Every 150-unit row this chain has
 * taken was taken under that churn, so each of them measured the mock as much as the product.
 *
 * **Four seconds WAS read out of PCAD, and is no longer the rate.** `cadui.lua`'s `sendPositionUpdate` thread
 * publishes `pos_x, pos_y, pos_z, heading, vehicleId` every 4 s and only while the unit is in a vehicle
 * ([202 §4](../../../../docs/plans/202-pcad-dispatch/readme.md)) — that is what the plugin ships today, and
 * it was the hardest constraint on this map. On **2026-09-05 the user took 202 phase 4's first answer** and
 * dropped it to 500 ms, so the console is built against 2 Hz and PCAD owes the client change.
 *
 * **A board rehearsing a smoothness the product does not have is still the thing to avoid**, and that is why
 * this is 500 rather than 50. [201/8-02](../../../../docs/plans/201-dispatch-console/8-the-time-axis/readme.md)
 * stands unchanged: a track answers with the last fix and STEPS between two of them rather than sliding. The
 * step is now ~14 m at 100 km/h instead of ~110 — the same rule, at a gap the eye stops reading as a jump.
 */

/**
 * The mock board's publish interval, ms — the rate the console is built against.
 *
 * It is not a frame budget and not a render rate: the console draws on demand, and this is how often there
 * is anything new to draw. **500 ms since 2026-09-05** (the user's call; it was 4000). The reasoning, the
 * ceiling it sits on and what PCAD owes for it live on the twin of this constant in
 * [`tracks.ts`](./tracks.ts) — this one is the mock's tick, that one is the fact about the feed, and they
 * are two files because one is a stand-in and the other is the interface.
 *
 * **What it costs, stated rather than discovered:** this step slowed the mock from 50 ms to 4 s precisely
 * because a board changing 20x a second forced a draw 20x a second and render-on-demand could never rest.
 * At 500 ms the board wakes the frame twice a second by design — 2 Hz is 202 §4's stated ceiling for this
 * map and the deliberate price of a unit that moves ~14 m between fixes instead of ~110. Every row taken
 * before this was taken under a 4 s board, so `framesSkipped` and anything read off idle behaviour are NOT
 * comparable across the change; `?tick=` reaches either rate for a capture that needs the old one.
 */
export const PUBLISH_INTERVAL_MS = 500;

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
