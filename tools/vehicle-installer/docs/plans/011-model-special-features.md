# 011 — `model_special_features.dat` for the `sa` target (a mod car's `features.txt` reaches the real game)

**Status: IN PROGRESS 2026-08-18 (the user's ask) — step 1 (the shared vocabulary module) is BUILT, steps 2-5 are not.** The OpenSA half of the same declaration is
[`docs/plans/098-all-land-vehicles/`](../../../../docs/plans/098-all-land-vehicles/readme.md) (02 + 06) —
this plan is the REAL-GAME half, and the two share one vocabulary table (step 1).

## What this is about

A vehicle mod declares what its model can DO beyond geometry in a `features.txt` (the Modloader/IVF
convention — `docs/contracts/vehicles.md` §1). Nine of the original's 212 mod cars ship one today
(`ADV_HYDRALICs` ×2, `BF_ENGINE&HYDRALICS` ×3, `UP/DOWN_LIGHTS` ×4). The installer already READS it
(`apply-vehicle.ts` → `parseFeatures`) and writes `data/vehicle-features.txt` — **an OpenSA file the real game
never looks at**. On the `sa` target the declaration therefore evaporates: a mod SL-Class in the `feltzer` slot
has pop-up pods and no way to open them, because in SA every special ability is hardcoded to a MODEL ID.

The real install has exactly one lever for that, and it is already on: **fastman92's limit adjuster (mod
`6. fastman92 limit adjuster 6.5 (stable)`, `sa` layer) ships `data/model_special_features.dat` and its ini sets
`[SPECIAL] Enable model special feature loader = 1`.** The file is `CustomModelName StandardModelName`, one
pair per line: the named model behaves like the standard one — a `feltzer zr350` line gives whatever sits in
the `feltzer` slot the ZR-350's pop-up lights (`docs/gta-sa-original/vehicle-special-features.md`). The mod
ships it EMPTY (one commented example), so today nothing maps.

The user's worked example of the file we should be producing (2026-08-18):

```
bullet hotknife        # ADV_HYDRALICs
cheetah zr350          # UP/DOWN_LIGHTS
feltzer zr350
hotring hotknife
infernus bfinject      # BF_ENGINE&HYDRALICS
oceanic bfinject
rumpo bfinject
turismo zr350
uranus zr350
004veh bfinject        # added (non-slot) cars follow the same rule by their MODEL name
```

## The vocabulary (token → the stock models that natively carry it)

The FLA file wants a STANDARD MODEL, the mod declares a TOKEN — so there is a table between them, and it is
the same table 098/02 wanted from the VSA corpus. It is data, it is small, and it goes into the repo ONCE:

| Token | Stock carriers (any one of them is a valid `StandardModelName`) |
| --- | --- |
| `ADV_HYDRALICs` | `hotknife`, `bandito` |
| `BAGBOXA` | `bagboxa` |
| `BAGBOXB` | `bagboxb` |
| `BF_ENGINE&HYDRALICS` | `bfinject` |
| `BUCKETs` | `dozer` |
| `CISTERNs` | `cement` |
| `PACKERs` | `packer` |
| `TRACTOR_HOOKs` | `tractor` |
| `TRAILER_HOOKs` | `linerun`, `petro`, `rdtrain`, `artict3` |
| `TRUCK_HOOKs` | `towtruck` |
| `TUGSTAIR` | `tugstair` |
| `TURRETs_1` | `rhino`, `swatvan` |
| `TURRETs_2` | `firetruk` |
| `UP/DOWN_LIGHTS` | `zr350` |
| `WATER_JETs` | `firetruk`, `swatvan` |

Spelling is the IVF/Modloader one — the tokens keep their odd case and characters (`ADV_HYDRALICs`,
`BF_ENGINE&HYDRALICS`) because that is what mods in the wild write; `parseFeatures` upper-cases, so the
table is matched upper-cased. **The carrier list is a REFERENCE for the real game and a TEST ORACLE for
OpenSA's detectors (098/06) — never an ID list our own runtime keys on** (`docs/restrictions/assets-and-data.md`:
derive from the asset, not the slot).

## Steps

- [x] **1. One vocabulary module, shared by both targets.** DONE 2026-08-18. `packages/renderware/src/parsers/text/vehicle-features.parser.ts`
      already exports `UP_DOWN_LIGHTS`; it grows `VEHICLE_FEATURE_TOKENS` — the table above as
      `{ token, saCarriers: string[] }` rows, plus `saCarrierFor(tokens: string[]): { model: string; covers: string[]; dropped: string[] } | null`.
      Resolution: prefer ONE carrier that covers EVERY declared token (`swatvan` for `TURRETs_1` +
      `WATER_JETs`); otherwise the carrier covering the most tokens (ties → table order, deterministic), the
      uncovered tokens returned as `dropped`. Unknown tokens are neither an error nor covered — they flow
      through as today. Tests: full cover, best-partial with `dropped`, unknown-only → null, case folding.
- [ ] **2. The `sa` writer.** `install.ts` (and `rebake-sa.ts`, which re-merges settings in place) call
      `writeModelSpecialFeatures(outPath, features)` when the target is `sa`: read `data/model_special_features.dat`
      from the game tree (the FLA mod's copy, installed by mod-installer BEFORE the vehicle stage — pmb order
      `mods → vehicles`), keep every line that is not ours, and append/replace ONE marked block:
      `# --- vehicle-installer (features.txt → standard model), do not edit: rewritten on every install ---`
      followed by `<model> <carrier>` lines sorted by model, so a rebuild is byte-identical and a `--rebake
      --only <car>` MERGES (drops that car's old line, writes the new one) instead of rewriting the world.
      Model = the built model name — the slot for a replacement, the model name for an added car when
      add-vehicles arrives (the writer never asks WHY a name exists).
- [ ] **3. What is warned about, loudly, in the install log** (each is silent in the real game otherwise):
      - a car declares tokens but the tree carries no `data/model_special_features.dat` → the FLA mod is not
        installed for this target: warn once, naming the mod, write nothing (a file the adjuster does not read
        would lie about being applied);
      - the FLA ini in the tree has `Enable model special feature loader = 0`/absent → warn once (the file
        would be written and ignored);
      - a car's tokens are only PARTLY covered by one carrier → warn with `dropped`;
      - the SLOT itself is a stock carrier of some token the car does NOT declare (a mod in `firetruk`
        declaring only `UP/DOWN_LIGHTS` → `firetruk zr350` would REMOVE the truck's water jets and turret) →
        warn: remapping a stock special model loses its native abilities;
      - the slot already natively carries every declared token (`hotknife` + `ADV_HYDRALICs`) → no line, no
        warning (nothing to do).
- [ ] **4. Contracts, in the same change as step 2** (`docs/contracts/vehicles.md`): §1 `features.txt` — the
      table becomes the full vocabulary (token → meaning → what the `sa` build writes → OpenSA state, per
      098); §2 gains `data/model_special_features.dat` (`sa` target only; FLA's file, our marked block; a
      misspelled token is carried and IGNORED on both targets — visible only in the install log; a
      misspelled CARRIER cannot happen, the table owns them). `docs/gta-sa-original/vehicle-special-features.md`
      is written with this plan (the fact about the adjuster).
- [ ] **5. Field checkpoint (the user, CrossOver bottle):** deliver the built `data/` (`data/model_special_features.dat`
      + the ini as installed) and check ONE car per mechanism — `feltzer` (pop-up lights open with the
      headlights), `bullet` (hydraulics respond), `infernus` (BF engine + hydraulics). Two things a desk check
      cannot answer, recorded here whatever the answer: does FLA remap a STOCK id (`bullet`) or only added
      ids (its own example is `new_hydra`), and does the loader read the file per boot or per model load
      (a `--rebake` delivery may need a restart). Verdicts into the ledger; a NO on the first turns this plan
      into an `add-vehicles`-only feature and says so at the top.

## Verification

Headless: `install.e2e.test.ts` +3 (sa target writes the block into a fixture FLA file, opensa target writes
nothing, rebake `--only` merges), `features.test.ts` for the resolver, tsc + eslint; `docs/contracts/vehicles.md`
diff reviewed. Field: step 5. Every field verdict goes into the ledger below with the build it read.

## Ledger

**Step 1, 2026-08-18** — `VEHICLE_FEATURE_TOKENS` (15 rows) + `saCarrierFor` + `vehicleFeatureToken` in
`packages/renderware/src/parsers/text/vehicle-features.parser.ts`, exported from the text-parser barrel;
14 tests in `vehicle-features.parser.test.ts` (vocabulary guard, case folding, full cover, best-partial with
`dropped`, unknown-only → `null`, a real declaration through `parseVehicleFeatures`); `tsc` clean, the
renderware text parsers + vehicle-installer suites 38 files / 258 green.

Two decisions the resolver's callers stand on:

- `dropped` carries only VOCABULARY tokens the chosen carrier cannot cover. A token outside the vocabulary is
  in neither `covers` nor `dropped` — it is carried and ignored as everywhere else in the chain, so step 3's
  partial-cover warning reports a real loss of ability instead of every mod's typo.
- Ties are broken by TABLE order (the first row that mentions the carrier), so the written block is
  reproducible; the search stops early only on a full cover, so a later carrier that covers everything still
  beats an earlier one covering a subset.

**The resolver census over the nine cars that ship a `features.txt` today** (run against
`mods-src/original/vehicles/models`, single-token declarations throughout, nothing dropped) reproduces the
user's worked example line for line:

```
bullet hotknife     [ADV_HYDRALICS]
cheetah zr350       [UP/DOWN_LIGHTS]
feltzer zr350       [UP/DOWN_LIGHTS]
hotring hotknife    [ADV_HYDRALICS]
infernus bfinject   [BF_ENGINE&HYDRALICS]
oceanic bfinject    [BF_ENGINE&HYDRALICS]
rumpo bfinject      [BF_ENGINE&HYDRALICS]
turismo zr350       [UP/DOWN_LIGHTS]
uranus zr350        [UP/DOWN_LIGHTS]
```

(field verdicts per car and the FLA remap-stock-id answer: step 5, pending)
