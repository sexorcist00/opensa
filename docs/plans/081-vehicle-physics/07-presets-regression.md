# 081/07 — Class presets, physics CI, close-out

The exit plan: prove the chain generalises beyond the reference trio, freeze it against regression,
and close the bookkeeping.

## 1. Per-class field sweep

- The chain so far tuned against infernus / admiral / firetruck. Sweep the shipped tuning across
  handling's natural classes: sports · sedan · heavy (truck/bus) · offroad · van/pickup — 2–3
  representatives each, spawned via the F2 vehicle spawner. Where a class needs a shared correction
  (e.g. bus steering-lock feel, offroad suspension bias), it lands as a NAMED class factor in one
  table — never per-model hand edits (0.5.0/04 all-vehicle-types inherits this table as its preset
  seed; bikes/trailers stay out of scope here).
- The 841-car bench road sweep doubles as a mass spawn-sanity check (rest attitude, no sleep-jitter,
  parking holds on grades) — run it once on the final tuning.

## 2. Physics CI — the replay regression pack

- Lock the scene matrix (plan-01 scenes + the ones added since: hill-start, throttle-in-corner)
  × the trio into a committed regression pack: expected `[phys]` captures with per-signal tolerance
  bands (`phys-compare.ts` from plan 01), runnable headless via the bench harness — the physics
  twin of the render ritual. Any future PR touching physics/vehicle code runs the pack; a band
  breach is a finding, not noise (bands were set from accepted field rounds).
- Unit-level: the chain's pure modules (mapping, stability, drivetrain, telemetry) are already
  test-covered per plan; this plan audits coverage of the seams (pre-step hook order, quirk ledger
  tests all still meaningful) and deletes tests pinned to retired behaviour (e.g. the 480-N brake
  constant assertions).

## 3. Performance budget (measured, not assumed)

- Fixed-step cost with 8 live vehicles (player + road cars in ring 0): target ≤ 0.5 ms/step for
  the whole vehicle slice (controller updates + stability forces + drivetrain + telemetry-off).
  Measure on the bench road-car scene; ledger the number and the per-system breakdown from a
  one-off profiled run.
- Collision-damage coupling sanity: `collisionDamageMult` (plan-02 mapping) now scales the damage
  thresholds — verify the crash scene still classifies light/crash sensibly (damage system's
  207k/377k N thresholds were tuned pre-chain).

## 4. Close-out

- Ledgers complete in all 7 plans; readme status → DONE with field-verdict quotes (paraphrased,
  English-only rule).
- The superseded idea (`docs/ideas/0.4.0/plans/07-vehicle-physics/`) already points here; verify
  the 0.5.0/04 cross-reference and hand it the class-factor table location.
- Doc sweep: `docs/plans/018-vehicle-physics/readme.md` gains a banner pointing at this chain as the feel
  layer on top of its foundation; quirks ledger's final state recorded in the readme.
- Memory/handoff update (outside the repo): shipped tuning philosophy, the gate verdict, what
  0.5.0/04 inherits.

## Subtasks

- [ ] Class sweep + class-factor table + field verdicts per class.
- [ ] 841-car spawn sanity run on final tuning.
- [ ] Regression pack committed + harness lane + bands from accepted captures.
- [ ] Perf measurement + breakdown; damage-coupling check.
- [ ] Docs/close-out items above.

## Acceptance

- User accepts driving across all five classes ("each feels like itself") — the chain's real gate.
- Regression pack green and committed; perf inside budget; suite green.

## Ledger

_(class factors, pack bands, perf numbers, final verdicts)_
