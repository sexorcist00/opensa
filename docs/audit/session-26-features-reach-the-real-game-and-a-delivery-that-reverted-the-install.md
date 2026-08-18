# Session 26 (2026-08-18): features reach the real game, and a delivery that reverted the install

**On `main`, 7 commits after `710ef278` (session 25's audit), tree clean; tsc + eslint clean; full suite
502 files / 4 598 green with the ONE pre-existing red (`model-osm-uv-anim` times out at 5 000 ms under
full-suite load, predates session 23). 41 commits ahead of origin — push is his call.** The session did what
it set out to do (plan 011, all five steps, field-accepted) and then paid for a boot crash that had nothing to
do with it: the same delivery reverted the install's FLA ID pools. Both are now closed, and so is the class
behind the second one.

## What changed

| area | change | commit |
| --- | --- | --- |
| `packages/renderware` `vehicle-features.parser.ts` (+ barrel, tests) | **The shared vocabulary module** — `VEHICLE_FEATURE_TOKENS` (15 tokens → their stock carriers), `saCarrierFor(tokens)` (prefer one carrier covering everything, else best cover with the rest as `dropped`, ties by table order), `saAbilitiesOf(model)`, `vehicleFeatureToken(spelling)`. 16 tests. Plan 011 step 1 **and** 098/02's first step: one module, both targets | `c2ae49c2` |
| `tools/vehicle-installer/src/special-features.ts` (+ install/rebake wiring, 14 tests, +2 e2e, +1 rebake test) | **A mod's `features.txt` reaches the REAL game.** On the `sa` target the installer writes `<model> <stock carrier>` into fastman92's `data/model_special_features.dat`: foreign lines kept verbatim, ours in ONE marked and TERMINATED block sorted by model (byte-identical rebuild), a `--rebake --only <car>` speaks only for the cars it rebaked. Six warnings, every one of them silent in the game otherwise | `1844157a` |
| `docs/contracts/vehicles.md` | §1 becomes the FULL 15-token vocabulary with the `sa` carrier and the OpenSA state per token; §2 gains the `model_special_features.dat` row (what a misspelling does, what the log says, what is written when the slot already carries the ability) | `1844157a` |
| `docs/open-issues/mod-inst-rows-folded-before-their-ide.md` (+ README row) | **New open issue, root cause pinned, not fixed**: `mergeGtaDat` appends a mod's `IDE`/`IPL` refs, then the slot fold moves its `inst` rows into stock hosts — so `LAs.ipl` (gta.dat line 93) places id 12780 whose `missing smokes fix.ide` sits at line 158. 39 rows on that id. modloader masks it by supplying the mod IDEs itself | `dca632f9` |
| `docs/open-issues/fixed/sa-boot-crash-fla-pools-reverted-by-delivery.md` (+ README row), `reference-install.md`, `reference-install-config.md`, `restrictions/sa-target.md` | **The boot crash, closed.** The delivery copied the whole tree ROOT, so `mods-src`' copy of `fastman92limitAdjuster_GTASA.ini` — which never got the 2026-08-10 field raise — took the install from `TXD 6000 / COL 400 / IPL 1024` back to `5000 / 280 / 256` against a build carrying 5 177 `.txd` archives. Raised in `mods-src` (local, gitignored) and recorded in the docs (committed); the delivery trap and the rule are written where a plan will read them | `1cd2ecf9` |
| `tools/vehicle-installer/docs/plans/011-model-special-features.md` | **DONE, all five steps**, with the resolver census, the three decisions the plan did not fix, the real-tree dry run, and the field verdict | `1844157a`, `649acccd`, `1cd2ecf9` |
| `docs/gta-sa-original/vehicle-special-features.md` | The field answers: **FLA does remap a STOCK model id**, the file is read per boot, and the loader's own log lines (including the per-name "does not exist" warning) | `1cd2ecf9` |
| `tools/perfect-map-builder/src/pipeline.ts` (+ 6 tests) | **The guard stops carrying pool constants.** `flaIdPools()` reads `FILE_TYPE_TXD/COL/IPL` off the adjuster ini the build SHIPS into the tree root; a `#`-disabled line, an unapplied `Apply ID limit patch` and a missing ini all fall back to FLA's defaults, said out loud, which is the strict direction. Every log line and failure names the file | `8ccb4f7d` |

## What it cost / what it bought

- **Plan 011 cost about an hour** (three commits, 33 tests) and one 40-second `--rebake --kind sa --only <nine
  cars>` instead of a 10-minute build. The block it produced matched the user's worked example line for line,
  and the field verdict came back the same hour: the features work.
- **The boot crash cost the rest of the session, four field boots and one full rebuild (11 m 28 s).** Six
  hypotheses were falsified before the cause was found, and the two facts that would have pointed at it were
  already on disk: the build's own `report-sa.json` (`TXD archives: spent 5177, ceiling 5000`) and FLA's log
  line `Number of memory changes made` (3632 against the working install's 3712). **Nobody had read either.**
  Both are named in the write-up as the first things to read after a delivery.
- **The rebuild bought a fact worth keeping**: a fresh `sa` build at HEAD produced `gta3.img`, `gta_int.img`,
  `player.img`, `cutscene.img`, `vehicles.img` and `vehicles2.img` **byte-identical** to the delivered tree.
  The pipeline is deterministic on real data, the tree was never damaged, and session 23's mods-folder
  renumbering is proven to change nothing in the install result. `build/original-repro` was deleted after the
  comparison.
- **Two instruments were paid for and are worth reaching for again**: the reversed source resolves a crash
  address (`0x0074E79A` → inside `_rpMaterialListStreamRead`), and the bottle's own logs carry a boot timeline
  (CLEO's registration lines end 5 s before the exit, modloader's last line is only where ITS logging stops).
- One self-correction inside the session: a throwaway script read the archive FAMILY twice and reported
  5 511 `.txd` where the truth is **5 177** — the number the build report had printed all along. Corrected in
  five documents.

## What the session settled

- **A mod car's declared ability now works on the real game**, by the only lever the install has: a model id.
  `feltzer` gets the ZR-350's pods, `bullet` hotknife hydraulics, `infernus` the BF engine — nine slots, all
  stock, which answers the plan's open question: FLA's loader is not limited to added ids.
- **The adjuster ini is a BUILD OUTPUT.** It lives in `mods-src`, the mods stage installs it into the tree
  root, and any delivery of the root carries it into the install. A pool raised only in the bottle is a pool
  that survives exactly until someone delivers the root — and `mods-src/` is gitignored, so the committed
  protection is the number in `reference-install-config.md` plus a guard that reads the ini in force.
- **A guard number ABOVE the install's is silent by construction.** The old constants were right about a
  bottle and wrong about the build; the new reader is right about whatever the tree ships, or strict when it
  cannot tell.
- Delivering the whole tree root also **deletes** what the tree has no copy of (the bottle's `logs/` went that
  way) and replaces every plugin ini. That belongs in the delivery rule, and now is.

## Left for session 27 (his order)

1. **Fix the fold/IDE ordering** (`docs/open-issues/mod-inst-rows-folded-before-their-ide.md`): splice mod
   `IDE` lines before the first `IPL` line, then guard the pair positions in `gta.dat` at build time, then
   re-check with modloader OFF — the only configuration that reports the fault. A restriction row follows the
   fix.
2. His items: push (41 commits ahead), re-upload the cutscene-converter zip if that is still open.
3. Standing: `docs/plans/098-all-land-vehicles/02` can now start from its second step — the shared module it
   waited for is in.
