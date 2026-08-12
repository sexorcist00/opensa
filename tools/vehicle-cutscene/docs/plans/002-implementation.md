# 002 — implementation: mod vehicles into cutscene.img

**Status: PLANNED 2026-08-12.** Execution plan for [001-architecture](001-architecture.md). Steps are
ordered by priority and dependency; each is individually shippable and ends with verification + a numbers
slot (standing rule: a phase without its numbers is unfinished). The vanilla-parity gate (step 4) is the
load-bearing verification of the whole tool: convert a STOCK car and diff it against the vanilla cutscene
model R* shipped — before any mod is involved.

Priorities: **P0** = the tool exists and provably transforms a car; **P1** = the output is visually
correct in the field; **P2** = full fleet coverage (bike/boat, all 23) and pipeline integration.

---

## Step 1 (P0) — scaffold + census + inspect

The read path: know the slots, match the mods, report readiness. No writes.

- [ ] Scaffold `tools/vehicle-cutscene/`: `package.json` (`@opensa/vehicle-cutscene`, nx tag
      `type:tool`), `readme.md`, `src/cli.ts` with `--game/--in/--out/--only/--inspect` validation
      (mirror `vehicle-installer/src/cli.ts` arg handling verbatim).
- [ ] `census.ts`: derive the cs-vehicle table from the `--game` tree — scan `models/cutscene.img` names,
      parse `data/vehicles.ide` (all sections that name land/boat models) and `data/txdcut.ide`, match by
      **stripped stem against the 8-char IDE model name with exact-match priority over prefix** (the
      `csfirela`→`firela`-not-`firetruk` and `csremington92`→`remingtn` traps from 001). Explicitly:
      exclude non-vehicle `cs*` entries (no IDE match), report dead txdcut rows (`csopcarla`,
      `csandrom92`) and missing rows (`cscopcarsf`, `csdinghy`).
- [ ] Match census slots against `--in` mod folders (`<model>.dff/.txd` present) → per-slot status:
      `ready` / `no mod` / `mod incomplete`.
- [ ] `--inspect` prints the table (slot, cs name(s), donor mod, branch car/bike/boat, status).
- [ ] Tests (real fixtures via the manifest, one line each: vanilla `cutscene.img` slice or the individual
      cs DFFs + `vehicles.ide` + `txdcut.ide`): negative describes first — unknown `cs*` entry is not a
      vehicle; dead txdcut row reported; then positive — 23 models, 21 slots, csho excluded.

**Verification:** `--inspect` over `game-src/original` + `mods-src/original/vehicles` lists 23 cs models
/ 21 slots, all `ready`. **Record:** the printed census table into this doc.

---

## Step 2 (P0) — template extraction + car rig transform

The heart of the tool. Input: mod DFF (game rig) + vanilla cs DFF (template). Output: converted cs DFF.

### 2a — template (`template.ts`)

- [ ] Parse the vanilla cs model per slot and extract: root frame name; the part list with **canonical
      names** (strip `_hi` — `bonnet_hi_ok` ≡ `bonnet_ok`; wheel-node aliases `Box01`/`wheel_lf_node`/
      `axis_lf`/`wheelLFNode` normalise by position sign, not by name); bone id **per canonical part**;
      the hierarchy table node order + flags (copied raw from the vanilla root); per-slot vertical rebase
      delta (below); wheel-node frames' rotation matrices (the left-wheel mirroring answer — measure,
      then encode what vanilla actually does).
- [ ] Ground-plane formula, fully derived: `shift_z = (van_cs_wheel_node.z − van_wheel_radius) −
      (mod_wheel_dummy.z − mod_wheel_radius)` where each radius is the wheel geometry's bbox half-height.
      Applied to every root-child frame position. Bobcat check: vanilla-on-vanilla yields shift 0.900
      exactly (0.349 radius + |−0.550| axle, measured in 001).
- [ ] Tests: negative — a template missing `chassis` throws; positive — bobcat template reports root
      `bobcat_dummy`, chassis bone 9, 19-entry hierarchy; remington reports chassis bone 1 (the
      inconsistency is the point of reading it from the file).

### 2b — frame surgery over rw-codec chunks (`rig/car.ts` + shared)

Chunk-level clump rebuild via `readRw`/`writeRw` — geometry/material/atomic chunks byte-copied from the
mod, frame list and atomic→frame/geometry indices rewritten:

- [ ] Drop list: `*_dam`, `chassis_vlo`, `ug_*`, `ped_*`, `engine`, `exhaust` (dummy — `exhaust_ok` the
      part stays if the template has it), `headlights`, `taillights*`, `petrolcap`, `bargrip`,
      `misc_*` unless the template carries a matching part.
- [ ] Hinge collapse: each kept movable part (`door_*_ok`, `bonnet_ok`, `boot_ok`, `bump_*_ok`,
      `windscreen_ok`, `exhaust_ok`, `extra*`) is reparented to `chassis` with frame transform =
      compose(dummy transform, own transform) — for stock-shaped mods own is identity and the result
      equals the dummy transform, matching 001's measurement. Non-identity `_ok` transforms compose
      instead of being silently kept (the `dump-vehicle-rig` trap).
- [ ] Part-set policy = **template ∩ mod**, by canonical name: template part missing in the mod → drop
      the bone from the emitted hierarchy (the hand-made pack proves partial hierarchies work) + log;
      mod part absent in template (e.g. extra tuning meshes) → drop + log. `extra1/extra2` follow the
      same rule (vanilla cs keeps them as separate bones — show/hide is the animator's job).
- [ ] Wheels: read the mod's single `wheel` geometry + the four `wheel_*_dummy` positions; emit four
      wheel nodes at those positions (z shifted per 2a) with the template's per-node bone ids and the
      vanilla nodes' rotation matrices (left-side mirroring exactly as vanilla does it); four atomics.
      Decision recorded here after measuring: duplicate the geometry chunk 4× like vanilla, or share one
      geometry across atomics if the format allows — try shared first, fall back to duplicate.
- [ ] Root: rename to the template's root name; add the empty top frame (vanilla has a nameless frame 0).

### 2c — HAnim emit (`hanim.ts`)

- [ ] Write the HAnim plugin (0x11E) into each kept frame's extension: version 0x100, bone id from the
      template; the root additionally carries the hierarchy table (node count, per-node id/index/flags —
      flags copied from the vanilla template, order = our emitted depth-first order).
- [ ] Tests: negative — emitting a hierarchy whose ids duplicate throws; positive — parse-back via
      `@opensa/renderware` yields the same boneId per frame name as vanilla for a stock conversion.

**Verification (the golden structural diff):** convert STOCK `gta3.img` bobcat, taxi, zr350 → compare
against vanilla csbobcat92/cstaxi92/cszr350: same canonical part set (minus documented vanilla
extras/differences), same bone id per part, frame positions within 1e-3, wheel radius byte-equal. This is
a committed test, not a one-off. **Record:** per-model diff summary (parts matched / dropped / positions
max delta) into this doc.

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

1. **Left-wheel mirroring mechanism** — presumed 180° z-rotation; measured from vanilla matrices in 2a
   before any wheel is emitted.
2. **Shared vs duplicated wheel geometry** — try shared (smaller), vanilla duplicates; the parity gate
   decides.
3. **Hierarchy node flags semantics** (PUSH/POP in the HAnim table) — copied from vanilla templates;
   our emitted tree order must be made consistent with the copied flags, or flags recomputed by the
   standard depth-first rule. Settled in 2c with a parse-back test.
4. **Cutscene animation coverage** — if a scene animates a part the donor lacks (dropped bone), the part
   simply doesn't move/exists; the hand-made pack shipped with 9 of 19 bones and field-passed. Watch at
   gates 4/7.
5. **cutscene.img growth** — MB-scale mod DFFs × 23 entries; recorded at step 3/10. No target ceiling is
   implicated (001 restrictions check); if the size offends, `--only` ships a subset.
