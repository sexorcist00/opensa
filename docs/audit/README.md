# Audit

Phase-conclusion audits: when a large arc closes, its outcome is written up here **once**, with the measured
numbers and links to the raw records — so the result survives the session and a later reader sees the verdict
without re-deriving it. Runtime numbers live in [`../benchmarks/`](../benchmarks/); these docs summarise and
interpret them.

- [`uv-repair-retired-and-one-report-per-target.md`](./uv-repair-retired-and-one-report-per-target.md) — the
  2026-08-11 session-3 close of the 025 arc: the field reversed the UV repair in one look (a partial repair
  of a continuous defect is patchwork by construction, and the mapping it writes is invented — no authored
  frame exists, fit residual ~1.8 UV), so the pass was retired the same hour and the problem shelved as an
  open issue (127 models). Then the branch merged (ff) and pmb plan 005 shipped the same afternoon:
  `report-<target>.json` per target with typed fragments, `.work-<target>`, the root `report.json` deleted
  after measuring it was a byte-identical 852 KB copy nobody read. Carries the lesson that should have been
  cheaper: the pass shipped in a build BEFORE its field round, against a restriction that already named the
  field as the gate.
- [`procobj-budget-answered-and-a-knob-nobody-had-connected.md`](./procobj-budget-answered-and-a-knob-nobody-had-connected.md)
  — the 2026-08-10 close: backlog bands **P1 and P2**. P1 asked for the clutter perf budget and found there is
  none to give — at 3× vanilla the layer costs less than one sweep's A/A drift and never hitches, so the caps
  are limited by data and by our own `PROC_OBJ_MAX_DENSITY`, not by frame time. P2 asked for seven VALUES and
  found seven **dead constants**: `procobj[*].drawDistance` had a slider, a setter and a test, and no reader —
  clutter really drew at whatever its 256-unit cell reached. Now applied per instance in the clutter shader,
  100 (SA's own flat `PLANTS_MAX_DISTANCE`) as the floor and 300 for trees/cacti, measured monotone against a
  0.020 % control and free in frame terms. **Also carries a mistake of mine that reached a commit**: I named
  the wrong limiter for the density ladder (the data's spacing, when it was our own constant) by reading the
  curve instead of the function.
- [`procobj-permanent-rows-and-the-shape-that-could-not-fit.md`](./procobj-permanent-rows-and-the-shape-that-could-not-fit.md)
  — the 2026-08-10 late arc: the clutter layer's HD+LOD twin turned out not to fit SA **at all** at the shipped
  density (25 560 linked pairs need 13 inst-bearing areas; 12 exist), and binary streams could never have carried
  its range — `CIplStore` keeps a stream's slot resident only within **190 units**, so the layer drew to ~190 m
  while declared at 290. Replaced by ProperFixes' shape: one permanent row per object at `lod = -1`, range from
  the stock `procobj.ide` raised **59 → 299**. Entities 182 184 → **91 092**, binary IPLs 522 → **191**, and
  OpenSA's runtime scatter gets **95** rules back where a strip had left it 9. **Both field crashes on the way
  were caused by changes made in that session**, one of them by reading a number measured on one path as a budget
  for another — the same mistake as `EntityIpl`, twice in a day.
- [`sa-build-verified-and-the-guards-that-lied.md`](./sa-build-verified-and-the-guards-that-lied.md) — the
  2026-08-10 arc: the `sa` target builds end to end at 91 092 objects (10 m 9 s), and the int16 throw was not
  the only blocker — FLA's IPL pool fired at **522 of 280**, correctly. Raising it surfaced the opposite
  defect: the TXD guard had read 6000 against an install configured at 5000, so **the pool with one slot of
  headroom was the one reporting comfort**. Also: the two targets proven to be the same world on both halves
  (byte-identical input, 182 184 / 182 184 placements through the convert), the runtime clutter layer shown
  to draw nothing on a built map, and a mod's partial `.col` found deleting stock collision in silence.
- [`procobj-density-and-the-guards-that-guarded-nothing.md`](./procobj-density-and-the-guards-that-guarded-nothing.md)
  — the 2026-08-09 evening arc: build-time density became a per-category/per-surface profile with a raisable
  candidate ceiling, and three guards were deleted for guarding a ceiling the target lifted. **Four separate
  documents described a state the code was not in** — including "P1 is blocked", which had been fixed and
  merged days' worth of commits earlier. Also the instrument's floor per COLUMN: content 0.094 %, but `avgMs`
  saturated at the frame cap and `gpuMs.pass` at 13.37 %.
- [`vehicle-physics-081.md`](./vehicle-physics-081.md) — the plan-081 driving chain: `handling.cfg` went from
  5 fields consumed to 21, six global constants died, and the five bugs seven field rounds found were all the
  same mistake — a number guessed where the game ships the answer.
- [`vehicle-physics-081-instruments.md`](./vehicle-physics-081-instruments.md) — the 2026-07-27 instruments
  day: the regression pack, the vehicle slice priced at ~8 µs per car per step, surface types shipped — and
  four findings where the new instruments falsified the questions they were built for (the kerb scene never
  met a kerb; the flip that justified the work had stopped reproducing; `collisionDamageMult` scales
  nothing; the gate's own rule was wrong).
- [`vehicle-physics-081-closeout.md`](./vehicle-physics-081-closeout.md) — the same chain's close-out: air
  control ported from the original, wheels leaning the way their axle is authored, and a five-class sweep
  that found the tuning generalises with **no class factor needed** — while three more scenes turned out to
  measure something other than what they are named after. Also the number a tuning round needs: the vehicle
  slice repeats to ±5 %.
- [`ped-locomotion-feel.md`](./ped-locomotion-feel.md) — the plan-088 ped locomotion chain (both
  2026-07-24 rounds): a full modern locomotion + vehicle ingress/egress stack for ~zero runtime cost
  (blended sample 8.2 µs vs 6.0 µs; no render-side change) and +~100 unit tests.
- [`three-to-own-engine.md`](./three-to-own-engine.md) — the three.js → own WebGPU engine migration:
  runtime (~7× fps, same machine/content) and bundle (−12.8 % gzip despite adding a whole engine).
- [`cleo-basic-097.md`](./cleo-basic-097.md) — the plan-097 CLEO chain: six real mod scripts run
  unmodified on our own SCM VM for 465 µs/tick, gaps are declared DATA enforced by CI joins — and the
  close-out benchmark itself caught a ~3 ms/tick field tax (the `findNext` walk that never exhausted)
  plus a reporting lane that bypassed coverage.
- [`cleo-scripts-001-rhino-tracks.md`](./cleo-scripts-001-rhino-tracks.md) — the authored rhino track
  script (one day, three field rounds): 5.4× cheaper at peak and **114× cheaper in the frame with no
  tank in it**, artifact 2 628 B vs 34 114 B, two defects of the original fixed rather than copied —
  and the honest headline is that **the script was the small half**: three defects underneath it
  (reversed native-call arguments, a wheel roll the engine never published to scripts, a MARKER wheel
  inflated 23.5×) had to be fixed first, and none was findable from the script side.
- [`cleo-scripts-chain.md`](./cleo-scripts-chain.md) — the CHAIN's conclusion: **one script shipped, one
  WITHDRAWN**, and the withdrawal is the more useful result. Authoring against our own VM asked the engine
  questions nothing else asked and found FOUR live defects, the last of which — lamp anchors invented from
  the half-extents for any model with no lamp dummy — was the whole reason 002 had anything to smash. The
  pattern, having recurred three times in two days: **ask what the engine is doing wrong before authoring
  content that compensates for it.**
- [`vehicle-effects-089.md`](./vehicle-effects-089.md) — the plan-089 vehicle-effects chain (one day,
  five steps, six field rounds): two new engine capabilities (the dynamic one-shot particle lane and the
  first decal lane), four effects on SA's own assets, one new physics read born of a dead channel
  (Rapier's wheel rotation is cosmetic) — at zero measurable sweep cost, with every look number a
  documented eye-fit.
- [`sa-map-viewer-094.md`](./sa-map-viewer-094.md) — the plan-094 chain (eight phases, two days): the
  blue-strip hunt's A/B loop went from a **repack** to a **60 ms** browser weld with pixel-identical
  reruns, the whole map welds in 15.3 s, and the tool's first field use found both a defect in itself
  (`?panel=0` drew an empty world) and the strip itself — one placement, `roads32_law2`, whose every byte
  matches vanilla.
- [`modloader-removal.md`](./modloader-removal.md) — deleting the runtime `modloader/` overlay and the
  vehicle DFF fallback it fed: one package and a whole second vehicle pipeline gone (−1816 lines, the
  `vehicle-model.worker` chunk with them), coverage up on every metric, and roadmap item 2 closed by deletion
  instead of by measurement. Reasoning: [`postmortem/runtime-modloader-overlay.md`](../postmortem/runtime-modloader-overlay.md).
- [`video-mode-096.md`](./video-mode-096.md) — the plan-096 chain (eight phases, two days, three field
  rounds): `?video=1&seed=N` as a bounded, seeded, self-directed showcase, built on a road-route capability
  the game's own `NODES*.DAT` always carried and nothing read. **9 036 lines added, `packages/engine`
  untouched, and the host's whole footprint is 185 lines** — the shipped attach pattern holding for a third
  subsystem. Its per-frame cost is **under the timer's resolution** (mean 0.0172 ms over 22 817 frames). The
  lesson worth carrying: three of the four defects that mattered were found by a HUMAN watching footage after
  headless numbers had accepted the build, and each became a rule about what a metric cannot see.
- [`asi-sdk-extraction.md`](./asi-sdk-extraction.md) — the `asi/sdk` chain (five plans, one day): the ASI
  framework moved out of `asi/perfect-map` into a shared SDK, making `asi/` an sdk-plus-consumers category
  like `cleo/`. **perfect-map 1 499 → 705 lines** (497 of them its own subject matter; 179 the seam a second
  plugin must write), the roadmap's copy-verbatim list for `asi/city-life` is dead, and seven hand-copied byte
  arrays went to zero — the "a hand-edited address is structurally impossible" rule is now true rather than
  claimed. Field-confirmed on the real install (dry run + APPLY, both fixes installed with FLA/OLA present);
  the behavioural oracle is the one verdict still open. The method lesson: **the measurement rig failed more
  often than the thing measured** — two of three surprises were harness bugs, caught only by giving each row a
  verdict from a different channel than the number.
- [`plan-07-review-and-100-field-close.md`](./plan-07-review-and-100-field-close.md) — the 2026-08-08 review
  session: plan 07's density chain was costed against a number that counted STREAM RECORDS, not objects (24 552
  vs the real 15 286), and correcting it inverts the chain's conclusion — the int16 lift is back on the
  critical path, and a stock target has 1.18× of headroom in total. Three of its steps' premises were falsified
  by the code. Plan 100's owed field check then ran and passed three rows; the fourth, "is a plate readable at
  LOD range", turned out to be unanswerable by screenshot at ~8 px, so it got an instrument instead
  (`.oscell` minor 8 + HUD `signs N`). Also what the session got wrong: a census scoped by model id, a
  no-op mutation offered as proof, and a grep that hid `.tsx`.
- [`2dfx-at-lod-range-100.md`](./2dfx-at-lod-range-100.md) — plan 100 (five steps, one day): lamps, chimney
  plumes and street-name plates now survive past the HD ring instead of leaving a 560-unit dark, smokeless,
  blank-signed band, and every fx system draws for the `cullDist` it authors rather than one flat 300 (836 of
  878 anchors got 3–12× tighter). **The frame win the plan predicted is not there and cannot be claimed
  either way** — a positive control proved the bench cannot see the particle system at all. Three things the
  plan did not know were found by measuring: a plate's world position lands outside its instance's own cell
  131 times in 489 (now a restriction), steps 01 and 02 could not ship apart, and step 05 fixed nothing that
  was broken. The field check is owed to the chain's single rebuild. The audit itself found a debugger slider
  wired to nothing.
- [`plan-07-per-target-and-effect-distance.md`](./plan-07-per-target-and-effect-distance.md) — the session
  after: plan 100's last row closed (the `insects` floor is field-judged and **inert** — a 2 cm sprite is
  under half a pixel at its cull distance), the dead slider wired as a SCALE over the authored table rather
  than a replacement, `?fx=N` added as the positive control a distance capture needs, and the `prt_*` lane
  floored back at 300 u. Then plan 07 from three open decisions to none: `01` sized (both build-time caps
  zero nothing — MINDIST provably cannot — while the runtime cell cap zeroes species in 19.8 % of scattering
  cells, latent in the shipping build only because our own generator strips them), and 02/04 rewritten per
  target, then narrowed to TWO when stock SA was ruled out of scope — which retired the slot economy 04 is
  named after and left int16, ours, as the only ceiling. Two new instruments, and **both self-checks fired on
  their first run**: pak particle positions are cell-LOCAL, and "the cap is finite" is not "the cap binds".
- [`plan-07-target-selector-and-density-lever.md`](./plan-07-target-selector-and-density-lever.md) — 07/04's
  first two tasks shipped (the target selector, DERIVED from `--exclude` so no operator can forget it; the
  guard move onto the built `sa/` tree, which also fixed a false PASS nobody was looking for), and then the
  perf budget could not be taken. The knob built for the measurement **falsified the plan's density
  premise**: 3× the cutoff yields **+3.6 %** objects, because `cullByMinDistance` culls with the
  `procobj.dat` MINDIST column — four values map-wide, clustered by surface family, and documented by our own
  parser as the *draw* distance. The A/B also found the harness drifting further than the content (control
  scene +107 % triangles → a filed collision defect). The audit itself caught a NaN hole in the new guard
  that would have emptied the clutter layer in silence.
- [`bench-settle-fall-102.md`](./bench-settle-fall-102.md) — plan 102, the day the sweep learned to measure
  itself: A/A `avgTriangles` spread **10.19 % → 0.14 %**, `[cam]` jump lines **89 255 → 1**, and the density
  A/B re-taken to say **d1 ≡ d3** under the noise floor. The audit is mostly about what did NOT hold: two of
  the three red tests pinned less than they claimed (the suite chose a world where the distinction under test
  did not exist — a floor exactly under the capsule's feet), the replacement test written here **passed twice
  with the fix reverted** before the third form discriminated, and the ground-warp turns out to buy less than
  the plan said (the rest gate decides the leg-start state; the warp only halves the descent). Plus a ceiling
  nobody had noticed (`GROUND_PROBE_DROP` 60 m against an anchor 43.75 m up, silent when exceeded), a wrong
  diagnosis assembled from two correct systems, and one regression report that was a background process —
  caught by a scene that could not possibly have been affected moving with the rest.

- [`procobj-chain-closed-and-three-plans-that-were-wrong.md`](./procobj-chain-closed-and-three-plans-that-were-wrong.md)
  — 2026-08-11, thirteen commits: all seven procobj backlog bands closed plus plan 010's last task and
  `asi/perfect-map` 006. **Three plans' premises were destroyed by measurement and a fourth returned the null
  it had allowed for**, all in the same direction — `procobj.dat` is a finished design we were re-deriving,
  not raw material we had to correct. The species roster is guaranteed on both targets (through DIFFERENT
  gates, and that is forced), the shipped density profile is `base: 1` as a RESULT, the biome axis turned out
  to be a second name for the surface, and the `sa` build now both states the install it needs and ships the
  asi into it. Also two A/Bs invalidated by their own instrument — a dead site, and a player who slides
  downhill so no two arms share a viewpoint (the tell: three DIFFERENT comparisons returning 86.81/86.82/86.83 %).

- [`session-4-plan-hygiene-and-the-field-reports.md`](./session-4-plan-hygiene-and-the-field-reports.md)
  — 2026-08-11, fifteen commits, **84 docs and zero source files** (suite unchanged at 4 106, which is the
  point). Plan 013 closed on his procobj run (91 419 objects / 43 species / 110 382 rows, +327 on both — the
  check that the roster floor ADDS rather than swaps). Then: **178 phantom tasks removed from the plan
  record** — ten rendering chains closed since 2026-07-21 still carried 118 unticked boxes, and 074/080/081
  plus `opensa-pack/000` carried 60 more for work already shipped. **The sweep's value is what it did NOT
  touch**: 074/15 never happened (no `bakeNightLights` anywhere), vehicle lamp state and the near-shadow pass
  are verified absent, and two closures are STRUCK because nothing shipped is there to judge. Also: every
  deferred optimization now states its IMPACT, and most of that list cannot fix a frame. **The lesson is
  mine — twice I answered from the cheap signal instead of the authoritative one** (checkboxes instead of
  banners; one end of a lod link from each tree), and both cost a published wrong root cause.

- [`session-7-cutscene-override-twelve-rounds-four-traps.md`](./session-7-cutscene-override-twelve-rounds-four-traps.md)
  — 2026-08-13, 21 commits, one plan opened/rewritten/CLOSED the same day: the `cutscene-override`
  field instrument (cleo/scripts plan 003) — an ini-named cutscene plays at session start, warped to
  its `.cut` site with the world preloaded. Twelve field rounds, one variable each; **four SILENT
  traps became permanent records** (edge-cases/cleo-vm.md): the new-game boot race, the missionless
  intro, global operands as BYTE offsets (a slot number compiled fine and crashed the game), and
  failed CLEO ini reads CORRUPTING the target var — four rounds of "empty world" that looked exactly
  like streaming. SDK grew the `sa-only` target (the mirror of opensa-only) + string8 locals. Suite
  4 165 → 4 175.
- [`session-6-vehicle-cutscene-two-gates-nine-causes.md`](./session-6-vehicle-cutscene-two-gates-nine-causes.md)
  — 2026-08-12, ~21 commits (row added retroactively in session 7 — the file existed, the index row
  didn't): `tools/vehicle-cutscene` built from zero, plan 002 steps 1–7, BOTH field gates passed,
  nine emit root causes recorded. Suite 4 110 → 4 165.
- [`session-5-five-chains-closed-and-one-delta-that-cannot-exist.md`](./session-5-five-chains-closed-and-one-delta-that-cannot-exist.md)
  — 2026-08-12, nine commits, 33 files (three source, two test). Session 4's audit finished: the seven
  unverified chains resolved, six closed. **Nineteen of twenty-one open boxes were record, not work** — 097's
  six were a duplicate of a chain that had shipped beside its code (moved out, five references repointed),
  085's four were answered elsewhere in the same file, 079's one was already satisfied. The two real ones
  shipped: an F2 plate field that rides the placement, and the damage/detach lifetime pinned from both ends.
  **099 closed on numbers plus a delta that cannot exist** — cadence 0.225 s exactly and ~130 ns/advance off
  the built fixture, but the before/after arm renders zero frames (engine era vs pak era, proven from both
  sides of the commit pair), so a stated bound replaces it. **The lesson: a cross-reference is a claim about
  a file you have not opened** — two of them were false here, one calling dropped work "deferred" (082 → 098,
  which had never heard of it) and one calling done work "NOT CLOSED" (100's insects row, judged the same day
  in its hack file). Suite 4 106 → 4 110.

- [`session-8-vehicle-cutscene-chain-closed.md`](./session-8-vehicle-cutscene-chain-closed.md)
  — 2026-08-13, 11 commits: the chain the override was built FOR, closed in one day — 002 steps 8–11
  (bike FIELD-PASSED first round via STRP4B2; boat structurally verified with the field gap NAMED —
  no stock scene plays csdinghy; fleet numbers into the NEW `docs/benchmarks/tools/` family, 23/23
  in 3.55 s; pmb `cutscene` stage right after `vehicles`, dropping out loudly with it) + plan 003
  plates FIELD-PASSED first round (the engine's recovered formula REUSED; readable plates where
  vanilla shows blanks — the demonstrated improvement). Two first-round field passes, each an ini
  edit instead of story progression. Also fixed: `tools/vehicle-cutscene` missing from root
  `workspaces` (the enumerate-everything trap in package.json). Suite 4 175 → 4 203. Remaining:
  the step-11 full-pipeline field acceptance (needs a build without `--exclude vehicles`).

- [`session-9-cutscene-sweep-rounds-3-12.md`](./session-9-cutscene-sweep-rounds-3-12.md)
  — 2026-08-13, the plan-004 sweep's heavy day: six ledger rows closed (10/35 ✅) through ten field
  rounds that recovered THREE render laws of the SA cutscene path (atomics draw in file order with
  z-write on → panes emit last, vanilla's own windscreen_ok-last layout; the vehicle PipelineSet is
  the gameplay shine AND drops translucents outside a CVehicle → stamped on fully-opaque atomics
  only; lamp ID markers render raw → baked white like vanilla) plus the VehFuncs selector semantics
  (`<name>:K` chosen path, `no*` = authored off, year options vs year alternatives via
  `reoffersCarried`, the whole multi-mesh f_wheel). One wrong-mechanism fix (glass-alpha clamp)
  taken and retired the same day, recorded as such. The field method is now
  `docs/development/cutscene-field-testing.md`. Suite 79 → 81 tool tests; no per-model hardcode
  (grep-checked at the user's ask).
