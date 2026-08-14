# 001 — Deferred cutscene alpha (the glass-over-actors fix)

Give cutscene vehicle clumps the same deferred, depth-sorted alpha rendering the engine gives
gameplay vehicles, so translucent atomics (window glass, tint) composite OVER scene actors no matter
which order the renderer visits the entities. Closes the mechanism behind plan 004 rounds 15–17 for
good and retires `docs/hacks/cutscene-window-pane-suppression.md`.

## The recovered mechanism (why this works — measured 2026-08-14, plan 004)

- Scene actors (peds) are separate `CCutsceneObject`s; the renderer draws visible entities in
  world-sector scan order — a per-scene accident of positions and camera. Field-proven both ways:
  PROLOG1/PROLOG3/FINAL2B draw actors before the car (glass layers fine), RIOT_4B draws them after
  (a rendered pane z-writes and erases both peds; they reappear in the door gaps).
- Gameplay never shows this because `CRenderer::RenderOneNonRoad` (via `RenderEverythingBarRoads`,
  `0x553AA0`) runs a special choreography FOR VEHICLE ENTITIES ONLY: `RenderDriverAndPassengers`
  first, then the body, then `CVisibilityPlugins::RenderAlphaAtomics` — vehicle alpha atomics are
  DEFERRED per-atomic into a depth-sorted list. A `CCutsceneObject` is an object, not a vehicle: its
  clump renders inline, translucents included, z-write on.
- R*'s authored dodge: vanilla cutscene cars ship no rendering window glass (door glass absent, the
  rest in the sub-alpha-test band; entity alpha-test ref is 140 outdoors, set at `0x553AA0`).
- Six models are already special-cased by name at load (`CCutsceneObject::SetupCarPipeAtomicsForClump`
  `0x5B1AB0`, names at `0x8D0F68`: csvoodoo, csfirela, csmothership, csbravura, cscopcarsf,
  cscopcarla92 → `CCarFXRenderer::CustomCarPipeAtomicSetup` `0x5D5B20`): the vehicle env-map pipe,
  which DROPS translucent atomics outside a real CVehicle. Precedent that per-model cutscene atomic
  setup is a supported engine pattern — we generalize it and make it correct instead of lossy.

Reference source: gta-reversed (`docs/links.md`); the addresses above are 1.0 US VAs from its
`RH_ScopedInstall` lines. The accepted exe is the same single HOODLUM binary perfect-map targets —
address resolution through `asi/sdk`'s fingerprint gate (the body-relocation trap is solved there).

## The design

Hook the cutscene-object load path (the call site of `SetupCarPipeAtomicsForClump`, or
`CCutsceneMgr::CreateCutsceneObject`) for clumps whose model is a cutscene VEHICLE:

1. Walk the clump's atomics; classify TRANSLUCENT atomics by geometry material alphas (the same
   data our converter classifies — any material alpha < 255).
2. Install a custom `RpAtomic` render callback on those atomics: instead of rendering inline, insert
   the atomic into `CVisibilityPlugins`' sorted alpha list with its camera distance (the mechanism
   `RenderVehicleHiDetailAlphaCB` uses), preserving the entity's lighting context the way the
   vehicle path does. The list renders at frame end, depth-sorted — glass composites over every
   entity of the frame, actors included, both orders.
3. For the six force-piped models, skip/undo `CustomCarPipeAtomicSetup` on translucent atomics so
   their glass stops being dropped and enters the same deferred path (opaque atomics keep the pipe —
   it is the gameplay shine).
4. Opaque atomics and every non-vehicle cutscene object are untouched.

(A wheel-stash concealment payload was planned here and RETIRED before implementation: the fleet
scan found exactly ONE stash site in all 148 scenes — synd_4a's four washington wheel channels — and
plan 004 round 20 fixed it in DATA instead: the installer ships a surgically sunk `anim/cuts.img`
(`tools/vehicle-cutscene/src/stash-patch.ts`, sink z −0.6). This ASI stays alpha-only.)

Config knobs (SDK pattern): `enabled`, `verify-only` (log the would-be atomic census, patch
nothing), `verbose` (per-scene atomic decisions into the log).

## Steps

Every step ends with its verification; a step without recorded numbers is unfinished. The field
instrument is `docs/development/cutscene-field-testing.md` (~15 s per verdict; `scene =` in the
bottle's `CLEO/cutscene-override.ini`).

- [x] **0. Reproduce the bug without the converter hack (the baseline).** Temporarily empty
      `PANE_SUPPRESSED_SLOTS` in `tools/vehicle-cutscene/src/census.ts` (do not commit), rebuild the
      fleet, install into the bottle, run BOTH repro scenes — **RIOT_4B** (csgreenwood: both peds
      vanish behind the tint, reappear in the door gaps) and **SYND_3A** (cswashington: the field
      found it "reproduces the bug very well", 2026-08-14) — the recorded repro of the eraser on
      current code. Keep this build aside (`NO_COMMIT/cs-repro-panes`) as the standing repro
      artifact; restore the hack in the working tree afterwards. Verification: screenshot pairs
      (actors hidden / door-gap visible) for both scenes recorded in this plan.
      **DONE 2026-08-14 — the baseline stands, see "The step-0 baseline" below.**
- [ ] **1. Scaffold.** `asi/perfect-cutscene` consuming `asi/sdk` exactly like perfect-map (thin
      Makefile + `src/dllmain.cpp` + plugin descriptor); a no-op build that passes the fingerprint
      gate and writes `perfect-cutscene-asi.log` beside the exe. Verification: the log's first line
      in the bottle (`built <date> (verify-only)`), game boots, no adjuster conflicts (OLA + FLA +
      perfect-map coexistence — the SDK's byte-verify must stay green).
      **Build side DONE 2026-08-14** — written straight onto the SDK with zero framework changes:
      `gen/catalogue.ts` (2 entries / 5 sites, every byte window read out of the accepted exe and
      cross-checked against gta-reversed-modern), the five seam files, the thin Makefile. All three
      modes compile (`build:verify` / `build:asi` / `build:debug`); catalogue tests 5/5; the
      verify-only artifact (11 264 B) is installed in the bottle. **Open: the boot check** — the log
      must appear with all 5 sites pristine alongside OLA + FLA + perfect-map.
- [ ] **2. The census hook (verify-only).** Hook the cutscene model-load path; log, per scene, every
      cutscene VEHICLE clump and its translucent-atomic census (name, atomic count, alphas), patch
      nothing. Verification: RIOT_4B log lists csgreenwood with exactly the pane/lens census our
      offline tooling reports for the repro build; PROLOG1 lists the taxi; a non-vehicle scene
      object logs nothing.
- [ ] **3. The deferral.** Install the sorted-list render callback on translucent cutscene-vehicle
      atomics. Verification — the decisive gate, on the STEP-0 REPRO BUILD (hack still absent):
      RIOT_4B AND SYND_3A both show their actors through every window AND the tint over them;
      PROLOG1/PROLOG3/FINAL2B unchanged-good (their lucky order must not regress); the door-gap
      actor test from step 0 passes on both repro scenes.
- [ ] **4. The blessed six.** Skip the force-pipe on translucent atomics of the six named models so
      their glass renders (deferred) instead of dropping. Verification: FINAL2B — the bravura shows
      real window tint for the first time, passengers still visible; BCESA4W/BCESAR4 one-eye glance.
- [ ] **5. Retire the converter hack.** Empty `PANE_SUPPRESSED_SLOTS` for real; move
      `docs/hacks/cutscene-window-pane-suppression.md` to `docs/hacks/retired/` with the closing
      block naming this ASI + the commit; update `docs/contracts/vehicles.md` §3 (the pane-order row
      keeps render-order semantics; the suppression sentence moves to history); rebuild the fleet.
      Verification: suite green; RIOT_4B with the ASI + hackless fleet = tint + peds.
- [ ] **6. The fleet re-check (plan 004 addendum).** With the ASI active, EVERY vehicle scene gets a
      re-run — the ASI changes the render path of every translucent atomic on all 23 models, so all
      35 ledger rows re-open for a glass/shine/actor glance (the fast pass: ~15 s each, one sitting).
      Findings feed plan 004's ledger as new rounds. Verification: the re-swept ledger.
- [ ] **7. pmb packaging.** Ship the built `.asi` with the game output the way perfect-map is
      integrated into the pmb pipeline (same stage, same config surface), so a field build carries it
      without manual bottle installs. Update `docs/commands.md` + the pmb stage docs +
      `docs/gta-sa-original/reference-install.md` (the target now runs OLA + FLA + perfect-map +
      perfect-cutscene). Verification: a fresh pmb build's output tree contains the asi; boot log
      shows it loaded.

## The step-0 baseline (2026-08-14) — the standing repro

The build: `PANE_SUPPRESSED_SLOTS` emptied (working tree only, restored right after the build),
fleet rebuilt to **`NO_COMMIT/cs-repro-panes`** — 23 converted, 0 errors, cutscene.img 25.7 MB →
321.5 MB; `cutscene-fleet-verify`: 317 DFFs parsed, 317 skeletons, **0 failures, 0 duplicate
channels**. Installed into the bottle with the round-20 `anim/cuts.img` (the wheel-stash sink stays,
so panes are the only variable). This build is what step 3's gate is measured against.

Offline census, repro build vs the canonical suppressed build (`NO_COMMIT/cs-mods-plates`):

| model | suppressed build | repro build |
| --- | --- | --- |
| csgreenwood | 22 atomics, **0 pane**, 3 translucent | 30 atomics, **8 pane**, 11 translucent |
| cswashington | 46 atomics, **0 pane**, 5 translucent | 53 atomics, **7 pane**, 12 translucent |

Pane GEOMETRIES are 8 / 7 in both (suppression drops atomics and leaves the geometry entries —
`rig/emit.ts` `finalizeAtomics`), so the atomic count is the honest measure of "the panes are back".

Field verdicts (user, both on this build):

- **RIOT_4B (csgreenwood): REPRODUCES** — "both peds vanished behind the tint".
- **SYND_3A (cswashington): REPRODUCES** — actors gone, **and the tint renders**.

What SYND_3A's verdict settles (plan 004 round 18's open question): the washington's erasing glass IS
the window-PANE class — restoring the pane atomics restores both the tint and the eraser, so the
"the mod's glass rides the LENS class" hypothesis is dead. The remaining explanation for round 18's
contradiction (a build measuring 0 pane atomics that still erased in the field) is the running-game
install race — the swap lands on the NEXT launch. Not re-tested data-side by the user's call; the ASI
covers every class regardless, and step 3 gates on this same scene.

## Risks / open measurements

- **The deferred pass's render states:** alpha-test ref and lighting in the end-of-frame sorted pass
  differ from the inline path — measure on step 3 (the a102 tint must still render; if the deferred
  pass's ref discards it, mirror the vehicle path's ref handling).
- **Entity lighting context:** vehicle alpha atomics render under the vehicle's lighting setup; the
  deferred callback must carry the cutscene object's lighting the same way (step 3 verifies against
  scene look, not just visibility).
- **One accepted exe:** everything is fingerprint-gated; on any other exe the ASI must no-op loudly
  (SDK behaviour).
- **CLEO coexistence:** the override instrument itself runs under CLEO; step 1's boot check covers
  the stack.
