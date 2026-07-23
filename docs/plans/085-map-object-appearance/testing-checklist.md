# 085 — field-testing checklist (2026-07-22 batch)

The user's reminder list: everything shipped this round and HOW to verify each item in game.
Two groups: what works on the CURRENT pak right now, and what needs the NEXT pak rebuild first.

## Needs NOTHING (test on the current build right away)

- [ ] **Missing-texture highlight toggle (row B, engine half)** — F2 → Map → "Missing Textures:
      magenta ON/OFF". On the CURRENT (old) pak the button exists but has nothing to repaint (no
      `missingLayers` in the old manifest) — just confirm it doesn't crash. Real check after rebuild.
- [ ] **Ten Green Bottles ground glow (row E / 078 #11): CLOSED for this iteration 2026-07-23** — the
      restore stays reverted; the wanted behaviour is now specced as blink-synced 2dfx point lights,
      deferred to `docs/ideas/0.6.0/plans/04-graphic-improvements/04-2dfx-real-lights.md`. Nothing to test.

## Needs the NEXT pak rebuild (pmb full run) first

Rebuild reminders: `mods-src/original/mods/39. Green Piece 1.47` was deleted — re-baseline benchmarks, do not
compare against older paks. Expect 0 converter failures. `NODE_OPTIONS=--max-old-space-size=12288`.
Sanity: 1123 cells / ~1 GB / AO ~375 s. Also owed on this rebuild (078): map-objects stage time
(lazy-TXD), wheels on admiral/comet/petro (084).

- [ ] **Row A — neon rope palms** (`vgsn_nitree_r01`, LV strip / user's palm spot): at night the
      red/pink rope spiral GLOWS (was: only the trunk lit). Blue (`b01`) ropes glow at full strength too.
- [ ] **Row B — missing textures render grey, not magenta**: visagesign04's arch (LV Visage) turns
      untextured grey like prod. F2 magenta toggle now paints exactly the broken spots. `report.json`
      → `textures.missing` lists every failed name WITH the models — the user triages the mods from it
      (known-broken data: mod 42 names `_257` textures that exist nowhere).
- [ ] **Row C — additive neon** (`vgncircus2neon`, Circus casino + the whole LV strip's flags-0x8
      overlays): night dressing ADDS light onto the buildings (was: dull). Check 22:00–06:00.
- [ ] **Row D — night-only timed models** (`casinoblock41_nt`, Fremont): the facade runs FULLBRIGHT
      after the 22:00 swap (was ~18 % brightness) **and the stripes SCROLL down** (kind 5 — the scroll
      also stops showing by day and no longer double-draws at night).
- [ ] **Row F — the magenta roster resolves**: the 28-model list (top: `bonaventura_lan`, `sw_block02`
      @1282,373, `triadcasno01_lvs` roofs @1955,1011, `subpen_crane_sfse` @−1744,−1784, `vgnlowbuild13`
      @2551,2019, `lacnchasgn*_lvs` La Conca @2445,1500, `noodlecart_prop`, `ferris01_law2`…) now pulls
      the real texels through the global by-name index. Spot-check those six positions; `report.json`
      → `textures.crossTxd` names every donor, `textures.missing` should shrink to genuinely absent
      names (mod 42's `_257` set).
- [ ] **084 vehicle round (2026-07-22, still unverified in field)**: AO under cars, indirect level,
      reflectivity gate, extras at spawn, matte tyres on admiral/comet/petro (the wheel fix rides
      `.osm` DESC — old paks keep the bug).

## Field results 2026-07-22 late (first run on the rebuilt pak)

- [x] Row A neon palms — confirmed. Row C LV additive neon — confirmed. Row D Fremont fullbright +
      scroll — confirmed. Converter 0 failures, map-objects stage time good, pack ledger lines present.
- [x] Row G radar — spawns AND rotates now; the "no texture" black dish is the MOD'S OWN near-black
      `ap_radar` texture (byte-faithful in the pak — see the plan's row G). Data decision owed.
- [ ] Row B (grey stand-ins + F2 magenta + report triage) and row F (six magenta-roster spots) — still
      to check this run.
- [x] Wheels: tyre rubber matte, no specular glint — CONFIRMED by the user 2026-07-23.
- Row H (LV facade "holes") — TRACED + FIXED 2026-07-23 (see the plan): day/night probe answered
  (day clean, night holes), vanilla check answered (solid facade in the original build). Cause: row C's
  additive class on `casinoblock3_nt`'s DXT1 no-alpha textures; fix: class 4 only for alpha materials
  (weld `classOf`). NEXT REBUILD: at the Old Venturas Strip entrance (~2110, 2076) at 23:30–04:00
  expect a solid black fascia band under the pink arches, fullbright bulb canopies, no see-through;
  the dark sloped marquee silhouette IS vanilla (authored roof10L256 night prelit 12/15/13).
- 084 row 0: comet door AO smudges — first fix (`4d8c03a`) field-checked 2026-07-23: comet ± unchanged,
  admiral grew NEW night speckles (bonnet/grille dots, window-frame line; visible only after ~20:00 =
  the AO-in-indirect channel). SECOND fix in the shared builder: own-panel near-clearance + neighbour
  despeckle — offline A/B in plan 084 ("2026-07-23 — the night-speckle iteration"), admiral bonnet
  below-100 733→0. Needs the next rebuild (or a method-5 spot rebake) to field-verify AT NIGHT.

## Open / parked (no action until the user speaks)

- Row E ground glow — CLOSED for this iteration 2026-07-23: spec captured (blink-synced 2dfx point
  light, mod-19 authored), deferred to
  `docs/ideas/0.6.0/plans/04-graphic-improvements/04-2dfx-real-lights.md` (see the plan's row E).
- Row G data decision — RESOLVED 2026-07-23: the user deleted mod "46. Animated Radars" ENTIRELY
  (model + texture + animation). Next rebuild restores the stock static red radars at all 4 airport
  placements (id 1682: SF −1691.6/−619.7 · LV 1294.9/1502.6 · LS 1663.6 & 1709.4/−2362.7). Mod folders
  renumbered to a contiguous 0..54 (new `renumber-mods` skill) — the baseline changed, re-baseline any
  perf/size comparison on the next pmb run.
- Mod 42 data decision — patch `_257`→`_256` in visagesign04.dff or restore the mod's TXD (user said:
  leave the mod alone for now). NOTE: after the 2026-07-23 renumbering this mod is now
  "40. Animated texture (24 hours Las Venturas)".
