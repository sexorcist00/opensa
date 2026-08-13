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
| 1 | PROLOG1 | cstaxi92 | ✅ (gate 4/7 + 003) |
| 2 | PROLOG3 | cscopcarla92, cstaxi92 | ✅ (gate 4/7 + 003) |
| 3 | STRP4B2 | csmtbike92 | ✅ (002 step 8) |
| 4 | DESERT9 | csbobcat92 | ✅ after rounds 1–2 ("glass with the door, one rack") |
| 5 | BCESA4W | csbravura, cszr350b | ✅ (2026-08-13, "good") |
| 6 | BCESAR4 | cssavanna, cszr350 | ✅ after round 3 ("lights are normal now") |
| 7 | BCESAR5 | cssadler, cszr350, cszr350b | ✅ after rounds 4–8 ("glass renders normally now, tint and sheen in place") |
| 8 | DES_10B | csmothership | |
| 9 | DESERT1 | csmonster | |
| 10 | FARL_3B | csburrito92 | |
| 11 | FINAL2B | csbravura, cssabre92 | |
| 12 | GARAG3A | csremington92 | |
| 13 | HEIST8A | cssecurica92 | |
| 14 | RIOT_4B | csgreenwood | |
| 15 | RIOT4E1 | cscopcarsf, csfirela | |
| 16 | SMOKE1B | csglendale92 | |
| 17 | SWEET2B | csgreenwood, csvoodoo | |
| 18 | SYND_3A | cswashington | |
| 19 | SYND_4A | cssavanna, cswashington | |
| 20 | BCESA5W | cszr350, cszr350b | |
| 21 | BCRAS1 | cscopcarla92 | |
| 22 | BCRAS2 | cscopcarla92 | |
| 23 | CESAR1A | cssavanna | |
| 24 | CRASH3A | cscopcarla92 | |
| 25 | CRASV2A | cscopcarla92 | |
| 26 | CRASV2B | cscopcarla92 | |
| 27 | RIOT4E2 | csfirela | |
| 28 | SCRASH2 | csbravura | |
| 29 | SMOKE2B | csglendale92 | |
| 30 | SMOKE3A | csglendale92 | |
| 31 | SMOKE4A | csglendale92 | |
| 32 | STEAL_2 | csremington92 | |
| 33 | STEAL_4 | csremington92 | |
| 34 | STEAL_5 | csremington92 | |
| 35 | TRUTH_2 | csmothership | |

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

## Step 3 — the approval

- [ ] All 35 rows carry a verdict; open findings zero. **The user's blanket approval closes the
      plan** — and with it the scene-coverage half of 002 step 11's acceptance (the pipeline-build
      half stays with 002: this sweep runs on the bottle's self-contained build).

**Record:** rounds spent, findings found/fixed, the approval verbatim.
