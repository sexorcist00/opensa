# 004 — full scene field review: every vehicle cutscene checked, then the approval

**Status: PLANNED 2026-08-13 (the user's call: check ALL cutscenes and sign off).** Plans 002/003
field-verified the conversion on FOUR scenes (intro ×2 gates, STRP4B2, PROLOG3). This plan sweeps
every vehicle cutscene in the game — all **35 scenes** the ANPK census found cs vehicles in — through
the cutscene-override instrument (cleo/scripts plan 003: one ini edit per scene, ~15 s to the verdict,
no story progression), records a per-scene verdict, fixes what the field finds, and ends with the
user's blanket APPROVAL of the cutscene fleet.

**Build under review:** the bottle's `NO_COMMIT/cs-mods-plates/` (full 23-model fleet + baked plates,
self-contained TXDs). A fix round re-runs the tool and re-drops `cutscene.img` (+ `txdcut.ide` when it
changes); every fix is one variable per round, per the standing field workflow.

## Coverage facts (measured)

- 35 scenes drive cs vehicles; **21 of 23 models appear** in at least one. The two that appear in
  NONE: `csdinghy` (002 step 9's named gap) and `cscopcarla` — but `cscopcarla` shares its donor and
  its conversion path with `cscopcarla92` byte-for-byte, so it is covered INDIRECTLY by every
  cscopcarla92 scene; only its slot NAME goes unexercised.
- The heaviest models: `csremington92` (4 scenes), `csglendale92` (4), `cscopcarla92` (6),
  `cszr350/b` (4). One scene (`STRP4B2`) and one model (`csmtbike92`) are already field-passed —
  re-checked here only if a later fix touches the shared emit.

## Step 1 — the sweep (user, batched; the ledger IS the record)

Arm each scene (`scene = <name>` in the bottle ini), run, verdict into the table. LOOK-FOR per run:
every listed vehicle present and mod-shaped; standing on its wheels both sides; doors/parts riding
their anims where the scene moves them; gameplay paint (no green/pink markers); plates readable on
plated cars; nothing floating, sunk, detached or stacked (variant containers).

Suggested order: the first column covers every model at least once by scene 13 — a defect that is
per-MODEL shows early; the rest of the sweep then guards the per-SCENE surprises (odd camera angles,
scene-specific anims).

| # | Scene | cs vehicles | Verdict |
| --- | --- | --- | --- |
| 1 | PROLOG1 | cstaxi92 | ✅ (gate 4/7 + 003) · **ASI re-sweep 2026-08-15 ✅** ("excellent") — the interior-area scene reads the deferred glass the same as the outdoor ones |
| 2 | PROLOG3 | cscopcarla92, cstaxi92 | ✅ re-verified after round 21 (the matte windscreen was a missing modulate flag; "looks perfect") |
| 3 | STRP4B2 | csmtbike92 | ✅ (002 step 8) · **ASI re-sweep 2026-08-15 ✅** ("excellent") — the game's only bike scene |
| 4 | DESERT9 | csbobcat92 | ✅ after rounds 1–2 ("glass with the door, one rack") · **ASI re-sweep 2026-08-15 ✅** ("excellent") |
| 5 | BCESA4W | csbravura, cszr350b | ✅ (2026-08-13, "good") · **ASI re-sweep 2026-08-15 ✅** ("excellent") |
| 6 | BCESAR4 | cssavanna, cszr350 | ✅ after round 3 ("lights are normal now") · **ASI re-sweep 2026-08-15 ✅** ("excellent") |
| 7 | BCESAR5 | cssadler, cszr350, cszr350b | ✅ after rounds 4–8 ("glass renders normally now, tint and sheen in place") · **ASI re-sweep 2026-08-15 ✅** ("excellent") — the scene that drove rounds 4–8 needs none of them now |
| 8 | DES_10B | csmothership | ✅ (2026-08-13) · **ASI re-sweep 2026-08-15 ✅** ("excellent") |
| 9 | DESERT1 | csmonster | ✅ (2026-08-13) · **ASI re-sweep 2026-08-15 ✅** ("excellent") |
| 10 | FARL_3B | csburrito92 | ✅ after rounds 9–12 ("all fixed") · **ASI re-sweep 2026-08-15 ✅** ("excellent") |
| 11 | FINAL2B | csbravura, cssabre92 | ✅ after rounds 13–14 ("all good") · **ASI re-sweep 2026-08-15 ✅** ("excellent") |
| 12 | GARAG3A | csremington92 | ✅ (2026-08-14, "good") · **ASI re-sweep 2026-08-15 ✅** ("excellent") |
| 13 | HEIST8A | cssecurica92 | ✅ after round 15 ("good") · **ASI re-sweep 2026-08-15 ✅** ("excellent") — the round-15 rotation fix holds |
| 14 | RIOT_4B | csgreenwood | ✅ re-verified 2026-08-14 with the ASI + hackless fleet ("perfect — peds visible, tint as it should be"); the round-17 unglazed compromise is retired |
| 15 | RIOT4E1 | cscopcarsf, csfirela | ✅ (2026-08-14, "fire truck and cop car excellent"; run on the rounds-13–14 build — the r15/16 delta gets the one-eye glance) · **ASI re-sweep 2026-08-15 ✅** ("excellent") — which also settles the r15/16 delta this row was carrying |
| 16 | SMOKE1B | csglendale92 | ✅ after round 16 ("better — specular improved, wheels in place, glass there, one colour") · **ASI re-sweep 2026-08-15 ✅** ("excellent") |
| 17 | SWEET2B | csgreenwood, csvoodoo | ✅ (2026-08-14, "good") · **ASI re-sweep 2026-08-15 ✅** ("excellent") |
| 18 | SYND_3A | cswashington | ✅ (2026-08-14, "all excellent") — closed by the ASI's deferral on the hackless fleet: actors visible AND the washington keeps its tint |
| 19 | SYND_4A | cssavanna, cswashington | ✅ after rounds 19–20 ("wheels gone — excellent, no bugs"; the shipped `anim/cuts.img` stash sink) · **ASI re-sweep 2026-08-15 ✅** ("excellent") — the round-20 stash sink re-confirmed |
| 20 | BCESA5W | cszr350, cszr350b | ✅ **first run in the ASI re-sweep, 2026-08-15** ("excellent") |
| 21 | BCRAS1 | cscopcarla92 | ✅ **first run in the ASI re-sweep, 2026-08-15** ("excellent") |
| 22 | BCRAS2 | cscopcarla92 | ✅ **first run in the ASI re-sweep, 2026-08-15** ("excellent") |
| 23 | CESAR1A | cssavanna | ✅ **first run in the ASI re-sweep, 2026-08-15** ("excellent") |
| 24 | CRASH3A | cscopcarla92 | ✅ **first run in the ASI re-sweep, 2026-08-15** ("excellent") |
| 25 | CRASV2A | cscopcarla92 | ✅ **first run in the ASI re-sweep, 2026-08-15** ("excellent") |
| 26 | CRASV2B | cscopcarla92 | ✅ **first run in the ASI re-sweep, 2026-08-15** ("excellent") |
| 27 | RIOT4E2 | csfirela | ✅ **first run in the ASI re-sweep, 2026-08-15** ("excellent") |
| 28 | SCRASH2 | csbravura | ✅ **first run in the ASI re-sweep, 2026-08-15** ("excellent") |
| 29 | SMOKE2B | csglendale92 | ⚠️ **first run in the ASI re-sweep, 2026-08-15**: occupants not visible behind the glass. Round 22 — the render side measures clean; the stock cutscene glendale has no glass at all and the mod's is the fleet's darkest pane. Awaiting the gameplay control |
| 30 | SMOKE3A | csglendale92 |⏳ DEFERRED to the post-ASI final sweep (user's call 2026-08-14: every model already shown at least once; the ASI re-opens all rows anyway) |
| 31 | SMOKE4A | csglendale92 |⏳ DEFERRED to the post-ASI final sweep (user's call 2026-08-14: every model already shown at least once; the ASI re-opens all rows anyway) |
| 32 | STEAL_2 | csremington92 |⏳ DEFERRED to the post-ASI final sweep (user's call 2026-08-14: every model already shown at least once; the ASI re-opens all rows anyway) |
| 33 | STEAL_4 | csremington92 |⏳ DEFERRED to the post-ASI final sweep (user's call 2026-08-14: every model already shown at least once; the ASI re-opens all rows anyway) |
| 34 | STEAL_5 | csremington92 |⏳ DEFERRED to the post-ASI final sweep (user's call 2026-08-14: every model already shown at least once; the ASI re-opens all rows anyway) |
| 35 | TRUTH_2 | csmothership |⏳ DEFERRED to the post-ASI final sweep (user's call 2026-08-14: every model already shown at least once; the ASI re-opens all rows anyway) |

## Step 2 — fix rounds (as found)

- [ ] Each field finding gets its own round record here (one variable per round): what was seen, the
      root cause, the fix, the re-check verdict. A finding that changes the SHARED emit re-opens the
      already-✅ scenes of the affected branch for one re-check.
- [ ] Anything that becomes a permanent rule lands where its family lives in the same change
      (contracts / edge-cases / the plan-002 emit header).

### Round 1 — DESERT9: door glass floating midair (2026-08-13, screenshot on record)

- **Seen:** csbobcat92's driver door swings open in the scene; a glass pane hovers in the air beside
  the cab, detached from the door.
- **Root cause:** the GMC Sierra mod ships its door as TWO meshes with the SAME name — `door_lf_ok`
  (panel) with a second `door_lf_ok` (glass) nested under it. The panel became the template bone;
  the glass was adopted under that bone at ~identity — correct placement. But **anim binding is NOT
  first-match-only**: the duplicate of the vanilla name also bound the door channel and was driven
  to the vanilla DOOR local under its own parent (the already-animated door bone) — a double
  transform. This falsifies step 10's "bind-safe: template bone comes first" claim; gate 7 never
  caught it because none of its scenes animated a duplicated frame — DESERT9 is the first that does.
  The same defect was latent on csfirela's adopted `wheel_rf/lb/rb` duplicates (RIOT4E1/2 would
  have shown spinning-wheel ghosts) and the other 18 fleet duplicates.
- **Fix (one variable):** an adopted frame whose name collides with a PRE-ADOPTION emitted frame
  (the template bones = the channel-name set) is renamed with `_ad` (`adoptedFrameName` in
  `rig/emit.ts`, shared by all three branches) — a renamed frame binds nothing and simply rides its
  parent. Duplicates among adopted frames stay verbatim (nothing binds them — the MTB's two
  `wheel_pj=0-2c` wheels keep their names). `cutscene-fleet-verify.ts` now FAILS on duplicate
  channel names; the rebuilt fleet measures **0** (was 20). Suite 79/79.
- [x] **Re-check (user):** PASSED with round 2's fix (2026-08-13) — the glass swings with the door.

### Round 2 — DESERT9: whole bed rack swung 50° through the air; stacked racks (2026-08-13, screenshot)

- **Seen (same scene, second run):** a plank-like piece floating midair by the left truck's bed —
  "something wrong with the bed they load the boxes into".
- **Root causes (two, both measured offline by decoding the scene's ANPK poses — KRT0 = 8×f32:
  quat, trans, time):**
  1. **The scene poses `extra1` with a 50° z-rotation.** Vanilla csbobcat92's extras are SMALL
     hand-authored SCENE FURNITURE (a 0.7 m crate, a 0.6 m prop) the choreography poses; the GMC
     mod's `extra1..extra5` are five WHOLE-BED RACK variants (2×4 m each). Template-matching mod
     extras to vanilla extras posed an entire rack 50° through the air — and adopting the rest
     stacked five racks on the bed.
  2. **The scene drives `windscreen_ok` — a frame the vanilla model does not even have** (R*
     authored the anims against a richer rig; the channel is unbound in vanilla). The mod's adopted
     windscreen carried that exact name and caught the channel — round 1's collision-only rename
     could never see it: the channel-name universe is per-scene and unknowable at convert time.
- **Fixes (policy, derived — never per-asset):**
  1. `extra1..extraN` are SA's mutually-exclusive spawn variants (contracts §3): NEVER
     template-matched (the '92 furniture bones drop out as holes — unbound channels are the
     field-proven zr350 case), and adopted ONE per model (first in atomic order), like the
     `f_extras` containers.
  2. **EVERY adopted frame is renamed with `_ad`** — an adopted mesh is un-animated by definition,
     so its name must be unbindable; round 1's reserved-set rename is superseded.
- Fleet rebuilt: 23/23, 0 errors, 0 duplicate channel names; suite 154/154 (tool + pmb). Paint
  materials 400 → 395 (the dropped surplus extras carried five markers); cutscene.img 311.1 →
  307.3 MB (four surplus GMC racks alone).
- [x] **Re-check (user):** PASSED (2026-08-13): "now everything's ok — the glass with the door, one
      rack." DESERT9 ✅ in the ledger; the sweep resumes at row 5 (BCESA4W).

### Round 3 — BCESAR4 + the intro cop scene: green/amber headlight lenses (2026-08-13, screenshot)

- **Seen:** cssavanna's headlights render one pair green-teal, the other amber (BCESAR4); the same on
  the cop car in the intro. These are SA's per-lamp ID marker colours — `(255,175,0)`/`(0,255,200)`
  head, `(185,255,0)`/`(255,60,0)` tail (the plan-074 vehicle-builder palette, `build-vehicle-model.ts`
  `LAMP_MARKERS`) — metadata saying WHICH lamp a material is, never meant to reach a pixel.
- **Root cause:** the tool's paint bake (002 step 5) left lamp markers untouched on the claim "vanilla
  cs models keep those too". Measured against the vanilla `cutscene.img`, that claim is BACKWARDS: the
  vanilla fleet bakes its lamp materials to WHITE with the authored alpha kept (204/128/250 alphas
  survive); only csbobcat92/cslegend566/cssabre92 kept raw markers — R* slips, not a rule. The gameplay
  renderer substitutes lamp material colours every frame, so markers are invisible on spawned cars; the
  cutscene renderer substitutes nothing, so on our converted models every marker rendered raw. Latent
  fleet-wide: 137 lamp materials across the 23 models.
- **Fix (one variable):** `materials.ts` bakes the four lamp marker colours to `(255,255,255)`, alpha
  preserved — same in-place Struct rewrite as the paint bake, no size change. The old test pinned the
  wrong behaviour ("leaves lamp markers alone") — flipped to assert no marker survives. Baked
  materials 395 → 532; fleet rebuilt 23/23, verify green (317 DFFs, 0 duplicate channels); bottle
  updated (build rotated: `cs-mods-plates-prelamps` holds the old one). Contract recorded in
  contracts/vehicles.md §3 + §4.
- **Re-check scope:** a fleet-wide material fix — BCESAR4 re-run decides the row; the four ✅ scenes
  need one lamp glance next time they naturally play (PROLOG1/PROLOG3 cop car and taxi carried the
  same markers).
- [x] **Re-check (user):** PASSED (2026-08-13): "BCESAR4 is ok now, lights are normal." BCESAR4 ✅ in
      the ledger.

### Round 4 — BCESAR5: stacked windows opaque on the zr350 (+ sadler) (2026-08-13, two screenshots)

- **Seen:** "glass looks strange — as if through 2 panes there's no transparency"; the same on the
  sadler; single panes look fine. The zr350's cabin reads as a bright opaque wall from angles that
  cross two or three panes.
- **Root cause (measured):** the cutscene path draws a clump's translucent panes unsorted, so stacked
  windows COMPOUND. R* tuned each cs model's window alpha to its scenes' stacking depth — the vanilla
  cszr350's big panes are `255,255,255,26` (the camera crosses 2–3 panes in exactly these BCESAR
  scenes), boxy cars sit at 77–128; the vanilla fleet's window band never exceeds 128 while lenses run
  204–250. Mod glass ships its GAMEPLAY tint (`51,51,51,125` on the zr350; fleet 101–193, dark RGB) —
  fine in the sorted vehicle pipeline, an opaque wall two panes deep in the cutscene path. The mod's
  `glass` texture itself is a flat opaque grey (8×8, avg 102/102/102/255) — all transparency lives in
  the material alpha.
- **Fix (one variable, derived per slot — never per car):** `clampWindowGlass` in `materials.ts`: a
  WINDOW pane (classified by data — translucent below alpha 200, off the `vehiclelights*` atlas,
  dark-tinted OR alpha ≤ 128) is clamped to `vanillaGlassFloor` — the vanilla twin's most transparent
  window pane, its authored answer to this model's stacking; slots whose twin has no glass modelled
  (sadler, bravura, glendale) fall back to the fleet median 102. Lenses/decals untouched. Fleet: 91
  panes clamped on 16 models (zr350/zr350b→26, copcarsf→76, bobcat/securica/washington→77,
  firela→94, monster/sabre/voodoo→128, the rest→102; savanna/greenwood/mothership/remington/burrito
  already at or below their floors). Rebuilt 23/23, verify green (317 DFFs, 0 duplicate channels);
  suite 85/85; bottle updated (`cs-mods-plates-preglass` holds the previous build).
- **Re-check scope:** fleet-wide material fix — BCESAR5 re-run decides; earlier ✅ scenes get a glass
  glance next time they naturally play.
- [x] **Re-check (user):** FAILED (2026-08-13) — still no see-through on the zr350, "the windscreen
      seems absent entirely". The alpha clamp was not the mechanism (kept anyway — it is vanilla's
      authored value); the real cause is round 5's render order.

### Round 5 — BCESAR5: windscreen z-erases the car behind it (2026-08-13, screenshot)

- **Seen (round-4 re-check):** through the windscreen you see SKY, not the interior — the pane reads as
  "absent" (alpha 26) while everything behind it is missing.
- **Root cause (measured):** the cutscene path renders clump atomics in FILE ORDER with z-write on. Our
  emit placed the template windscreen at atomic 9 of 35 with the whole adopted interior AFTER it
  (atomics 10–34) — the pane drew first, wrote depth, and everything behind it z-failed, leaving the
  pre-drawn sky. Vanilla's own layout IS the contract: `windscreen_ok` is the LAST atomic of every
  vanilla car (chassis with interior mid-file) — that is how R* made unsorted panes composite.
- **Fix (one variable):** `finalizeAtomics` in `rig/emit.ts` (all three branches): stable partition —
  atomics whose geometry carries a window-pane material (the round-4 classifier) move to the tail,
  relative order preserved. The emitted zr350 now ends `…windscreen_ok, Object016_ad, glass_ok_ad,
  glass_lf_ok_ad, glass_rf_ok_ad`.
- [ ] **Re-check (user):** BCESAR5 re-run.

### Round 6 — fleet: converted cars shine differently than the same mod in gameplay (2026-08-13)

- **Seen (user):** "converted cars have a different gloss level than the same cars in gameplay —
  probably we apply specular settings during conversion; keep the custom's defaults."
- **Root cause (measured):** the converter applies NOTHING — geometry bodies and atomic extensions are
  carried verbatim. The delta is a plugin the mod never needed: EVERY vanilla cs atomic carries the SA
  Pipeline Set plugin (`0x253f2f3` = `0x53F2009A`, the custom vehicle pipeline). A gameplay DFF gets
  that pipeline assigned by the engine via its model-info type, so mods do not ship the plugin — and a
  cutscene object without it renders on the DEFAULT pipeline, where the mod's Reflection/Specular
  material plugins go unread: hence the different shine. The user's instinct was exactly right — in
  gameplay the custom gets the vehicle pipeline; the cutscene copy must too.
- **Fix (one variable):** `finalizeAtomics` also stamps PipelineSet `0x53F2009A` into every emitted
  atomic's Extension when missing, mirroring the vanilla fleet.
- Both rounds shipped in one rebuild (independent subsystems: render order vs pipeline; verdicts
  attribute separately: transparency → round 5, shine vs gameplay → round 6). Suite 86/86; verify
  green (317 DFFs, 0 duplicate channels); bottle updated (`cs-mods-plates-prepipe` holds the round-4
  build).
- [x] **Re-check (user):** SPLIT (2026-08-13). Round 6 PASSED — "chrome is excellent". Round 5's
      mechanism confirmed (the car behind the pane renders again) but the glass now shows NOTHING:
      no tint, no sheen — the same mod in gameplay wears a light tint and a glass gloss. The round-4
      alpha clamp (26 on the zr350) was the wrong-mechanism fix and now overshoots → round 7.

### Round 7 — BCESAR5: glass invisible — the round-4 alpha clamp retired (2026-08-13, two screenshots)

- **Seen:** cutscene zr350 glass renders as nothing at all; the same mod in gameplay shows a light
  tint + glass sheen (user's side-by-side screenshots).
- **Root cause:** round 4 diagnosed the stacked-window opacity as authored-alpha compounding and
  clamped mod panes to the vanilla twin's floor (zr350 → 26, ~10 %). The TRUE mechanism was round 5's
  render order — the pane z-erasing the car behind it. With panes drawn last they composite exactly as
  the sorted gameplay pipeline composites them, so the mod's own gameplay alpha (125) is the correct
  cutscene value too — and at 26 the pane contributes nothing (no tint, and the round-6 pipeline's
  spec/env on the pane is scaled away with it).
- **Fix (one variable):** the window-glass alpha clamp is REMOVED (`clampWindowGlass` /
  `vanillaGlassFloor` deleted; the window-pane CLASSIFIER stays — it drives round 5's atomic
  ordering). Converted glass keeps the mod's authored gameplay alpha, contracts §3 row rewritten.
  Suite 80/80; verify green; bottle updated (`cs-mods-plates-pretint` holds the round-5/6 build).
- [x] **Re-check (user):** FAILED (2026-08-13, screenshot) — glass still renders as NOTHING at the
      mod's own alpha 125, where a dark tint is unmissable. The alpha was never the lever: the panes
      stopped RENDERING → round 8.

### Round 8 — BCESAR5: the vehicle pipeline drops translucent panes — panes stay on the default pipe (2026-08-13)

- **Field bisect across builds (the decisive evidence):** rounds 1–4 builds (no PipelineSet) — glass
  RENDERS (up to an opaque wall); rounds 5–7 builds (PipelineSet on every atomic) — glass GONE, at
  alpha 26 and at alpha 125 alike, while opaque chrome/body improved. The variable is the pipeline,
  not the alpha. Mechanism: the SA vehicle pipe (`0x53F2009A`) does not composite translucent
  materials outside a real CVehicle's render path; modding practice applies it to OPAQUE
  reflective parts only (upgrade parts). Vanilla ships the plugin on its windscreens too — but
  vanilla glass is a 26-alpha whisper whose absence nobody would ever see; the GTAMods Pipeline Set
  page documents `0x53F2009A` as the vehicles/upgrade-parts/cutscene-objects pipeline with no glass
  variant.
- **Fix (one variable):** `finalizeAtomics` stamps PipelineSet only on NON-pane atomics; window-pane
  atomics keep the mod's default (no plugin → default pipeline, which blends translucents and still
  renders the mod's MatFX env sheen). The round-5 pane-last ordering stays. Suite 80/80; verify
  green; bottle updated (`cs-mods-plates-prepanepipe` holds the round-7 build).
- [x] **Re-check (user):** PASSED (2026-08-13): "glass renders normally now, tint and sheen in
      place." BCESAR5 ✅ in the ledger.
- **Re-open note:** rounds 5–8 changed the shared emit fleet-wide (pane ordering + per-atomic
  pipeline). The six earlier ✅ scenes stay checked, but each gets a one-eye glass/shine glance the
  next time it naturally plays; anything off re-opens its row.

### Rounds 9–11 — FARL_3B: four burrito findings, three mechanisms (2026-08-13, four screenshots)

**Seen:** (1) tyres see-through (hollow centres); (2) tail lights missing; (3) a rear door swings
open and its window stays hanging at the closed position; (4) one rear-door window absent entirely.
All four decomposed against the GMC Vandura mod's own structure — the first VehFuncs-style mod in
the sweep (nested `<name>:K` selector groups, a three-mesh wheel sub-model).

- **Round 9 — pipeline (fixes 2):** the tail/fog lenses ride translucent materials at alpha 210–254 —
  ABOVE the round-8 window band — so they kept the vehicle PipelineSet and vanished by the round-8
  mechanism. Generalized: an atomic carrying ANY translucent material stays on the DEFAULT pipeline;
  only fully-opaque atomics get the vehicle pipe (`finalizeAtomics`, all branches).
- **Round 10 — adoption ancestry (fixes 3):** the rear-door windows hang under `door_*_dummy` beside
  the `_ok` mesh (the game keys components by DUMMY), and `nearestCarriedAncestor` resolved them to
  the CHASSIS — the pane stood still while the door swung. A matched part's dummy now maps to the
  part's bone in `carriedFrames`; `wind_rr_ok_ad`/`wind_lr_ok_ad` emit under their door bones.
- **Round 11 — selector containers (fixes 4 and 1):** the mod's `f_extras:4` holds FOUR groups
  (logo/spare/window/add) and the field-frozen one-mesh-per-container rule took the logo, starving
  the window. Replaced with the VehFuncs-style chosen path (`chosenVariantFrames`): `<name>:K` shows
  K children, at every level the FIRST eligible child in atomic order wins (`_dam`/`_vlo`/year-variant
  children never count) — a leading meshless `no*` child is the author's "off" default (fogs stay
  off, the front `guard_ok` and rear-door `spare_ok` come on: their groups have no "none" option).
  The same walk applied inside `f_wheel` yields the WHOLE wheel — tire + cap + cap-style, three
  meshes per corner (one was a hollow tyre ring = finding 1); the taxi's `wheel[1992]` style names
  need `skipYearVariants: false` there (year brackets inside f_wheel are wheel styles, and the fleet
  build caught the miss loudly). Wheel radius = max z-half-extent across the set.
- Fleet 23/23, verify green (317 DFFs, 0 duplicate channels); suite 80/80; bottle updated
  (`cs-mods-plates-prevan` holds the rounds-5–9 build). Contracts §3 rows updated (pipeline,
  selector containers, dummy ancestry).
- **Re-check scope:** rounds 9–11 change the shared emit fleet-wide — earlier ✅ scenes keep their
  one-eye glance rule; FARL_3B re-run decides all four findings.
- [x] **Re-check (user):** 3 of 4 PASSED (2026-08-13) — wheels whole, door windows ride their doors,
      both rear windows present (spare + guard read fine). Tail lights still missing → round 12.

### Round 12 — FARL_3B: the tail lamps live in the YEAR selector (2026-08-13)

- **Seen:** tail lights still absent after round 9's pipeline fix.
- **Root cause (measured):** the burrito's tail-lamp cluster is the `version[1983]:1` /
  `version[1985]:1` container's OWN mesh (bbox y = [−2.63,−2.44] — the rear panel; the year GRILLES
  are its children) inside the `year:1` selector group — and the blanket year-variant drop (the
  taxi's stacked-doors lesson) discarded BOTH years, leaving lamp holes and the black grille aperture
  seen since the first FARL_3B round.
- **Fix (one variable):** a year-bracketed selector child is an ordinary OPTION — picked per the
  `<name>:K` walk — UNLESS its subtree re-offers a part the rig already carries (the taxi's
  `_[1991]:2` sets duplicate the matched base doors): those stay unadoptable ALTERNATIVES
  (`reoffersCarried` guard against the template's canonical part set). Outside containers the
  blanket year drop stands. The burrito adopts `version[1983]:1` + `grill83[gmc]` (first eligible
  year); the taxi keeps its single door set (suite golden pair green). Fleet 23/23, verify green;
  suite 80/80; bottle updated (`cs-mods-plates-pretail` holds the rounds-9–11 build).
- [x] **Re-check (user):** PASSED (2026-08-13): "all fixed, FARL_3B can be closed." FARL_3B ✅ in
      the ledger. No per-model hardcode anywhere in the chain: every rule derives from the mod's own
      structure and the slot's vanilla template at convert time (checked — the only model name in
      the tool source is a comment).

### Rounds 13–14 — FINAL2B: three findings, two mechanisms (2026-08-14, two screenshots)

**Seen:** (1) both peds sit visibly ABOVE the bravura's cabin (heads over the windshield line —
in gameplay the same mod seats its driver correctly); (2) the sabre's door reads "strange" against
the neighbouring panels; (3) the sabre's original (mod) reflections look lost. All three decomposed
offline against the model data before any code moved.

- **Round 13 — wheel container precedence (fixes 1):** the MR2 mod ships BOTH a bare `disk_wh`
  brake disc under `wheel_rf_dummy` AND a VehFuncs `f_wheel_1111 → f_extras:1 → stock|prefacelft|
  trueno` wheel sub-model. `findWheelMeshes` preferred the dummy child, so the disc (z-half-extent
  0.136) became THE wheel and `groundShift` sank the whole body by −0.189 to put the disc's bottom
  on the vanilla ground plane — the peds, animated in world space, poked out of the sunken cabin
  (and the car rode on disc-sized wheels). Fix: a `f_wheel_*` container WINS over the dummy-child
  mesh — when both exist the dummy child is the stock fallback wheel VehFuncs replaces in gameplay.
  The displaced fallback must DROP, not adopt: anything in a wheel dummy's subtree is wheel
  furniture (`wheelDummySubtreeFrames`), else the disc rode the chassis as a static orphan at one
  corner. Measured after: chassis back at the mod's authored height (z top 0.473 → 0.662, shift ≈ 0),
  wheels the 2 630-vert stock style standing on −0.718.
- **Round 14 — mixed-geometry translucency split (fixes 2 + 3):** the sabre bakes its door glass
  INTO `door_lf/rf_ok` (alpha-150 pane material inside the painted door) and its lamp lenses into
  the chrome bumpers (alpha 150/230). The round-9 rule is per-ATOMIC — any translucent material
  keeps the whole atomic off the vehicle PipelineSet — so one embedded pane cost the whole painted
  door its shine (flat against shining fenders = "strange door") and the chrome bumpers their
  reflections; the pane-last pass also dragged the ENTIRE door into the window block. Round 9's
  record already named this trade acceptable because *vanilla's* mixed translucents are 26–128-alpha
  whispers — the sabre is the first mod in the sweep to bake big painted surfaces and glass into one
  mesh. Fix (`rig/split.ts`, all branches via `finalizeAtomics`): a geometry carrying both classes
  splits into an opaque copy (vehicle pipeline, normal draw slot) and a translucent twin (default
  pipeline; pane ordering when it is a pane) on the SAME frame. The surgery is byte-narrow: the full
  vertex set stays in both copies (prelit/uv/normals/night-colour bytes untouched), the BinMesh is
  FILTERED by whole per-material entries (winding + strip bytes verbatim — exporters ship Struct
  faces and BinMesh with opposite winding), the opaque copy's unreferenced translucent materials get
  alpha 255 for the classifiers, ADC-strip geometries never split. Stock donors carry the same
  shape (the bobcat's doors embed 128-alpha glass) so the 242-alpha "whisper" parts fleet-wide now
  gain the shine round 9 knowingly left off them. Measured after (cssabre92): opaque doors/bumpers
  stamped in normal order, glass twins pane-last unstamped, lens twins unstamped in place.
- Fleet 23/23, verify green (317 DFFs, 0 duplicate channels); suite 85/85 (round-13 container test,
  three split tests); bottle updated (`cs-mods-plates-presplit` holds the round-12 build).
  Contracts §3 rows updated (wheel precedence, the split). The mods' own garbage vertices (bravura
  `bonnet_ok` z ≈ 1.3e7, sabre `chassis` x ≈ 5.8e25 — invisible degenerates in gameplay) are
  carried byte-faithfully as always and are NOT these findings' mechanism.
- **Re-check scope:** both rounds change the shared emit fleet-wide — earlier ✅ scenes keep their
  one-eye glance rule (wheels on every car with a f_wheel container; shine on formerly-mixed parts);
  FINAL2B re-run decides all three findings.
- [x] **Re-check (user):** PASSED (2026-08-14): "FINAL2B — all good" — seats, wheels, door and
      reflections all read fine. FINAL2B ✅ in the ledger; the sweep resumes at row 12 (GARAG3A).

### Round 15 — HEIST8A: the securica on its tail — the runtime erases un-animated rotations (2026-08-14)

**Seen:** cssecurica92 "completely broken" — the whole body standing vertically on its tail, doors
away from their openings, wheels reading wrong. First scene with this model, and the first with a
rotated-bone rig.

- **Regression check first:** the round-13/14 build and the round-12 build convert securica to an
  IDENTICAL frame tree (the only diff: three static orphan wheels round 13 correctly drops) — a
  pre-existing base-conversion bug field-exposed for the first time, not a regression.
- **Root cause (measured, then recovered from the original source):** every offline view of the
  built model was UPRIGHT — bind pose, worlds, even a naive anim replay (heist8a.ifp drives every
  bone to the vanilla local, measured). The breakage only reproduced after recovering the runtime
  law from gta-reversed (`FrameUpdateCallBackNonSkinned` via `CCutsceneObject` →
  `RpAnimBlendClumpInit`): **on an animated clump the runtime rewrites EVERY frame's rotation each
  tick — bound frames get the anim quaternion, unbound frames sum a zero quaternion which
  `Normalise` turns into IDENTITY; only the position snapshot (`FramePos`) survives.** A rotation
  stored in a `_pv` shim or `_ad` frame is silently erased in game. Eleven scenes passed because
  every earlier shim happened to be translation-only; cssecurica92 is the one vanilla rig whose
  bones carry 90-degree rotations, so its shims got real rotations — wiped, the body took the raw
  vanilla bone rotation and stood on its tail. A law-replay simulation (unbound frames forced to
  identity) reproduces the field screenshot exactly; recorded in `docs/gta-sa-original/cutscenes.md`.
- **Fix (one mechanism, emit model v4):** un-animated frames emit TRANSLATION ONLY. `emitBone` shims
  carry identity rotation and land the bone's world POSITION on the donor target; adopted frames
  likewise; the rotation residual (`inv(boneWorld) ∘ targetWorld` — pure rotation about the part's
  hinge) is baked into the part's VERTICES (`emitTargetedAtomic` → `bakeGeometryBody`, the gate-4
  machinery revived). Identity residual keeps geometry byte-verbatim — the fast path.
- **Blast radius (measured):** 22/23 DFFs change — mostly small authored rotations the old path
  stored in frames and the game silently erased: steering wheels (bobcat `movsteer_1.0_ad` 23°,
  taxi `f_steer_ad` 25°) rendered un-tilted all along, exhaust tips, micro-noise door shims now
  cleaned to identity. These parts now render as the mod authored them.
- Fleet 23/23, verify green (317 DFFs, 0 duplicate channels); suite 86/86 (securica golden:
  identity-rotation invariant + law-replay upright, on new real fixtures `cssecurica92.dff` +
  `securica.dff`); law-replay of the built img confirms the truck upright (body z 0.16–2.88, doors
  at vanilla heights). Bottle updated (`cs-mods-plates-prerotlaw` holds the rounds-13–14 build).
  Contracts §3 shim row + `docs/gta-sa-original/cutscenes.md` updated in the same change.
- **Re-check scope:** fleet-wide emit change — earlier ✅ scenes keep the one-eye glance rule
  (steering wheel tilt, exhaust alignment are the visible deltas); HEIST8A re-run decides the row.
  The "wheels turned wrong" reading gets its own look after the body fix lands.
- [x] **Re-check (user):** PASSED (2026-08-14): "HEIST8A — good" (GARAG3A passed the same run) — the
      truck stands on its wheels, no wheel finding survived the body fix. HEIST8A ✅ in the ledger;
      the sweep resumes at row 14 (RIOT_4B).

### Round 16 — SMOKE1B: the glendale's left wheels sat 0.21 m off their arches (2026-08-14)

- **Seen:** both left wheels shifted along the car (the screenshot shows the two front wheels
  overlapping, one ahead of the other). Reported off the round-12 build during the RIOT_4B bisect;
  the law-replay shows the identical defect in every build — base conversion, not a regression.
- **Root cause (measured):** R*'s csglendale92 binds its LEFT wheels CROSSED front-to-rear versus
  what every scene drives — `wheel02` binds at the left rear (−0.916, −1.784) while SMOKE1B's
  channel poses it at the left front (+1.792), `wheel03` the reverse; the right side matches. The
  template classified corners from the BIND, so each left wheel bone got the OTHER end's mod-corner
  shim; the runtime anim then put the bone at its own end → off by exactly the mod's front-vs-rear
  wheelbase delta difference (0.21 m on the LTD donor).
- **Fix (one variable):** wheel corners and locals follow the SCENE ANIM's frame-0 pose when one is
  known (`anim-poses.ts` reads `anim/cuts.img`'s ANPK wheel channels at install time; the same
  runtime-law logic as round 15 — the anim is where the bone really stands, the bind only a hope).
  A pose set only counts when it yields four DISTINCT corners: rigs nesting wheels under axle frames
  (washington, savanna) animate their wheel channels near zero and keep the bind. Blast radius
  measured: only csglendale92 (the fix) and csremington92 (float-noise, runtime-identical wheels)
  change; the fleet is otherwise byte-identical.
- Fleet 23/23, verify green; suite 87/87 (template golden on the real csglendale92 + smoke1b.ifp
  fixtures: anim poses uncross the corners, bind fallback preserved).
- **Also seen in the same report, parked pending re-run on the current build** (the run was on the
  bisect build): the glendale body looked pale versus gameplay, and one of two runs showed a
  two-tone body. Both get their own look once the RIOT_4B bisect closes and the current build is
  back in the bottle.
- [x] **Re-check (user):** PASSED (2026-08-14): "better — specular improved too, wheels in place,
      glass there, one colour — good". The pale-body and two-tone observations were artefacts of
      running on the bisect build; both cleared on the round-16/17 build. SMOKE1B ✅ in the ledger.

### Round 17 — RIOT_4B: the invisible passengers — rendered window glass erases scene actors (2026-08-14)

- **Seen:** both peds inside the greenwood invisible through every window (tint present on all of
  them); a ped becomes visible only in the door gaps while exiting. The pistol and the exited CJ
  render fine.
- **The bisect chain (five field runs):** r15 hides the peds → VANILLA shows them through every
  window → r12 shows them → r13–14 hides them (tint "like the original" appears) → a no-split
  diagnostic build on current code still hides them. Segmented per window on the diagnostic build:
  tint + erased actors on all three visible panes.
- **Root cause (measured, original source + field):** scene actors are SEPARATE cutscene objects,
  and the renderer draws entities in world-sector scan order — a per-scene accident. A rendered
  window pane z-writes (the cutscene path has no deferred alpha; gameplay's
  `RenderDriverAndPassengers` + sorted-alpha choreography exists only for CVehicle entities), so it
  ERASES every actor drawn after the car. Scenes that win the order roulette layer fine (PROLOG1's
  driver, PROLOG3's cops, FINAL2B — all verified with glass over actors); RIOT_4B loses it. Vanilla
  never trips this: R*'s cutscene window glass effectively never renders (door glass absent, the
  rest in the sub-alpha-test band) — actors win over glass, per R*'s own authoring. Every earlier
  "glass + actors" success of ours was an accident: the blessed-six pipe dropping the glass
  (bravura) or the round-15 rotation bug holding the glass off the windows (r12's greenwood).
- **Fix (the user's option C, field-calibrated):** window-pane suppression per SLOT —
  `PANE_SUPPRESSED_SLOTS` (census; `csgreenwood` first): after the split isolates windows, the pane
  atomics are not emitted; lenses and opaques untouched. Slot-keyed, mod-agnostic (the failing
  property is the slot's scenes' draw order). Full story + retirement path:
  `docs/hacks/retired/cutscene-window-pane-suppression.md`. Unlisted slots keep their better-than-vanilla
  tint; the sweep watches every remaining actors-inside scene (SWEET2B, CESAR1A…) for new losers.
- Suite 88/88 (suppression golden on the bobcat pair); fleet 23/23, verify green.
- **Re-check scope:** greenwood-only model change; RIOT_4B re-run decides; SWEET2B (greenwood again)
  covered by the same suppression.
- [x] **Re-check (user):** PASSED (2026-08-14): "RIOT_4B — good" — passengers visible through every
      window, lamps intact. RIOT_4B ✅ in the ledger; the sweep resumes at row 16 (SMOKE1B re-run on
      the round-16/17 build).

### Round 18 — SYND_3A: the washington loses the same roulette (2026-08-14)

- **Seen (user, ahead of the sweep):** SYND_3A "reproduces the bug very well" — actors erased behind
  the washington's rendered glass, the round-17 mechanism verbatim on a second slot.
- **Fix (the round-17 rule, one slot name):** `cswashington` joins `PANE_SUPPRESSED_SLOTS`. SYND_3A
  also becomes the SECOND standing repro scene of the perfect-cutscene ASI plan (step 0/3 gates),
  alongside RIOT_4B.
- **Re-check scope:** washington-only model change; SYND_3A re-run decides; SYND_4A (washington again)
  covered by the same suppression.
- [x] **Re-check (user):** DEFERRED (2026-08-14): the re-run still showed the eraser — yet the
      r18 build measures 0 pane atomics on the washington (suppression active), so either the run
      raced the install (the running-game trap) or the mod's window glass rides the LENS class
      (`wing_*_ok_ad` are its only remaining translucents — suspicious for "wings"). The user's
      call: stop chasing it data-side — SYND_3A is ASI repro scene #2 and the ASI fixes the
      mechanism for every class.
- **The LENS hypothesis is dead (2026-08-14, ASI plan 001 step 0):** on the hackless repro build the
  washington carries 7 pane atomics, and SYND_3A shows BOTH the tint and the erased actors — the
  erasing glass is the window-pane class after all, so the round-18 contradiction was the
  running-game install race (the swap lands next launch). The row stays ASI-deferred as decided.

### Round 19 — SYND_4A: the wheel stash — vanilla hides repair-scene wheels at the origin (2026-08-14)

- **Seen:** the washington stands wheel-less on repair as authored — but the converted model shows
  all four wheels collapsed into one clump at the car's middle.
- **Root cause (measured):** SYND_4A's anim drives EVERY washington wheel+axis channel to ~zero —
  R*'s hide is "stash the wheels at the model origin", where the VANILLA body and the ground conceal
  them (vanilla wheels land centred at the origin, half underground, r 0.33 under a low belly). The
  converted mod leaks the trick: its wheels are fatter (r 0.37) and its translation shims offset the
  stash (+4 cm z, ±10 cm spread) — the clump pokes out between the ground and the Lincoln's floor.
  **No static fix exists**: one constant shim must serve both anim poses (driving = mod corner,
  stash = origin), and wheel geometry cannot bake offsets (it spins about its bone in other scenes).
- **Fix (routed to the ASI):** the wheel-stash concealment payload in
  [`asi/perfect-cutscene` plan 001](../../../../asi/perfect-cutscene/docs/plans/001-deferred-cutscene-alpha.md)
  (design point 5 / step 4b): a wheel bone whose ANIMATED local is ~zero while its bind local is a
  corner is stashed — the render callback skips it. The anim itself is the hide instruction; no
  model or scene names. SYND_4A is ASI repro scene #3; SYND_3A must keep all four wheels (the
  negative gate).
- [x] **Re-check (user):** SUPERSEDED by round 20 the same day — the "no static fix exists" claim
      was WRONG one level up: the model data cannot fix it, but the SCENE data can.

### Round 20 — SYND_4A: the wheel stash sinks in the scene data, not the ASI (2026-08-14)

- **The user's push:** "can we really not fix this without the ASI? look at the scene again." The
  second look found two things round 19 missed: (a) the stash drives ONLY the `wheel*` channels to
  zero — the `Axis_*` channels stay on the corners (the authored bare-hub repair look), so the
  stash signal is clean; (b) a fleet-wide scan of all 148 scenes found EXACTLY ONE stash site
  (synd_4a.ifp, four cswashington wheel channels). One site, value-only — an ASI payload was
  over-engineering.
- **Fix (data, general rule):** the installer now emits a surgically patched `anim/cuts.img`
  (`stash-patch.ts`): any cutscene wheel channel whose frame-0 translation is ~zero while the
  model's bind local is a real corner (>= 0.5 m) sinks to z −0.6 — fully underground for any mod
  wheel radius, authored intent (hidden wheels) preserved for any body. Driving scenes never match
  (their wheel channels carry corner values — SYND_3A verified in data). The ASI plan drops its
  wheel payload and stays alpha-only. Delivery grows by `anim/cuts.img` (the bottle keeps a
  `.vanilla` beside it for the A/B).
- Suite 91/91 (three stash-patch tests on the real synd_4a/smoke1b fixtures); fleet 23/23, verify
  green; patched values verified inside the built img (all four channels 0,0,−0.6; Axis untouched).
- **Re-check scope:** scene-data change for one scene; SYND_4A re-run decides (LOOK-FOR: the
  washington stands wheel-LESS like vanilla authors it; then SYND_3A one-eye glance — wheels must
  all be present when driving).
- [x] **Re-check (user):** PASSED (2026-08-14): "wheels gone — excellent, SYND_4A has no bugs."
      SYND_4A ✅ in the ledger (18/35). SYND_3A's driving-wheels glance folds into its own
      ASI re-test.

### Round 21 — PROLOG3: the windscreen that was never glass (2026-08-14)

- **Seen (user, screenshots):** the sheriff car's windscreen AND rear screen read as matte from every
  camera angle, while the door glass on the same car is see-through. Found while gating the
  perfect-cutscene ASI, and **not caused by it** — the user pulled the `.asi` out entirely and the
  windscreen stayed matte, which is what turned the hunt data-side.
- **Root cause (measured, and the model data is INNOCENT of everything else first):** the glass
  material is `102,102,102` alpha 115, byte-identical to the mod's own source DFF and unchanged in
  every build since 08-13; the texture is byte-identical too; nothing opaque covers the pane (a plane
  test found only the interior, 64 %, BEHIND it); no prelit colours; one sheet, not two layers; the
  pane sits on the DEFAULT pipeline like every other translucent. What differs is a GEOMETRY FLAG:
  `windscreen_ok` and `body_windows` carry `0x10037` — **no `rpGEOMETRYMODULATEMATERIALCOLOR`** —
  while the door glass carries `0x200f7`, which has it. Without that bit RW's default pipeline never
  reads the material colour, so alpha 115 is simply not applied and the pane renders solid.
  **The mod ships it that way and gameplay never shows it**: SA's vehicle pipe takes the material
  alpha itself and does not consult the flag (the user's gameplay screenshot of the same car is the
  A/B). Cutscene translucents ride the default pipe (round 9), which is where the flag decides.
- **Fleet scan confirms the mechanism, 23 models:** `copcarla` (both slots) is the ONLY mod whose
  translucent geometries lack the flag — `windscreen_ok`, `body_windows`, `glass`, `f_steer`, plus
  three decal geometries — and they are exactly the panes the field called matte. Every model whose
  glass the sweep accepted has the flag.
- **Fix (a general emit rule, `materials.ts` `ensureModulateMaterialColour`):** a geometry that
  carries a translucent material gets `rpGEOMETRYMODULATEMATERIALCOLOR` set. Opaque geometries are
  untouched — there the flag decides how a material colour tints its texture, which is the mod's call.
  Derived from the asset, no model named. Suite 92/92; fleet 23/23, verify green; the flag flips on
  exactly the seven copcarla geometries and nothing else in the fleet moves.
- **Re-check scope:** copcarla-only change; PROLOG3 decides. LOOK-FOR: windscreen and rear screen
  see-through with tint, door glass unchanged, body/lights unchanged.
- [x] **Re-check (user):** PASSED (2026-08-14): "the glass is transparent — it looks perfect."
      PROLOG3 re-verified on the `cs-modulate` build with NO asi installed, so the flag is the whole
      fix. The lesson worth keeping: **a viewer cannot show you this bug.** Material, texture,
      geometry, pipeline and draw order all measured clean and byte-faithful to the mod; the defect
      was one bit in the geometry flags word that only RW's default pipeline reads.

### Round 22 — SMOKE2B: the occupants behind the glendale's glass (2026-08-15, screenshot)

The field: "the passengers are not visible behind the glass", with the note that no earlier glendale
scene had anyone sitting inside. Measured before analysing, and the render side comes out CLEAN:

- **The ASI classified and deferred the car correctly.** The census log of that very run reads
  `[census] model/key/skinned 301 -2087156539 0` — key `-2087156539` decodes to `csglendale92`
  (`scripts/debug/sa-name-key.ts`), skinned 0, so it went to the sorted entity pass; `csplay` and
  `cssmoke` logged skinned 1 and stayed in the main pass. Actors draw first, the car draws after.
- **The pane is a proper translucent.** Built `csglendale92`: `windscreen_ok_ad` is atomic **#42 of
  44** (last but one), material `45,53,48 @125` on the `gls` swatch, `rpGEOMETRYMODULATEMATERIALCOLOR`
  set. Nothing about order, class or flags is wrong.
- **The conversion is byte-faithful.** The gameplay mod's own `windscreen_ok` carries exactly
  `45,53,48 @125` on `gls`, modulate already set. We changed nothing.

What actually differs from vanilla is CONTENT, and it is the whole finding:

- **The stock cutscene glendale has NO glass at all** — 13 atomics, zero materials below alpha 255,
  no `windscreen`/`glass` frame anywhere (same for the copy inside `3. Global Textures Fixes`). R*
  authored this cutscene car with the windows as open holes, which is why the vanilla scene shows its
  occupants unobstructed. Ours has 44 atomics and real glass, because the MOD authors real glass.
- **That glass is the darkest in the converted fleet.** Against the two cars whose actors the field
  accepted through the tint: csgreenwood `55,96,102 @102` (luminance 84, 40 % cover), cswashington
  `77,94,95 @110` (luminance 90, 43 %), csglendale92 `45,53,48 @125` — luminance **50** at **49 %**
  cover. It both lets less through and lays a much darker, greener veil over what remains; over a dark
  cabin at dusk that is enough to swallow a seated actor.

So the scene is faithful to the mod and different from vanilla for a reason no render change can undo.
**Open control before any code:** does this mod's glendale read equally dark in GAMEPLAY with someone
inside? If it does, the cutscene is honouring authored data and the delta is a product call; if it
does NOT, the vehicle pipe is doing something the cutscene default pipe is missing and that delta is
the real defect. Nothing is changed until that run says which.

Note for whoever picks this up: an alpha clamp is NOT the answer — round 7 already retired one, and
it only erased the tint and sheen the mod carries in gameplay.

### Standing addendum — the perfect-cutscene ASI re-opens the whole ledger (2026-08-14)

The draw-order mechanism behind rounds 15–17 gets its real fix as an engine patch:
[`asi/perfect-cutscene`](../../../../asi/perfect-cutscene/docs/plans/001-deferred-cutscene-alpha.md)
defers every translucent cutscene-vehicle atomic into the sorted alpha pass (glass over actors at any
entity order) and retires the `PANE_SUPPRESSED_SLOTS` hack. **When that ASI lands, ALL 23 models'
translucent rendering changes — every ✅ row in this ledger re-opens for a re-run** (glass, tint,
shine, actors; ~15 s each, one sitting — the ASI plan's step 6). Until then this plan's verdicts
stand on the current no-ASI rules.

## Step 3 — the approval

- [ ] All 35 rows carry a verdict; open findings zero. **The user's blanket approval closes the
      plan** — and with it the scene-coverage half of 002 step 11's acceptance (the pipeline-build
      half stays with 002: this sweep runs on the bottle's self-contained build).

**Record:** rounds spent, findings found/fixed, the approval verbatim.
