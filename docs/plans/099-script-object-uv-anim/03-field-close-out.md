# 099/03 — Field close-out (the blink on screen, docs synced)

## Subtasks

- [ ] Full rebuild through the normal pipeline (the ferris `.osm` in `models/gta3.img` is written by
      the build, not by hand — the 097/06 rule: field runs read `build/original/opensa` and nothing
      else) and confirm the fetch pack carries the same fixture (the 06 checkpoint pattern).
- [ ] Field check with the bug-round tool: `warnings.js` at the wheel
      (`?cleo=1&spawn=383,-2035,8`, walk to the wheel with `KEYS`), TWO screenshots ≥ 0.3 s apart;
      crop the bulb region (ImageMagick, the edge-cases metering recipe) — the crops must DIFFER
      (the blink) while a control crop of static structure is identical; zero console warnings.
      Judge from the REPORTER's angle: standing under the wheel at night, the bulbs visibly step.
- [ ] Numbers to the ledger: blink cadence observed vs the authored 0.225 s, per-frame cost of the
      animated model's advance, boot delta. Reported figures also to `docs/benchmarks/`.
- [ ] Docs, same change: REMOVE the `docs/edge-cases/engine-rendering.md` "script objects play no UV
      animations" row (limitation lifted — only current limitations live there);
      `docs/features/cleo.md` state note; architecture doc + diagram only if the rigid-path doc
      exists and describes materials (check `docs/architecture/`); this plan's rows in
      `docs/plans/README.md` flipped to DONE.

## Verification

The user's own report closes it: the wheel spins AND blinks at night. The A/B crops and the numbers
are in the ledger; no regression in the bench scene; the corpus scripts still run warn-clean.

## Ledger

_(numbers on completion)_
