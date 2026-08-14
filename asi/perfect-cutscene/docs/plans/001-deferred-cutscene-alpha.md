# 001 — Deferred cutscene alpha (the glass-over-actors fix)

Give cutscene vehicle objects the same DEFERRED, distance-sorted render pass the engine already
gives gameplay vehicles, so a car's translucent atomics (window glass, tint) are drawn after every
scene actor instead of z-erasing whichever actor the sector scan happened to visit later. Closes the
mechanism behind plan 004 rounds 15–17 for good and retires
`docs/hacks/cutscene-window-pane-suppression.md`.

## The recovered mechanism (measured 2026-08-14 against the accepted exe + gta-reversed-modern)

- Scene actors (peds) are separate `CCutsceneObject`s; the renderer draws visible entities in
  world-sector scan order — a per-scene accident of positions and camera. Field-proven both ways:
  PROLOG1/PROLOG3/FINAL2B draw actors before the car (glass layers fine), RIOT_4B and SYND_3A draw
  them after (a rendered pane z-writes and erases the actors; they reappear in the door gaps).
- **Gameplay vehicles never render in that scan-order pass at all.** In
  `CRenderer::RenderEverythingBarRoads` (`0x553AA0`) the visible-entity loop hands every VEHICLE
  entity to `CVisibilityPlugins::InsertEntityIntoSortedList` (`0x734570`) and skips its inline
  render; the list is flushed later in the frame by `CRenderer::RenderFadingInEntities`
  (`0x5531E0` → `RenderFadingEntities` `0x733F10`), back-to-front. So a gameplay car is drawn AFTER
  every ped, building and object of the frame — the glass has nothing left to erase. A
  `CCutsceneObject` is an OBJECT, so it falls through to the inline
  `CRenderer::RenderOneNonRoad(entity)` call at **`0x553C52`** and takes its luck with the scan
  order. That is the whole bug.
- **The per-atomic alpha list is NOT a frame-level list** — the correction that killed this plan's
  first design: `RenderOneNonRoad` (`0x553260`) calls `InitAlphaAtomicList` BEFORE and
  `RenderAlphaAtomics` AFTER one entity's render, so `m_alphaList` is cleared and flushed inside a
  single vehicle's render. It is how a car layers its own glass over its own
  `RenderDriverAndPassengers` occupants — nothing more. Atomics inserted from a cutscene object
  would be flushed by no one (a cutscene rarely has a `CVehicle` on screen at all) and simply never
  draw. Deferring per ATOMIC therefore needs a private list AND a private flush point; deferring per
  ENTITY needs neither, because the engine already owns both.
- R*'s authored dodge: vanilla cutscene cars ship no rendering window glass (door glass absent, the
  rest in the sub-alpha-test band; the pass sets alpha-test ref 140 outdoors at `0x553AA0`, while
  the deferred path's `CVisibilityPlugins::RenderEntity` sets ref 100 — or 0 inside an interior
  area. Moving a car from one to the other MOVES ITS TRANSLUCENT THRESHOLD, which is the one thing
  step 3 has to measure in the field rather than argue about).
- Six models are already special-cased by name at load (`CCutsceneObject::SetupCarPipeAtomicsForClump`
  `0x5B1AB0`, names at `0x8D0F68` → `CCarFXRenderer::CustomCarPipeAtomicSetup` `0x5D5B20`): the
  vehicle env-map pipe, which DROPS translucent atomics outside a real CVehicle. Independent of draw
  order and still ours to fix (step 4).

Reference source: gta-reversed (`docs/links.md`) for the names and call graph; every address and
every structure offset below was then read out of the accepted exe itself. The accepted exe is the
same single HOODLUM binary perfect-map targets — address resolution through `asi/sdk`'s fingerprint
gate (the body-relocation trap is solved there).

## The design (the user's option B, 2026-08-14 — entity-level deferral)

Replace ONE call — the inline `call CRenderer::RenderOneNonRoad` at `0x553C52`, inside
`RenderEverythingBarRoads`' visible-entity loop — with a call to our own function:

```c
void __cdecl PcRenderOneNonRoad(CEntity* e) {
  if (IsDeferrableCutsceneObject(e) && InsertEntityIntoSortedList(e, DistanceFromCamera(e)))
    return;                    // deferred: the engine renders it after the pass, back-to-front
  RenderOneNonRoad(e);         // everything else: untouched
}
```

`IsDeferrableCutsceneObject` derives from the entity and its clump, never from a name or an id range
(offsets verified in the exe, not assumed):

| what | where | value |
| --- | --- | --- |
| entity type | `e+0x36 & 7` | `4` = object |
| object type | `e+0x13C` | `4` = `OBJECT_TYPE_CUTSCENE` (read from the `CCutsceneObject` ctor's own `movb $0x4,0x13c(%esi)`) |
| model index | `e+0x22` (int16) | → `CModelInfo::ms_modelInfoPtrs` at `0xA9B0C8` |
| ~~model type~~ | ~~vtable slot 4~~ | **falsified in the field, step 2 round 1: every cutscene object is type 5** — cars and actors share the CUTOBJ clump slots |
| not an actor | `GetAnimHierarchyFromSkinClump(clump)` `0x734A40` | `nullptr` — a skinned clump is an ACTOR and stays in the main pass; a car or prop is what we defer |

The distance is the loop's own: `|GetPosition(e) − CRenderer::ms_vecCameraPosition(0xB76870)|`, with
`GetPosition` inlined exactly as the loop inlines it (`m_matrix = e+0x14`; matrix ? `m+0x30` :
`e+0x4`). If the sorted list is full, `InsertEntityIntoSortedList` returns false and we fall back to
the inline render — i.e. today's behaviour, never a dropped car.

What this buys over the per-atomic design: one patched call instead of a render-callback graft, no
RW struct walking, no lighting-context replay, every translucent class fixed (lamp lenses included,
not just panes), and several cars in one scene sorted back-to-front instead of by scan luck.

What it costs: the whole car (opaque atomics too) moves later in the frame, and its alpha-test ref
changes as noted above. Both are field-measured in step 3.

(A wheel-stash concealment payload was planned here and RETIRED before implementation: the fleet
scan found exactly ONE stash site in all 148 scenes — synd_4a's four washington wheel channels — and
plan 004 round 20 fixed it in DATA instead: the installer ships a surgically sunk `anim/cuts.img`
(`tools/vehicle-cutscene/src/stash-patch.ts`, sink z −0.6). This ASI stays alpha-only.)

Config knobs (SDK pattern): `PC_CENSUS` (classify and log, patch nothing), `PC_DEFER_ALPHA` (the
fix), `PC_BLESSED_SIX` (step 4), `PC_CENSUS_LOG` (verbose per-object decisions).

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
- [x] **1. Scaffold.** `asi/perfect-cutscene` consuming `asi/sdk` exactly like perfect-map (thin
      Makefile + `src/dllmain.cpp` + plugin descriptor); a no-op build that passes the fingerprint
      gate and writes `perfect-cutscene-asi.log` beside the exe. Verification: the log's first line
      in the bottle (`built <date> (verify-only)`), game boots, no adjuster conflicts (OLA + FLA +
      perfect-map coexistence — the SDK's byte-verify must stay green).
      **Build side DONE 2026-08-14** — written straight onto the SDK with zero framework changes:
      `gen/catalogue.ts` (2 entries / 5 sites, every byte window read out of the accepted exe and
      cross-checked against gta-reversed-modern), the five seam files, the thin Makefile. All three
      modes compile (`build:verify` / `build:asi` / `build:debug`); catalogue tests 5/5; the
      verify-only artifact (11 264 B) is installed in the bottle. **Boot check PASSED 2026-08-14**
      (`perfect-cutscene-asi.log`, the user's launch): `loaded — built Aug 14 2026 15:25:11
      (verify-only)`, `fingerprint OK — GTA:SA 1.0 US`, FLA + OLA detected, **5 of 5 sites pristine —
      "catalogue byte-accurate, safe to apply"**, game boots normally. Nothing among the bottle's ~24
      other `.asi` plugins hooks the cutscene render path, so steps 2–4 own these sites outright.
- [x] **2. The classifier, verify-only.** Run `IsCutsceneVehicleObject`'s derivation where it is
      cheapest and safest to observe — the `SetupCarPipeAtomicsForClump` call site inside
      `SetModelIndex` (`0x553C52`'s sibling, `0x5B1B64`), which fires ONCE per cutscene object at
      scene load, not per frame. Log model index, the vtable-slot-4 model type and the verdict;
      patch no rendering. This is what proves the model-type read (a wrong vtable slot is a crash,
      so it gets its own step). Verification: RIOT_4B logs the car as deferrable and its actors as
      skipped; the game still boots.
      **Round 1 (2026-08-14) — the census earned the step immediately.** The hook works and the
      vtable read works, but every cutscene object came back **model type 5 (`MODEL_INFO_CLUMP`)**,
      cars included (ids 300–303 + 1, twice over two scene loads). Cutscene models are streamed into
      the shared CUTOBJ clump slots, so `GetModelType()` can never separate a cutscene CAR from a
      cutscene ACTOR — the "model is a vehicle" test the design table carried was wrong on the real
      game. **The split that does exist is the engine's own**: `CCutsceneMgr` tells an actor from a
      prop with `GetAnimHierarchyFromSkinClump(clump)` (`0x734A40`, non-null only for a SKINNED
      clump — its particle-attachment code branches on exactly that). So the classifier inverts:
      defer every cutscene object that is NOT skinned (cars and props), leave the skinned actors in
      the main pass — which is what the fix needs anyway, since it is the actors that must be drawn
      first. Round 2 logs `model / name-key / skinned` to confirm the inversion in the field.
      **Round 2 PASSED (2026-08-14)** — RIOT_4B, two scene loads (the game's own intro plays before the
      override warps, so a prolog scene is logged first). Every object classified, and the name keys
      decode by `scripts/debug/sa-name-key.ts`: `csplay` (−249921641) **skinned 1**, `cstaxi92`
      (1793024146) **skinned 0**, `csgreenwood` (−1591174577) **skinned 0**, and the three remaining
      actors skinned 1. Exactly one non-skinned object per load, and it is the CAR both times —
      the classifier is confirmed by name, not by inference. Note the CUTOBJ slots are reused
      between scenes (id 301 carried a different key in each load), which is why the census logs the
      key and never the slot.
- [x] **3. The deferral.** Patch the `0x553C52` call to route through `PcRenderOneNonRoad`, which
      defers a classified cutscene vehicle into `InsertEntityIntoSortedList`. Verification — the
      decisive gate, on the STEP-0 REPRO BUILD (hack still absent): RIOT_4B AND SYND_3A both show
      their actors through every window AND the tint over them; PROLOG1/PROLOG3/FINAL2B
      unchanged-good (their lucky order must not regress); the door-gap actor test from step 0
      passes on both repro scenes. **Measure the ref-140 → ref-100 move explicitly**: if a mod's
      tint appears/disappears versus the step-0 screenshots, that is the alpha-test threshold, not
      the ordering — record which, and mirror the pass's ref in the deferred path if needed.
      **PASSED on both repro scenes (2026-08-14, the user):** RIOT_4B and SYND_3A — "everything is
      fine, the peds are visible", and on the follow-up look "lamps, headlights, tint — all there".
      So the actors survive AND the glass still renders over them: the two halves the whole ASI
      exists for, on the two scenes that failed hardest. The log confirms the patch took
      (`defer APPLIED`) and the census names the deferred object each time — `csgreenwood`
      (−1591174577) on RIOT_4B, `cswashington` (1484834498) on SYND_3A, both `skinned 0`.
      **PROLOG1 and FINAL2B unchanged-good.** **PROLOG3 changed, and the ref-140 → ref-100 risk is
      exactly what did it** — round 2 below.
- [x] **3b. The alpha-test ref, put back (round 2, 2026-08-14).**
      **Seen (user):** PROLOG3 — the cop car's windscreen "looks matte, you can't see through it";
      every other window on the same car fine. His read was "as if it applied twice".
      **First root cause — WRONG, and the user's own experiment killed it.** The story below was
      consistent with every offline measurement and still false: he removed the `.asi` entirely and
      the windscreen stayed matte, which no explanation involving our render path survives. Kept
      here because the reasoning it contains is still true about the THRESHOLD, just not about this
      symptom. Mod cutscene glass sits at **alpha 102–125** (csgreenwood 102,
      cswashington 110, cscopcarla92 and cstaxi92 115, csbravura 125) — *between* the outdoor pass's
      ref **140** and the deferred path's ref **100**. `RenderEverythingBarRoads` sets 140 only when
      `CGame::currArea == 0`, and of the five scenes gated here PROLOG3 is the one with a decoded
      OUTDOOR area (PROLOG1 is area 14): so PROLOG3's windscreen had always been discarded by the
      alpha test, and the deferral rendered it for the first time — at its authored 45 % opacity,
      which reads as matte. The "twice" reading was checked and is NOT what happened: the mixed-mesh
      split is clean (opaque copy 248 tris with 0 glass triangles, translucent twin 80 glass tris),
      and the anim-replay world boxes show one pane per window.
      **The threshold patch stands anyway, on its own reasoning** (the user's call): repoint the SECOND call site,
      `CVisibilityPlugins::RenderEntity`'s own `call RenderOneNonRoad` (`0x732C48`), so one of our
      deferred cutscene objects in an outdoor area is rendered at ref 140 and the ref is put back to
      what RenderEntity chose (100, or 0 for a `bDontWriteZBuffer` model) straight after. The plugin
      now changes draw ORDER and nothing else.
      **Open option, deliberately NOT taken:** running the deferred pass at ref 100 would show the
      mod's authored glass in outdoor scenes too, and make a car look the same indoors and out.
      That is a LOOK decision with a full re-sweep attached, and the first field verdict on it was
      negative — it stays a separate question, not a side effect of an ordering fix.
      - [x] **Re-check (user):** no change — and then the decisive one: **with the ASI removed
        altogether the windscreen is still matte**. The threshold was never the cause; the patch is
        parity only, and its own effect has never been observed in the field. Say so when it is
        judged.

- [x] **3c. What the matte windscreen actually is (round 3, 2026-08-14) — a data bisect, no game.**
      **The data is innocent, proven across the whole session.** The windscreen glass material reads
      `102,102,102,115` in EVERY kept build from `cs-mods-step8` (08-13 10:29) to today; the only
      movement in its history is the round-4 alpha clamp (102) that round 7 retired. The MOD's own
      source DFF carries the same `102,102,102,115` — the conversion alters nothing. The built model
      carries no opaque surface over the glass (the only opaque part of that mesh is a 27 cm mirror
      housing), the source's one opaque `glass` band (270 tris, full width — a `_vlo`) is NOT in our
      model, the `glass` texture is present, and there are no prelit vertex colours anywhere.
      **The field pattern is the answer.** The user's screenshots: windscreen AND rear screen matte,
      vertical side windows clean — all of them the SAME material, so no data difference can explain
      it. What separates them is RAKE, and rake matters to exactly one thing: a reflection.
      **Mechanism:** `cscopcarla92` is one of the six models `SetupCarPipeAtomicsForClump` (`0x5B1AB0`)
      force-pipes at load — its body writes `[atomic+0x6C] = [0xC02D24]` and stamps pipeline
      `0x53F2009A` on EVERY atomic of the clump, glass included. SA's vehicle env map is a static
      texture: on a raked pane it covers the whole surface as flat grey; on a vertical one it barely
      shows. Ours is the only fleet where this is visible at all, because vanilla cutscene glass
      never renders. It is independent of the ASI — the stamp happens at model load — which is
      exactly why removing the plugin changed nothing.
      **This makes step 4 both the fix and the experiment**, and simpler than planned: our DFFs
      already carry the correct per-atomic pipeline (opaque = vehicle, translucent = default, plan
      004 rounds 5–9). The engine overrides it only because VANILLA cutscene DFFs carry no stamp at
      all. Not letting it override needs no atomic walk — just not calling the original for a
      non-skinned cutscene clump.
- [ ] **4. The blessed six.** Do not let `SetupCarPipeAtomicsForClump` overwrite our per-atomic
      pipelines: for a non-skinned cutscene clump the stand-in returns without running the original,
      so those six models keep exactly the pipeline split the converter authored (round 3 above).
      The `ms_sCutsceneVehNames` table is byte-verified but never written — if the six ever differ
      from the catalogue, the assumption this rests on has changed and the patch defers.
      Verification: **PROLOG3 — the sheriff car's windscreen and rear screen become real tinted
      glass** (the round-3 gate); FINAL2B — the bravura shows window tint for the first time,
      passengers still visible; BCESA4W/BCESAR4 one-eye glance.
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

- **The deferred pass's alpha-test ref** — the one real unknown. The inline pass runs at ref 140
  outdoors; `CVisibilityPlugins::RenderEntity` sets ref 100, or 0 when `CGame::currArea` is an
  interior. A mod tint at alpha 102 therefore renders in the deferred path and would NOT survive
  ref 140, so this move can only add glass, never remove it — but it also means a scene whose glass
  currently renders only because it plays in an interior area may look different. Measured in step 3
  against the step-0 screenshots.
- **Lighting is NOT a risk in option B** (it was the killer risk of the per-atomic design): the
  deferred path calls `RenderEntity` → `RenderOneNonRoad`, which runs the entity's own
  `SetupLighting`/`RemoveLighting` exactly as the inline path does. Same function, later moment.
- **Ordering of the opaque half:** the whole car moves after the pass, so it also draws after any
  translucent thing an earlier entity rendered. Cutscene sets are sparse; watched in the step-6
  re-sweep rather than argued here.
- **List capacity:** `InsertEntityIntoSortedList` returns false when the sorted list is full; we
  then render inline (today's behaviour). No car is ever dropped.
- **One accepted exe:** everything is fingerprint-gated; on any other exe the ASI must no-op loudly
  (SDK behaviour).
- **CLEO coexistence:** the override instrument itself runs under CLEO; step 1's boot check covers
  the stack.
