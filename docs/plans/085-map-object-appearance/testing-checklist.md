# 085 — field-testing checklist (2026-07-22 batch)

The user's reminder list: everything shipped this round and HOW to verify each item in game.
Two groups: what works on the CURRENT pak right now, and what needs the NEXT pak rebuild first.

## Needs NOTHING (test on the current build right away)

- [ ] **Missing-texture highlight toggle (row B, engine half)** — F2 → Map → "Missing Textures:
      magenta ON/OFF". On the CURRENT (old) pak the button exists but has nothing to repaint (no
      `missingLayers` in the old manifest) — just confirm it doesn't crash. Real check after rebuild.
- [ ] **Ten Green Bottles ground glow (row E / 078 #11): NOT fixed, intentionally** — the restore was
      reverted on the user's call. Nothing to test; the precise wanted behaviour is owed.

## Needs the NEXT pak rebuild (pmb full run) first

Rebuild reminders: `mods-src/mods/39. Green Piece 1.47` was deleted — re-baseline benchmarks, do not
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
- [ ] Wheels: tyres must show NO specular glint (rubber matte, rims may shine) on admiral/comet/petro.
- New batch: row H (LV facade "holes", vgsn_blucasign/vgnlowmall3) — see the plan; user probe owed:
  do the holes survive by day? Plus 084 row 0: comet door AO smudges FIXED offline, needs a rebuild
  (or spot rebake) to verify.

## Open / parked (no action until the user speaks)

- Row E ground glow — user owes the precise description (078 ledger #11).
- Row G data decision — keep mod 46's dark radar texture, or delete the mod's `ap_misc1bit.txd` to
  restore the stock red look (rebuild required).
- Mod 42 data decision — patch `_257`→`_256` in visagesign04.dff or restore the mod's TXD (user said:
  leave the mod alone for now).
