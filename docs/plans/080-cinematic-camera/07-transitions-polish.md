# 080/07 — Transitions, polish, close-out

The chain's finishing plan: everything that needs ALL previous layers in place, plus the exit exam.

## 1. Mode transition audit

02–06 were built so transitions are implicit (shared channels, per-mode tuning tables, no state
resets). This plan proves it:

- Matrix walk: foot↔vehicle (05 blends), photo enter/exit (K+M seeds `flyEye` from the live eye —
  already smooth; verify the RETURN path re-seeds rig springs so leaving photo mode doesn't whip),
  debugger warps/respawn (teleport snap from 02), pause/F2.
- A scripted integration test drives one long snapshot sequence through every transition and
  asserts continuity (no frame-to-frame eye jump > a threshold except declared teleports).

## 2. Pitch-coupled framing (readme addition — polish)

- Looking down: look-point height eases up a touch and distance tightens (the character stays
  composed instead of centering on their back). Looking up: height eases down toward the
  shoulder. Small mapping (≤ 0.4 m, ≤ 1.0 m distance), through existing channels; one config
  curve. Skippable if the field round says the base rig already frames well.

## 3. Tuning consolidation

- Freeze the final tuning tables (foot + vehicle) in `game-runtime-config.ts`; every value that
  survived field rounds gets its ledger line moved into a single "shipped tuning" table here.
- Prune Camera-tab rows down to the knobs that proved useful during rounds (the rest stay
  config-only) — the tab is a tuning tool, not a settings screen.

## 4. Performance + regression exit exam

- Measure `director.update` p95 on foot / in traffic / in an interior (collision whiskers hot):
  budget < 0.1 ms, casts ≤ 5/frame — ledger with numbers.
- Ritual 6-scene bench sweep: fps/draws within noise of the pre-080 reference row (bench bypass
  invariant — this row is the proof the chain touched nothing it shouldn't).
- One soak leg (`?soak`) with the new camera live to confirm no drift/leak in rig state.

## 5. Close-out

- Delete the `?cam=legacy` branch and the preserved pre-080 inline path (its parity test retires
  with it); `?cam` stays reserved for future camera debug if needed.
- `engine-camera.test.ts` and the director suite are the pinned behaviour record; docs sweep:
  this chain's ledgers complete, readme status flipped to DONE with the field-verdict quotes
  (paraphrased in English, per repo rule).
- Write the 0.6.0 idea stubs deferred from the readme: idle cinematic auto-camera, R-key
  cinematic vehicle camera, gamepad input path (camera-ready once input exists).
- Memory/handoff update (outside the repo): camera chain state + tuning gotchas.

## Subtasks

- [ ] Transition matrix + continuity integration test.
- [ ] Pitch-coupled framing (or a ledger line explaining why it was skipped).
- [ ] Tuning freeze + tab prune.
- [ ] Perf measurements + ritual sweep + soak leg (ledger).
- [ ] Legacy-path deletion + docs sweep + idea stubs.

## Acceptance

- User plays a full mixed session (foot + car + interiors + photo mode) and accepts the camera as
  the default experience — the chain's real gate.
- Ritual row within noise; budgets in the ledger; suite green; `?cam=legacy` gone.

## Ledger

_(append here)_
