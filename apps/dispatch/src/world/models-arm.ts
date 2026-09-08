/**
 * Whether the board's units are drawn as CARS at all — the fleet's own arm (201/9, `docs/plans/201`'s §6).
 *
 * **The fleet's cost has never been measured against a control arm.** What the record calls the price of
 * 150 units drawn as models is the difference between two windows that were not built to differ in one
 * thing: the models "happened not to load" in one of them — a convert without the board's own names, a pak
 * served without its game dir — and the row was read as a subtraction. That is a measurement of an accident,
 * and it cannot be re-flown, because the accident is what nobody can reproduce on purpose.
 *
 * `?models=0` makes it reproducible. It removes the WHOLE path (the user's call, 2026-09-08) — the loads,
 * the uploads and the draws — by handing {@link UnitModels} no source at all, which is the same state a
 * pak-only deploy is in. So the arm prices what the fleet costs the frame AND what it costs residency, and
 * those two together are what the 5/02 budget is about:
 *
 * | | what it removes | what it leaves |
 * | --- | --- | --- |
 * | `?models=0` | model reads, texture uploads, per-unit root matrices, every vehicle draw | the units, on their symbols |
 * | absent | nothing | the declared board |
 *
 * **The units do not disappear on this arm, and that is not automatic.** A unit whose car is gone earns its
 * mark back through {@link UnitModels.willDraw}, which answers `false` when there is no source — the clause
 * this arm and the shareable demo share, and which was missing until 2026-09-08. Without it the arm would
 * measure a map with no units on it and report it as the cost of the fleet.
 *
 * Like every arm in this family: unrecognised is the DEFAULT, because a typo that silently measured a
 * cut-down frame is the expensive failure, and the capture states what actually ran.
 */

/** Whether a run draws its units as cars. `off` is `?models=0`, spelled the way a filed row spells it. */
export type ModelsArm = 'off' | 'on';

/**
 * Read the arm out of `?models=`.
 *
 * Absent is `on`: a console an operator opens draws its fleet (201/5-04, and the protected list's *cars and
 * peds are drawn*). Only the exact string `0` takes the arm off.
 */
export function modelsArm(params: URLSearchParams): ModelsArm {
  return params.get('models') === '0' ? 'off' : 'on';
}
