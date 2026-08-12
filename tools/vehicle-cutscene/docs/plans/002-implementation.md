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

## Step 3 (P0) — game emit (`install.ts`)

Needed this early so step 4 can run in the field.

- [ ] Copy `--game` → `--out` (vehicle-installer's wiped-and-rebuilt pattern), rebuild
      `models/cutscene.img` via tool-kit `EditableImg`: replace the converted `cs*.dff` entries (+ TXDs,
      step 6; until then vanilla TXDs stay).
- [ ] Patch `data/txdcut.ide` in `--out`: add `cscopcarsf, copcarsf` and `csdinghy, dinghy`, fix the
      `csopcarla` typo row to `cscopcarla, copcarla`. (Data rows only — no pool impact, per 001's
      restrictions check.)
- [ ] `--only` limits conversion to named slots (iteration speed).

**Verification:** rebuilt game tree diffs from base ONLY in `models/cutscene.img` + `data/txdcut.ide`;
archive opens and round-trips. **Record:** cutscene.img size before/after.

---

## Step 4 (P0) — FIELD GATE: vanilla parity

The strongest possible check of the transform, zero mods involved: convert the STOCK gta3 cars onto their
cs slots and play the intro. If the transform is right, the cutscene is near-indistinguishable from
vanilla (same-generation models, gameplay-grade paint instead of baked '92 colours being the only
expected difference).

- [ ] Build `--out` from stock donors (`--game game-src/original --in <stock-extracted>` or an internal
      parity mode), full pipeline into a bootable install.
- [ ] Field run (user): new game → intro cutscenes (cstaxi92/csbobcat92/cscopcarla92 all appear in the
      opening sequence); verdict on: cars present, on the ground, wheels in place, doors animate where
      the scene animates them, no missing textures.

**STOP point — work does not proceed past this gate without the field verdict.**
**Record:** the verdict verbatim + screenshots reference; any deviation becomes a step-2 fix before P1.

---

## Step 5 (P1) — materials: paint bake + plate closure

- [ ] `materials.ts`: read the slot's `carcols.dat` colour rows from the **built** data (the merged
      result of vehicle-installer — a mod's own palette must win; field-run rule: the built `data/*` is
      the truth). Bake colour 1 of the first row into every primary-marker material (60,255,0), colour 2
      into secondary (255,0,175); handle the tertiary/quaternary markers (255,255,0 / 0,255,255) the same
      way if the mod uses them. Preserve material alpha (glass at 77/128 stays glass).
- [ ] Keep `carplate`/`carpback` materials untouched (resident vehicle.txd resolves them — vanilla
      proves it).
- [ ] Tests: negative first (a marker colour with no carcols row for the slot throws), then bake
      correctness on a real mod DFF fixture.

**Verification:** converted savanna carries its carcols colour on body materials; grep of emitted
materials finds zero paint-marker RGB values. **Record:** per-slot count of baked materials.

---

## Step 6 (P1) — TXD policy + texture closure

- [ ] Emit an **empty** `cs*.txd` per converted slot (kilobytes; txdp does the work — the 001 research).
- [ ] `txd.ts` closure check, fail-loud per slot: every texture name referenced by the converted DFF must
      resolve in (mod's installed TXD under the parent name) ∪ (generic `vehicle.txd`) ∪ (`carplate`,
      `carpback`). Unresolvable → error listing the names, slot skipped.
- [ ] Fallback behind `--self-contained-txd`: copy the mod TXD bytes into the cs TXD for slots where
      closure needs it (not expected; the flag documents the escape hatch instead of a silent fallback).
- [ ] Tests: negative — a DFF referencing a texture absent everywhere fails the slot with the name in the
      message; positive — bobcat mod closure resolves fully with an empty TXD.

**Verification:** all 21 slots pass closure with empty TXDs on the real mod set. **Record:** total TXD
bytes emitted vs the hand-made pack's 11.5 MB-per-car baseline.

---

## Step 7 (P1) — FIELD GATE: modded cars in cutscenes

- [ ] Full run over `mods-src/original/vehicles`, all 21 slots, into a bootable install (vehicle-installer
      first, then this tool — order matters: closure checks read the installed TXDs).
- [ ] Field run (user): intro sequence (taxi, bobcat, copcarla '92 slots now modern customs) + one
      Los Santos story cutscene with savanna/voodoo/greenwood; verdict on paint, plates, ground contact,
      door animation.

**STOP point — same rule as step 4.** **Record:** verdict + screenshots reference.

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
2. **Shared vs duplicated wheel geometry** — SHARED emitted (step 2 decision); the parity gate (step 4)
   arbitrates, fallback is a 4× copy.
3. ~~**Hierarchy node flags semantics**~~ **SETTLED (step 2 probe)**: `flags = (siblings follow ? 2 : 0)
   | (leaf ? 1 : 0)` in DFS order reproduces all five vanilla tables verbatim — recomputed at emit, never
   copied, so partial hierarchies stay consistent.
4. **Cutscene animation coverage** — if a scene animates a part the donor lacks (dropped bone), the part
   simply doesn't move/exists; the hand-made pack shipped with 9 of 19 bones and field-passed. Watch at
   gates 4/7.
5. **cutscene.img growth** — MB-scale mod DFFs × 23 entries; recorded at step 3/10. No target ceiling is
   implicated (001 restrictions check); if the size offends, `--only` ships a subset.
6. **NEW (step 2 finding): vanilla wheel-node junk meshes are not emitted** — the degenerate 24-vert
   boxes under Box/node frames are export leftovers; if the parity gate shows anything relying on an
   atomic-per-bone, emit them back.
