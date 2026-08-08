# 098 — execution priority

Linear with one spike pulled forward. Bikes are the user's headline — they reach a complete field
experience (physics + animation) before the refactor and the new frameworks start.

| Order | Plan | Why |
| --- | --- | --- |
| 0 | **03's phase-0 spike** | Teach the wheel regex `wheel_front`/`wheel_rear`, re-bake ONE bike, spawn it, ride it as a narrow car with an instant mount. Answers the only genuinely uncertain engine questions (bike COL shape, two-wheel raycast stability, the `isUpright` enter gate) before anything is designed on top. ~A day. |
| 1 | **01 Data foundations** | Everything downstream reads its output: `type` at runtime scopes 03/05/07, the `!` table feeds the balance controller, `^` + `anims` feed 04, `handlingFlags` feeds 06 and 07. Pure parser work, fixture-driven from the real 212-row file. |
| 2 | **03 Bike & BMX physics** | The hard novel piece and the user's first ask. **Field checkpoint 1: NRG-500 and BMX ride believably** (lean, wheelie, bunny-hop), quad/mtruck verified on the generic path. |
| 3 | **04 Rider animation** | Completes the bike experience while the physics field feedback is fresh. **Field checkpoint 2: the rider sits, pedals and leans; mounting a bike looks deliberate.** |
| 4 | **02 Features module** | The extraction refactor lands before new consumers pile on: pop-up lights migrate with zero behaviour change (glendale control rebake proves it), the registry and vocabulary open for 05/06. |
| 5 | **05 Trailers & towing** | First Rapier joints — the second novel piece. Uses 02's tokens for hook overrides. **Field checkpoint 3: hitch artict1 to a linerun, drive, reverse, detach.** |
| 6 | **06 Special abilities** | Content wave on the 02 registry: hydraulics first (the user's own example), then moving `misc_*` parts. **Field checkpoint 4: a lowrider bounces; a token moves the ability to a mod car.** |
| 7 | **07 Per-class gameplay** | Polish that needs everything alive: per-class mount/enter (incl. `NO_DOORS`), `^` door timings, per-class camera, roster. |
| 8 | **08 Acceptance & close-out** | Per-class acceptance drives, regression bands extended to bike scenes, benchmarks, audit — the big-rework rule. |

Checkpoints: 01 and 02 are fully headless (parser fixtures + module suite); field sessions at 03, 04, 05
and 06 (each judged from the reporter's exact angle — a "wheelie works" verdict is not a "riding feels
right" verdict); 08 closes with the phys-regression gate green including the new scenes.

Ordering rationale: 03 before 04 because animation reads the physics state (lean angle, cadence source);
02 after 04 so the refactor never blocks the headline, but before 05/06 which grow on its registry; 05
before 06 because the hitch framework is riskier than ability drivers and its field verdict may reshape
06's part-driver design (a trailer hook IS an articulated-part + joint combo).

Interplay: touches `physics-world.ts`, `enter-vehicle.system.ts` and `engine-canvas-host.tsx` — the 097
CLEO chain wires into `engine-canvas-host.tsx` (its 04) and the installers (its 06); sequence those
changes apart. 081's regression gate guards every physics step here. The corpus lives in
`NO_COMMIT/all-veh` (uncommitted) — 02 fixtures the VSA vocabulary and the glendale control car into the
repo before depending on them. If a parallel chain rebakes vehicles in the same game build, coordinate.
