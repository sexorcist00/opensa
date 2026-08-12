# 002 — implementation: mod vehicles into cutscene.img

**Status: PLANNED 2026-08-12.** Execution plan for [001-architecture](001-architecture.md). Steps are
ordered by priority and dependency; each is individually shippable and ends with verification + a numbers
slot (standing rule: a phase without its numbers is unfinished). The vanilla-parity gate (step 4) is the
load-bearing verification of the whole tool: convert a STOCK car and diff it against the vanilla cutscene
model R* shipped — before any mod is involved.

Priorities: **P0** = the tool exists and provably transforms a car; **P1** = the output is visually
correct in the field; **P2** = full fleet coverage (bike/boat, all 23) and pipeline integration.

---

## Step 1 (P0) — scaffold + census + inspect ✅ SHIPPED 2026-08-12

The read path: know the slots, match the mods, report readiness. No writes.

- [x] Scaffold `tools/vehicle-cutscene/`: `package.json` (`@opensa/vehicle-cutscene`, nx tag
      `type:tool`), `readme.md`, `src/cli.ts` with `--game/--in/--out/--only/--inspect` validation
      (mirror `vehicle-installer/src/cli.ts` arg handling verbatim). Also registered in
      `vitest.config.ts`'s include list (tools are enumerated there — a new tool's tests silently don't
      run until added).
- [x] `census.ts`: derive the cs-vehicle table from the `--game` tree. **The matcher came out simpler and
      stricter than planned**: no prefix rules at all — a `cs*` entry is a vehicle iff its txdcut.ide
      row's parent names an IDE row (covers `csremington92` → `remingtn`, which NO prefix rule can link:
      the truncation drops an interior letter), or its bare stem equals an IDE model name exactly (covers
      the three rows R* left out: `cscopcarla` typo'd, `cscopcarsf` + `csdinghy` missing). `csho`,
      `csfirela` and every prop/ped fall out with no special case. Boats survive via a tool-local
      tolerant `cars`-section parse — the shared `parseVehicleDefs` column guard drops them (098 recon).
- [x] Match census slots against `--in` mod folders (by dff basename, not folder name; alphabetically
      last folder wins a duplicate, matching the installer) → `ready` / `no mod` / `mod incomplete`.
- [x] `--inspect` prints the table (cs name, donor model, branch, txdcut row state, status, folder).
- [x] Tests: 14 (negative describes first) on the real `vehicles.ide` + `txdcut.ide` fixtures
      (`data/txdcut.ide` added to the `test:fixtures` manifest) + composed entry maps and temp mod
      folders. No cs DFF fixtures needed — census reads names and sizes only.

**Verification (run 2026-08-12):** `--inspect` over `game-src/original` + `mods-src/original/vehicles`
→ **23 cutscene model(s), 21 donor slot(s), all 23 ready**; both dead txdcut rows reported
(`csandrom92`, `csopcarla`). Census tests 14/14 green.

**Record — the census table (2026-08-12, game-src/original):**

```
csbobcat92     bobcat    car   txdcut yes      ready  bobcat - 1988 GMC Sierra 1500 1.2 - mad max
csbravura      bravura   car   txdcut yes      ready  bravura - 1988 Toyota MR2 Supercharged T-Bar - alfamodding
csburrito92    burrito   car   txdcut yes      ready  burrito - 1985 GMC Vandura - 533
cscopcarla     copcarla  car   txdcut MISSING  ready  copcarla - 1978 Ford Fairmont LS County Sheriff - funky
cscopcarla92   copcarla  car   txdcut yes      ready  (same donor)
cscopcarsf     copcarsf  car   txdcut MISSING  ready  copcarsf - 1985 Chevrolet Impala SFPD - mad max
csdinghy       dinghy    boat  txdcut MISSING  ready  dinghy - Dinghy HD - michelle works
csfirela       firela    car   txdcut yes      ready  firela - 1986 Sutphen 75 Mid-Mounted Ladder - stratumx
csglendale92   glendale  car   txdcut yes      ready  glendale - 1953 Ford Mainline Fordor Sedan - stratumx
csgreenwood    greenwoo  car   txdcut yes      ready  greenwoo - 1986 Ford LTD - mad max
csmonster      monster   car   txdcut yes      ready  monster - 1986 Chevrolet Silverado 2500 MT - klarnetist
csmothership   camper    car   txdcut yes      ready  camper - 1967 Volkswagen Transporter T1 - stratumx
csmtbike92     mtbike    bike  txdcut yes      ready  mtbike - Smooth Criminal Bicycles 3.0 MTB - zeneric
csremington92  remingtn  car   txdcut yes      ready  remingtn - 1979 Lincoln Continental - k1real24
cssabre92      sabre     car   txdcut yes      ready  sabre - 1972 Ford Gran Torino Sport - mad driver
cssadler       sadler    car   txdcut yes      ready  sadler - 1970 Ford F-100 - stratumx
cssavanna      savanna   car   txdcut yes      ready  savanna - 1964 Chevrolet Impala SS 2.1 - mad max
cssecurica92   securica  car   txdcut yes      ready  securica - 1985 Ford F-800 Security Car - mad driver
cstaxi92       taxi      car   txdcut yes      ready  taxi - 1992 Chevrolet Caprice Taxi - funky
csvoodoo       voodoo    car   txdcut yes      ready  voodoo - 1960 Chevrolet Impala - chezy
cswashington   washing   car   txdcut yes      ready  washing - 1983 Lincoln Town Car 1.1 - stratumx
cszr350        zr350     car   txdcut yes      ready  zr350 - 1982 Pontiac Firebird - funky
cszr350b       zr350     car   txdcut yes      ready  (same donor)
dead txdcut.ide rows: csandrom92, csopcarla
```

---

## Step 2 (P0) — template extraction + car rig transform ✅ SHIPPED 2026-08-12

The heart of the tool. Input: mod DFF (game rig) + vanilla cs DFF (template). Output: converted cs DFF.

**Probe findings that shaped the code** (measured on csbobcat92/cstaxi92/cszr350/csremington92/csdinghy/
csmtbike92 before writing it; the binary facts live as comments in `rig/clump-io.ts` and `rig/car.ts`):

- **Left wheels are 180°-about-z on the wheel MESH frame** (`[-1,0,0, 0,-1,0, 0,0,1]`), nodes identity —
  risk 1 settled.
- **Hierarchy flags follow one rule on all five vanilla rig styles**:
  `flags = (siblings follow ? 2 : 0) | (leaf ? 1 : 0)`, table in DFS order (frame-index child order),
  `nodeIndex` = row, vanilla bone ids are DFS-sequential — risk 3 settled by reproduction, not by copying.
- **Vanilla clump extension is EMPTY** on every cs model — a mod's embedded COL3 is dropped by design.
- Frame-list matrix-flags words: `0x20003` top frame, `3` everywhere else; HAnim `flags 0 / keyFrameSize
  36`; every frame carries an Extension chunk (empty on the unnamed top frame).
- Wheel-node junk: vanilla Box/node frames carry degenerate 24-vert meshes (3ds-max export leftovers) —
  not emitted; the parity gate will confirm nothing needs them.

### 2a — template (`template.ts`)

- [x] Parse the vanilla cs model per slot and extract: root frame name; the part list with **canonical
      names** (strip `_hi`); bone id per canonical part; wheel corners normalised by position sign;
      wheel-mesh rotation matrices copied (the left z-180). The hierarchy table is NOT copied — the flags
      rule reproduced it verbatim on every style, so the emit recomputes it (works with holes too).
- [x] Ground-plane formula as planned; vanilla-on-vanilla bobcat yields shift 0.900 exactly.
- [x] Tests: negative — no-HAnim clump throws; positive — bobcat (root `bobcat_dummy`, chassis bone 9,
      radius 0.349), taxi (`door_lf_hi_ok` kept, canonical stripped), remington (chassis bone 1).

### 2b — frame surgery over rw-codec chunks (`rig/car.ts`, `rig/clump-io.ts`, `rig/matrix.ts`)

Chunk-level clump rebuild via `readRw`/`writeRw` — geometry/material/atomic chunks byte-copied from the
mod, frame list and atomic→frame/geometry indices rewritten:

- [x] Drop is the complement of keep — anything without a place in the template is simply not carried
      and lands in `report.droppedFromMod` (damage twins, `chassis_vlo`, `misc_*`, service dummies,
      middle-axle wheels). No explicit drop list needed.
- [x] Hinge collapse via full transform composition relative to the chassis mesh (`rig/matrix.ts`,
      orthonormal inverse) — works wherever the part hangs (zr350's `exhaust_ok` lives under the chassis
      MESH, not the dummy) and composes non-identity `_ok` transforms instead of keeping them.
- [x] Part-set policy = template ∩ mod by canonical name; misses → `missingInMod`, extras follow the
      same rule.
- [x] Wheels: four nodes at the mod's `wheel_*_dummy` transforms (z shifted), template bone ids and
      names, left mesh z-180. **Decision: all four atomics SHARE one geometry chunk** (vanilla
      duplicates; shared is the smaller emission) — the parity gate arbitrates, fallback is a 4× copy.
- [x] Root renamed to the template's; nameless top frame emitted with vanilla's `0x20003` flags word.

### 2c — HAnim emit (in `rig/clump-io.ts`, not a separate file)

- [x] HAnim plugin per boned frame (version 0x100, `flags 0`, `keyFrameSize 36`); the hierarchy table is
      RECOMPUTED from the emitted tree by the measured flags rule rather than copied — reproducing every
      vanilla table verbatim is the committed test of it.
- [x] Tests: clump-io round-trip on the real csbobcat92 (frames/hierarchy/atomics/geometry bytes
      survive), parse-back via `@opensa/renderware` in the golden tests.

**Verification (run 2026-08-12): 35/35 tests green — the golden pairs are committed tests
(`rig/car.test.ts`), lint + tsc clean.**

**Record — golden diff summary (stock donors, 2026-08-12):**

```
csbobcat92: parts=9 missing=[] dropped=9  shift=0.900 maxPosDelta=0.0000 hierarchy=EQUAL  165 476 B
cstaxi92:   parts=8 missing=[] dropped=12 shift=0.013 maxPosDelta=0.80   hierarchy=EQUAL  169 158 B
cszr350:    parts=6 missing=[extra2, steering_wheel] dropped=8 shift=0.699 maxPosDelta=1.23
            hierarchy=holes-as-designed (indexes contiguous, ids unique)                  135 780 B
```

The bobcat pair — the one slot whose vanilla cutscene model reuses the gameplay body verbatim — matches
to **0.0000** on every shared frame; that is the transform's real validation. The taxi/zr350 deltas are
**measured evidence the `cs*92` bodies were re-authored**, not a transform bug: the '92 taxi is narrower
(doors ±1.06 vs the donor's ±1.10), its bumpers are re-centred at x=0 where the donor hinges them at
±0.8, cszr350's track is 4 cm narrower and its exhaust sits on the OTHER side. Our output follows the
DONOR's geometry — exactly what "the '92 look is replaced by the mod" (001 decision 1) means in numbers.

---

## Step 3 (P0) — game emit (`install.ts`) ✅ SHIPPED 2026-08-12

Needed this early so step 4 can run in the field.

- [x] Copy `--game` → `--out` (vehicle-installer's pattern; `guardOut` REUSED from
      `@opensa/vehicle-installer/install`), rebuild `models/cutscene.img` via tool-kit `EditableImg`.
      Vanilla TXDs stay until step 6. Per-slot failures collected and reported, never silent; exit 1.
- [x] `data/txdcut.ide` patched: typo row fixed, missing rows appended — derived from the census
      (`hasTxdcutRow`), not a hardcoded list.
- [x] `--only` limits conversion to named slots.
- [x] Tests: 5 install e2e on a synthetic game tree carrying real fixtures (guard, error collection,
      branch skips, txdcut patch, `--only`).

**The full-fleet run earned its place in the plan — it found two mod-corpus facts no fixture had:**

1. **Half the fleet ships LOCKED (anti-rip) DFFs** — taxi, zr350, copcarla, firela, burrito, securica +2:
   container sizes lie, a naive size-respecting chunk walk reads an empty clump. Fixed by REUSING the
   engine parser's recovery machinery (`forEachClumpChild` / `recoverLockedList`, read-only) in
   `clump-io.ts`; converted output always carries honest headers (the lock never propagates). A real
   locked mod DFF is now a committed fixture (`taxi-locked.dff`) with a recovery test.
2. **Four mods ship wheels as `f_wheel_*` container sub-models** (IVF convention) instead of a mesh under
   the dummies — the engine builder already knew this (`WHEEL_CONTAINER_RE`); the same rule + first-atomic
   pick is now the third wheel-source fallback in `car.ts`.

**And six more vanilla template styles** (probed, then handled + golden-tested on glendale/monster):
single-frame wheels (bravura, glendale, sadler, washington), an intermediate body frame between root and
chassis (csmonster's `COG`, bone 1, z 1.20 — kept at its vanilla transform), parts nested under parts
(csfirela's `misc_c` under `misc_b`), vanilla's own `winscreen_ok` typo (cssadler — canonicalised), root
names that are neither the model nor `_dummy` (`Root`, `Dummy01`, `Monster92`), and wheel-node aliases
`dummywheel_rr` / `wheelRRnode` (position-sign classification already covered them).

**Verification (run 2026-08-12):** full run over `game-src/original` + `mods-src/original/vehicles` —
**21/21 car models converted, 0 errors** (csdinghy/csmtbike92 skipped pending their branches); output
tree diffs from base in EXACTLY `models/cutscene.img` + `data/txdcut.ide`; all 317 DFFs in the rebuilt
archive parse, all 286 skeletons consistent (hierarchy size = boned frames); 43/43 tests, lint + tsc
clean.

**Record:** cutscene.img **25.7 MB → 82.6 MB** (+56.9 MB, mod-geometry scale as predicted by risk 5 —
no target ceiling implicated).

---

## Step 4 (P0) — FIELD GATE: vanilla parity ✅ PASSED 2026-08-12 (four rounds, three root causes)

The strongest possible check of the transform, zero mods involved: convert the STOCK gta3 cars onto their
cs slots and play the intro.

- [x] Stock donors extracted from gta3.img (21 slots → `NO_COMMIT/cs-stock-donors/`), converted
      (21/21, archive 25.7 → 25.2 MB — SMALLER: shared wheels + dropped junk), dropped into the
      CrossOver bottle (its cutscene.img/txdcut.ide verified byte-identical to stock first; originals
      kept as `.vanilla` beside them).
- [x] Field rounds (user, "In the Beginning" intro — cstaxi92, csbobcat92, cscopcarla): four runs,
      each finding recorded below; a mid-gate VANILLA A/B (restore originals, same shot) settled round 3.

**Verdict (round 4, verbatim): "все отлично" — taxi and police complete and vanilla-shaped; the only
remaining difference is the raw carcols markers (green/pink), which is step 5's job by design.**

### What the gate caught — three root causes no offline check had

1. **Junk mesh-frame transforms are real and the game's collapse rule is NARROW.** Stock copcarla's
   `chassis` frame carries `[0, 1.637, −0.35]`. Round 1 trusted it (whole rig poisoned); the first fix
   over-generalised the discard rule and round 3 shifted the BODY 1.6 m (the game destroys ONLY
   `<part>_ok/_dam` frames under their own dummy — `PreprocessHierarchy`/`CollapseFramesCB`; every other
   frame KEEPS its transform, and the donor's chassis GEOMETRY is authored in that junk space). Final
   rule in `hingeOf` + a bbox regression test on the real copcarla pair.
2. **Cutscene anims bind by frame NAME and drive bones to the VANILLA locals** (gta-reversed
   `CCutsceneMgr` → `CAnimBlendAssociation`). A converted rig's own frame positions only survive
   un-animated frames — so round 2's "donor hinges as locals" left bumpers hanging wherever the '92
   anims put the vanilla hinges. The emit now carries the VANILLA locals (the anims' bind pose) and
   vertex-bakes the donor delta (`rig/bake.ts`, byte-exact Struct-only patch; identity deltas stay
   byte-identical). The hand-made pack's whole-car-in-one-chassis approach was this same lesson.
3. **Dropping donor parts the template lacks leaves holes** — the '92 bodies bake glass into the
   chassis, so a donor's separate `windscreen_ok` vanished (car without glass, round 1). Visible
   orphans (`*_ok`, `extra*`, `misc_*`) are now ADOPTED with fresh bone ids past the template's; anims
   bind by name, so extra bones simply stay un-animated.

**Record:** parity build 25.2 MB; converted cscopcarla chassis bbox equals vanilla to the centimetre
(y −2.78..2.44, z −0.60..1.00); the method that closed round 3 was a mid-gate vanilla A/B of the same
frame — one screenshot settled what three rounds of model forensics could not. The bottle keeps the
parity build installed (`.vanilla` files beside it for rollback).

---

## Step 5 (P1) — materials: paint bake + plate closure ✅ SHIPPED 2026-08-12

- [x] `materials.ts`: reads the `--game` tree's `carcols.dat` (= the BUILT data when the tool runs after
      vehicle-installer), bakes the model's FIRST combo into all four paint markers (primary 60,255,0 /
      secondary 255,0,175 / tertiary 0,255,255 / quaternary 255,255,0 — mirrored from
      `build-vehicle-model.ts`), alpha preserved. 2-colour `car` rows default slots 3/4 to palette 0,
      like the game's zero-initialised extra colours. The patch rewrites ONLY the material Struct colour
      bytes in place — file size and everything else byte-identical.
- [x] LAMP markers (`vehiclelights*` tints) and `carplate`/`carpback` untouched — vanilla cs models keep
      both.
- [x] A marker with no carcols row THROWS (collected as the slot's error) — a marker the game would
      render raw is never silent.
- [x] Tests: 5 new (negative first) on the real bobcat donor + real carcols fixture; install e2e asserts
      marker RGBs are gone from the emitted model.

**Verification (run 2026-08-12):** parity rebuild over stock donors + stock carcols —
**271 paint materials baked across 21 models, 0 errors**; 49/49 tests, lint + tsc clean.
**Record:** 271 materials / 21 models (stock corpus); the parity build in the bottle now carries
gameplay colours — the user's step-5 field look rides the next intro run.

---

## Step 6 (P1) — TXD policy + texture closure ✅ SHIPPED 2026-08-12

- [x] Every converted slot ships an **empty** `cs*.txd` (40 B each — a valid zero-entry dictionary,
      mirroring SA's own empty TXDs); txdp resolves through the parent in gta3.img + the resident
      generic `vehicle.txd`.
- [x] `txd.ts` closure check, fail-loud per slot: DFF texture names (diffuse + mask) must resolve in
      (txdp parent TXD) ∪ (generic vehicle.txd) ∪ (`carplate`/`carpback`, runtime-generated).
      Unresolvable → the slot errors with the missing names listed.
- [x] `--self-contained-txd` escape hatch: the parent TXD bytes verbatim instead of erroring.
- [x] Tests: 4 in `txd.test.ts` (negative first, real bobcat pair + real vehicle.txd) + 2 install e2e
      (empty-TXD emit; missing-parent slot fails naming `bobcat92interior128`).

**Verification (run 2026-08-12):** parity run over stock donors — 21/21 slots pass closure with empty
TXDs, 0 errors; 54/54 tests, lint + tsc clean. **Record:** **840 B total** of emitted cs TXDs across 21
slots vs the hand-made pack's ~11.5 MB per car (≈242 MB for the same coverage — a 288 000× reduction);
cutscene.img 25.7 → 24.4 MB (the vanilla livery TXDs the '92 models carried are replaced by empty ones —
their look now comes from the donor + carcols, per decision 1). Field validation of txdp resolution over
empty TXDs rides the user's next intro run.

---

## Step 7 (P1) — FIELD GATE: modded cars in cutscenes ✅ PASSED for the intro, 2026-08-12 (six rounds)

Delivery for the gate: `--self-contained-txd` build over stock `game-src/original` (the bottle keeps
stock gameplay — cutscene-only A/B; 21/21 converted, 306.7 MB archive, 4 pre-existing-texture-hole
warnings). **Verdict (round 6, verbatim): "дверь открылась, все идеально … по первой катсцене все
отлично"** — sheriff and taxi complete, wheels in the arches both sides, doors swing on the mod hinges,
the taxi's rear door opens for CJ like vanilla.

### What the gate taught — the EMIT MODEL was rebuilt twice on field evidence

1. **Adopt the WHOLE mod shell.** A funky-style mod carries its body as `body`/`interior`/`glass`/
   `chrome`/`tail` sub-meshes under the chassis; the `_ok`-only adoption dismantled the sheriff. The
   game renders every clump atomic — so does the conversion now; only `_dam`/`_vlo` stay out. Door glass
   hangs under its DOOR (nearest carried ancestor), swinging with it.
2. **Variant containers show ONE mesh.** `f_extras`/`f_class` (ten roof lightbars each on the sheriff)
   take the first variant; year-variant subtrees (`_[1991]:2` — the mod's own `}` typo tolerated) are
   ALTERNATIVES to carried base parts and are never adopted (the taxi stacked three door sets).
3. **SHIM frames beat vertex bakes.** Anim channels drive a bone's LOCAL relative to its PARENT — an
   un-animated shim between bone and parent absorbs the whole donor delta (hinge, track, wheelbase,
   junk-space chassis) while the bone keeps the vanilla local the anims replay. Doors open around MOD
   hinges (bakes broke exactly there), wheels stand on MOD corners including the 35 cm wheelbase delta
   nothing could bake (orbit), geometry rides untouched. Stock donors ⇒ zero shims.
4. **LEFT wheels of identity-rotation templates need a MIRRORED geometry copy** (x flip + triangle
   rewind): their anims replay identity, so nothing else can mirror the shared wheel — the dish faced
   outward. And a derived copy must NEVER alias the source's dedupe slot (whichever side emitted first
   handed its geometry to the other — the asymmetric splayed-wheels round).
5. **Missing template parts fall back to the DUMMY's `_ok` child, whatever its name** — the game keys
   components by dummy, and the taxi mod ships `door_lr_ok` under `door_rr_dummy` (copy-paste misname):
   gameplay works, the cutscene channel bound to nothing, the door never opened.
6. **The decisive instrument was reading the cutscene anims themselves**: `anim/cuts.img` IFPs are the
   old ANPK format (engine parser is ANP3-only); a new kept script
   (`scripts/debug/cutscene-anim-channels.ts`, row in `docs/debug/README.md`) lists per-object channels
   with keyframe kinds. Ground truth recorded: EVERY bone gets a NAME-bound channel (2-frame static
   KRT0s included) — the vanilla-locals-as-bind-pose rule is not optional; wheels spin via KR00 on the
   MESH bones; the intro vehicles live in `prolog1/prolog3`, not `intro*`.

**Remaining scope for this gate's fleet:** further story cutscenes ride ongoing play (steps 10/11 close
the loop); paint = stock carcols until the full pipeline supplies the mod palettes (step 11).

---

## Step 8 (P2) — bike branch (`rig/bike.ts`, csmtbike92)

- [ ] Template from vanilla csmtbike92 (bone ids for `chassis`, `wheel_rear`, `chainset`, `pedal_l/r`,
      `handlebars`, `forks_front`, `wheel_front`; note `wheel_front` parents under `forks_front`).
- [ ] Transform from the mod bmx rig: same drop/collapse machinery as cars, bike part vocabulary; wheels
      are already distinct parts (no duplication step).
- [ ] Policy for the Smooth Criminal pack's procedural frames (`f_class:*`, `f_extras:*`, `a_drt=*`,
      `f_fpeg*`): meshes parented under kept parts are baked into that part's geometry only if trivially
      possible at chunk level, otherwise dropped + logged. Decide on the real file, record the choice.
- [ ] Golden diff vs vanilla (stock bmx donor) + field appearance in a bike cutscene if one is reachable;
      otherwise structural verification stands and the gap is named here.

**Record:** parts kept/dropped for the real mtbike mod.

---

## Step 9 (P2) — boat branch (`rig/boat.ts`, csdinghy)

- [ ] Template from vanilla csdinghy (`boat_hi`, `boat_rearflap_left/right`; root `dinghy`).
- [ ] Transform from the mod boat rig: keep `boat_hi` subtree parts that match the template; the mod's
      `static_prop`/`moving_prop`/`movsteer` meshes under kept parts follow the same bake-or-drop policy
      as step 8.
- [ ] Golden diff vs vanilla (stock dinghy donor).

**Record:** parts kept/dropped for the real dinghy mod.

---

## Step 10 (P2) — full-fleet run, budget numbers, docs

- [ ] Full 23-model emit over the real mod set; converted-vs-vanilla structural diff green for all.
- [ ] Numbers into `docs/benchmarks/` (per its schema): cutscene.img size before/after, per-model DFF
      sizes, total TXD bytes, tool wall-clock.
- [ ] `docs/commands.md`: the CLI row. `docs/gta-sa-original/`: the txdcut.ide findings (typo row, two
      missing rows, csandrom92 dead entry) — facts about the original game discovered here, recorded in
      the same change per the standing rule.
- [ ] Central `docs/plans/README.md` row updated (already points here); this doc's step ledger closed
      with measured numbers.

---

## Step 11 (P2) — pipeline integration + acceptance

- [ ] Wire into the build pipeline after vehicle-installer (pmb stage or documented manual step — decide
      with the user; the tool must read the INSTALLED game, not the raw base, for carcols/TXD closure).
- [ ] Full pipeline build → field acceptance run (user): story progression across at least LS-era
      cutscenes with the full fleet; verdict recorded.
- [ ] Close-out: audit note if the chain qualifies as a big rework (per CLAUDE.md), else the step-10
      numbers stand.

---

## Risks and open questions (tracked, none blocking start)

1. ~~**Left-wheel mirroring mechanism**~~ **SETTLED (step 2 probe)**: 180° about z on the wheel MESH
   frame, identity on the node — measured on csbobcat92 + csremington92, encoded in `rig/matrix.ts`.
2. ~~**Shared vs duplicated wheel geometry**~~ **SETTLED (gates 4+7)**: shared geometry field-passed
   both gates; the only derived copies are the mirrored LEFT wheel (identity-rotation templates) and —
   a hard rule from the splayed-wheels round — a derived copy NEVER aliases the source's dedupe slot.
3. ~~**Hierarchy node flags semantics**~~ **SETTLED (step 2 probe)**: `flags = (siblings follow ? 2 : 0)
   | (leaf ? 1 : 0)` in DFS order reproduces all five vanilla tables verbatim — recomputed at emit, never
   copied, so partial hierarchies stay consistent.
4. ~~**Cutscene animation coverage**~~ **SETTLED (gate 7 + the ANPK reader)**: anims carry a NAME-bound
   channel for every VANILLA bone; extra bones (shims, adopted) are simply un-animated, missing bones
   simply unbound — both field-proven. The real coverage risk turned out to be the inverse: a mod
   MISNAMING a part leaves its channel unbound (the taxi door) — the dummy-keyed fallback covers it.
5. **cutscene.img growth** — MB-scale mod DFFs × 23 entries; gate-7 self-contained build measured
   **306.7 MB** (pipeline empty-TXD route will be far smaller); recorded fully at step 10. No target
   ceiling is implicated (001 restrictions check); if the size offends, `--only` ships a subset.
6. ~~**Vanilla wheel-node junk meshes are not emitted**~~ **SETTLED (gates 4+7)**: nothing needed an
   atomic-per-bone; both gates passed without them.
