# Architecture restrictions

What may depend on what, and the constants separate tools have to agree on. Violating one of these does not
produce a wrong picture — it produces a build that cannot be reasoned about.

## The runtime may never reach for the converter

`type:engine` may not depend on `type:tool` (`@nx/enforce-module-boundaries`, `eslint.config.ts:284`). The
tags allow `app → engine`, `engine → engine`, `tool → engine|tool`, and nothing else.

The consequence bites when writing TESTS, not features: a test that needs both the writer and the runtime
cannot live in `packages/game`. It goes in the tool (`tools/opensa-pack/src/vehicle-osm.test.ts` is the
worked example, and its header says why). Two tests have already been moved for this reason.

**Caught:** yes — ESLint fails the lint lane.

## The game layer touches renderware only through `adapters/` or `mods/`

`packages/game/**` may not import `@opensa/renderware` outside those two folders
(`no-restricted-imports`, `eslint.config.ts:248`). The engine must never learn what a `.dff` is.

**Caught:** yes — ESLint.

## The repo's lint is stricter than `CLAUDE.md`

Where the two disagree, ESLint wins: it requires `interface` over `type` (the opposite of the project
guideline), forbids the renderware import above, sorts module members and Set literals, and caps cognitive
complexity at 20. `commitlint` accepts `ci · chore · docs · feat · fix · perf · refactor · revert · style` —
**there is no `test` type**; a test-only change is `chore`.

**Caught:** yes — lint + the commit hook.

## One cell size, agreed by four places

The cell-LOD bake, the pack's render grid, the engine's streaming grid and the runtime config must all be
**250**. `tools/perfect-map-builder/src/config.ts` (`lodCellSize`), `tools/opensa-lod-generator/src/lod.config.ts`
(`cellSize`), `packages/cell-weld/src/cell-size.ts` (`CELL_SIZE` — the one declaration, imported by
opensa-pack and by sa-map-viewer), `apps/web/src/ui/game-runtime-config.ts`.

A mismatch puts an object's HD and its LOD in **different streaming slots**, and at spawn neither loads. This
is not hypothetical: the pre-087 bake ran at 256 and gostown's bridge main span had HD in slot 5,−7 and LOD
in 5,−6.

Collision streaming and procobj scatter keep their own `GAME_CELL_SIZE` (256) — that knob is unrelated and
must not be "unified" with this one.

**Caught:** no — nothing compares the four. The symptom is missing geometry in the field.

## A frame-time span may only wrap synchronous work that runs BETWEEN frames

The recorder is `packages/engine/src/debug/frame-spans.ts` (`type:engine`, so the app, the game layer and the
engine may all report into it). Two rules bound what may open a span:

- **Synchronous segments only.** Timing across an `await` measures the wait too, and two overlapping waits
  each claim the same milliseconds — the totals then exceed the gap they are attributed to.
- **Never wrap work the frame loop already times.** The loop subtracts both its own block timers and the
  drained spans from `dt`; a span inside a timed block is subtracted twice.

**Caught:** no. Both failures produce a plausible-looking breakdown — a negative or shrinking `unattributed`
rather than an error. The check is structural: a span belongs in a promise continuation, a worker handler or
a callback, never in the loop body. Detail + the measured shape: [`edge-cases/browser-runtime.md`](../edge-cases/browser-runtime.md).

## A field run reads the built game dir and nothing else

`build/<game>/opensa` — its `data/` included. The built `data/*` is the MERGED result with mods installed and
can differ from `game-src/<game>/data/*` completely. Diagnosing against the source tree cost a whole session
(plan 081/02: a shivering car chased against a `handling.cfg` row the game was not running).

`scripts/debug/handling-diff.ts` defaults its baseline to the BUILT table for this reason.

**Caught:** no. The check is one command: confirm which folder is being served before forming a hypothesis.

## A build asks for a target, not for the whole pipeline

`sa` and `opensa` are independent targets of the same source tree, selected with pmb's `--exclude`
(`build:game:<id>:opensa` / `build:game:original:sa`). They write disjoint subtrees of the same `--out` and
only `<out>/.work` is cleared, so an excluded target keeps whatever an earlier run left.

A plan that says "rebuild the game" has to say **which target**, because they no longer carry the same
content: the `:sa` script excludes `vehicles` and `peds`, so the real-game build ships the stock roster.

**Caught:** partly — an unknown `--exclude` name is a hard error, but a STALE target left by an older run is
indistinguishable from a fresh one.

Detail: [`architecture/perfect-map-builder.md`](../architecture/perfect-map-builder.md).

## A debug view has exactly ONE owner of what it shows

A tool that renders a chosen subset — the map inspector's cell set, a layer list, a filtered entity list —
must have a single writer of that subset. Plan 094 broke this twice, in opposite directions:

- phase 1's camera-follow and phase 2's panel both wrote the cell set, so the grid's checkboxes and the
  camera disagreed about what was on screen (fixed by giving the panel sole ownership);
- phase 6 then found the other half: with `?panel=0` there IS no panel, so nothing wrote the set at all and
  **every scripted capture rendered an empty world** — for four phases, while the tool looked like it worked
  (the phase 2/3 numbers happened to be taken with the panel up). The host now seeds the set itself in
  capture mode, and only there.

The rule for a new design: name the owner for every mode the tool has, including the headless one, and make
the ownerless mode impossible rather than merely unlikely.

**Caught:** no, and it is the worst kind of silent — the failure renders. A tool whose subset can be empty
must SAY it is empty (the viewer prints its resident cell count on every set change).

## Scripted control commands what a PLAYER commands, never what the systems compute

Anything that drives the game from outside — a scripted timeline, an autopilot, a future CLEO opcode — speaks
the `InputState` a player speaks, and reads the derived numbers back through an accessor the owning system
publishes. It may not recompute them.

Steering is where this bites. `move.x` is not an angle: `drive()` multiplies it by the authored
`fSteeringLock` **and** by `steerLimit()`, which needs the adhesion under the front wheels (four rays, once
per step), the traction, the speed and the sway (`enter-vehicle.system.ts`'s `drive`). A controller that
reconstructs that has a second adhesion probe and a second chance to disagree with the tyres — which is the
same class of bug as the 081/09 limiter running on a different number than the wheels. 096/02 therefore added
`EnterVehicleSystem.steeringModel()` (granted lock, current angle, slew rate, wheelbase off the car's own hub
placements) rather than a copy of the limiter.

The corollary: a new control input is a SIBLING source in `CombinedInput`, not a change to the driving path.
Note that `CombinedInput` **sums** move vectors, so a live keyboard adds to a scripted source's command.

**Caught:** no. A recomputed lock is silent — the car simply steers a fraction of what was asked, and looks
like an under-tuned controller. The limiter itself, with the reversed-source derivation, is documented in
`packages/game/src/vehicle/steering.ts`.

## A diagnostic tripwire is whitelisted per DECLARED event, never per mode

A watchdog exists to report the discontinuity nobody planned. The moment a new owner of the watched channel
is exempted wholesale — "the camera jump watchdog ignores video mode" — the tripwire is gone for everything
that owner does, including the jumps it did not mean to make. The exemption has to be as narrow as the event
that justifies it: the OWNER declares the frame, and the watchdog forgives that frame only.

096/03 is the shape to copy. Video mode's director owns the camera for whole scenes and cuts between shots
several times a scene; `watchCameraJump` accepts a one-frame `videoCut` flag the module raises and the host
loop clears after reading it, so a cut is legitimate and everything between cuts is still watched. The same
discipline is what makes the module's own tests able to assert continuity BETWEEN cuts (`director.test.ts`'s
pan-rate exam) — the flag is a contract, not a suppression.

The corollary for the test side: a per-frame continuity assertion that measures ACROSS a declared cut is
measuring the cut. Both 096/03 and 096/04 lost a round to exactly that.

**Caught:** no, and worse than silent — a muted watchdog looks like a clean run. The only signal is the
absence of lines you were not going to get anyway. Grep for what a whitelist covers before trusting a
"0 warnings" field report.

## A framing decision taken on a THRESHOLD will be taken again next frame

Any rule of the shape "if the signal exceeds X, compose it this way" is a step function, and the shots that
sit near X are the ones it ruins. It has bitten the camera three times now: 080's all-rays collision gate
(built, field-rejected, `docs/postmortem/080-cinematic-camera/multiray-collision.md`); 096's empty-frame
guard, which was designed around the lesson and is a CLOCK rather than a gate; and 096's lead room, which
mirrored the framing anchor at `|screenMotion| ≥ 2 m/s` and so stepped **0.24 of the frame's width** in one
frame — on `nose`, the one shot whose geometry parks that signal right on the line (~0.11 × speed).

The three answers, in order of preference: make the quantity CONTINUOUS in the signal (lead room is now a
smoothstepped share, so no speed is a cliff); make the decision DISCRETE but rate-limited (the tripod's
sightline: one probe a second, two blocked answers to cut); or put the hysteresis in the CLOCK (the
empty-frame guard's 1.5 s). Never in a moving camera.

**Caught:** now yes for this one — `shots.test.ts`'s "never steps the anchor across a crossing speed" sweeps
the range and holds the per-step move under the ramp's own slope. In general no: a threshold renders fine in
every screenshot and only shows in motion, at the speeds nobody happened to drive.

## A camera pose is composed IN the frame it is drawn in, and measured against the pairing that renders

A pose written from a module's own `requestAnimationFrame` pass reaches the host's loop one frame later, so
the screen pairs THIS frame's subject with the PREVIOUS frame's camera. For a camera that stands still that is
a shrug. For one MOUNTED on the subject it is the whole defect: the pairing carries the subject's entire
travel for that frame (`speed × dt`), and frame-clock jitter modulates it — **0.33° of horizontal wobble on a
5 m side-on shot at a 12 m/s cruise, about 7 px**, which is what 096 shipped and a human saw immediately.

The rule: anything composed against a per-frame render pose is stepped FROM the loop that draws it, between
the subject's render pose and the camera snapshot (`engine-canvas-host.tsx`'s `stepVideo`). The module still
owns its own clock for everything that is not per-frame — staging, the fragment's seconds, the survey.

**The measurement half of the rule, which is the part that actually cost a round:** a metric that judges the
pose against the subject it was COMPUTED from measures the intent, and is blind to the pairing by
construction. 096's mount fix moved that intent metric 0.311° → 0.032° and the shiver on screen did not
change at all (0.332° → 0.305°) — the reported bug survived a measurement that said it was fixed, and only a
second field report caught it. `scripts/debug/video-shiver.ts` now reports BOTH pairings side by side, and
the `frame-late` column is a regression tripwire rather than history.

**Caught:** no. Nothing in the type system or the tests can see which frame a pose lands in; the director's
own unit tests are pure and correct either way, and every headless acceptance number stayed green through it.
The only signals are the `frame-late`/`same-frame` split above and a human watching motion.

## A camera MOUNTED on a moving subject is damped in the SUBJECT's frame, never the world's

`smoothDamp` (and any spring, any lag filter) tracks a moving target with a steady-state error proportional
to the target's speed. Point one at a car's world position and the camera inherits a permanent lag — measured
**~1.1 m at a 12 m/s cruise** with the shot table's own 0.18 s constant — and closes it a little each frame by
an amount proportional to `dt`. The frame clock is not uniform (a healthy 120 fps headless scene measured
**3.1 ms RMS of jitter, 16-19 ms spread**), so every irregular frame moves the eye by a different distance and
the mount BUZZES along the direction of travel.

The rule: damp what actually changes. Re-base the damper against the subject — read the current pose relative
to where the subject stood last frame, write it back relative to where it stands now — and a constant-speed
drive leaves it nothing to do. The smoothing then eases only the heading the mount hangs off and the framing,
which is what it was put there for. A PLANTED camera (a tripod, a flyby) re-bases against the world, because
it is not mounted on anything and its lag behind a passing car is the shot.

The corollary a screenshot cannot show: **this only reaches the screen where the lag axis is perpendicular to
the view.** In 096 the same 0.034 m of eye jitter was 6.0 px/frame² of shiver on the side-on `wing` shots and
0.5 px on `nose`, whose eye rides 10 m ahead and whose lag merely changes the distance. Judging a mount from
the shot that happens to hide the defect is how this shipped.

**Caught:** now yes, by `apps/web/src/ui/video/director.test.ts` ("does not let an irregular frame clock shake
a car-mounted shot") — it drives a constant cruise on a deliberately uneven clock and holds the mount's spread
under a millimetre; the world-damped version wanders 2.2 mm on that same test and ~0.2 m in the field. It was
SILENT before that: every headless acceptance number 096/03 and /04 collected (99.1 % safe frame, 0 `[cam]
jump` lines) was blind to it, because a mount that buzzes 6 px still frames its car perfectly and never jumps
far enough to trip a watchdog. It took a human watching the footage. `scripts/debug/video-shiver.ts` over a
`?video=1&diag=1` capture is the instrument that names the guilty channel.
