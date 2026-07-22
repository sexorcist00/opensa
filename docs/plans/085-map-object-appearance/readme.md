# 085 — map-object appearance

**Status: OPENED 2026-07-22**, the field round the user queued after vehicles ([084](../084-vehicle-appearance/))
and before peds. Same method: the user reports what they see in game, each symptom is traced to data
(DFF → pipeline stage → pak bytes → shader) before any code is touched.

Scope: how a placed MAP OBJECT looks — prelight day/night, emissives, textures, alpha, LOD swaps.
Vegetation LOD impostors are lod-trees-generator's own plans; peds are the next round.

---

## Shipped in this round

### Row A — night emissive mask killed saturated neon (vgsn_nitree rope lights)

**Symptom (user, 2026-07-22):** `vgsn_nitree_r01` — the LV strip palm with a light-rope spiral. At night
the trunk glows but the rope itself stays dark pink/unlit. Model source: `mods-src/vegetation/`.

**Trace (the whole chain was checked, in order):**

- The mod DFF is authored correctly: rope night set avg 188 (max 225), rgb `188/37/62`; leaves night ~22.
  The STOCK model is the same shape: rope day `81/81/81`, night `255/49/49`.
- The pipeline was suspected of losing the night set (prelight bake in the trees stage) — it does not:
  `applyStockPrelight` replaces only the DAY prelit, and map-optimizer's conform-night runs BEFORE the
  vegetation swap so it never sees these models.
- The built pak (`build/perfect`) proved the night set SURVIVES: rope vertices carry night avg 188 — but
  their baked emissive byte is **0** while the bark next to them bakes 245. The bark glows, the rope
  doesn't — exactly the screenshot.
- Root cause: the emissive rule (offline in `weld.ts`, heuristic twins in the world + rigid shaders) used
  the **Rec709 luma** delta night−day. Saturated neon has low luma — the red rope's night luma (~92) barely
  beats its flat grey day (81): delta 0.046 < the 0.05 floor → mask 0. The blue tree (`b01`, night
  `48/156/205`) would half-glow; red/pink never glowed at all — a systematic bias against saturated colours.

**Fix (2026-07-22):** the delta is now the **max per-channel** difference night−day, in all three places
(`tools/opensa-pack/src/weld.ts` baked mask, `shaders.ts` world runtime heuristic, `shaders.ts` rigid glow).
Red rope: max delta 0.68 → full mask. Synthesized night sets (day × ambient) stay below day on every
channel → still mask 0, nothing new glows. Fixture: stock `vgsn_nitree_r01.dff` + txd
(`tests/original/dff/night-colours/`), test in `weld.test.ts` (rope ≥100 vertices at mask 255 — the luma
rule fails it; foliage stays 0).

**Field check: PENDING the next pak rebuild** — the mask is baked at pack time, the current
`build/perfect` pak still carries the luma-rule bytes.

---

### Row B — missing textures rendered as loud magenta instead of vanilla's untextured grey (visagesign04)

**Symptom (user, 2026-07-22):** `visagesign04` (the LV Visage skull sign arch) — the frame renders solid
purple; the animated LED screen inside it is fine. "Prod is fine." The model is modded
(`mods-src/mods/42. Animated texture (24 hours Las Venturas)/gta3_img/visagesign04.dff`).

**Trace:**

- Mod 42's DFF names `miragepillar2_257` / `miragesign1_257` / `miragesign2_257` on the arch (189+6+12 of
  231 verts). Those names exist NOWHERE — not in any mods-src TXD (only `_256` variants ship, e.g. mod 3's
  `skullsign.txd`), not in stock `gta3.img` (byte-searched). Mod 42 ships ONLY the DFF; its own TXD (which
  presumably carried the `_257` set) never made it into `mods-src`. The screen materials use `_256` +
  `vgsn_scrollsgn` — present — which is why the animated part worked.
- The purple is OURS: `TexturePlanner.resolve` painted every unresolvable texture the loud
  `[255, 0, 255]` marker. Prod (three path) did `textures.get(name) ?? null` — untextured material,
  grey under prelit — and vanilla SA draws the same, which is why the field read prod as "fine".
- The marker was also USELESS for diagnosis: the failed name was recorded nowhere.

**Fix (2026-07-22):** vanilla parity + loud ledger + a runtime dev highlight (user's call: "так проще
дебажить").

- A miss falls back to the MATERIAL COLOUR (the `empty-txd` white-stand-in precedent generalized); every
  failed name lands in `report.json` `textures.missing` (`txd/texture` → count + the MODELS that asked for
  it) and the pack log prints one ⚠ line per failed name with its models — a broken mod is identifiable
  straight from the console (user's ask: they will triage the mods from this list).
- The stand-in is minted in a POOL of its own (never shares a layer with a legit colour material) and
  listed in the pak manifest (`missingLayers`: array/layer/packed texel). The engine repaints exactly
  those 4×4 layers magenta when the highlight is on — `TextureArrays.setMissingHighlight` writes the
  texels live, on-load and on-toggle, no re-fetch. Default: ON in dev builds, OFF in production; toggled
  from the F2 debugger's Map screen ("Missing Textures: magenta ON/OFF").
- Tests: `textures.test.ts` (separate pool, shared stand-in per colour, ledger), `ospak.test.ts`
  (manifest carries/omits `missingLayers`), `engine.missing-textures.test.ts` (paint-on-load, resident
  repaint + colour restore, no-op toggle, bounds guard) — the fake device now records `writeTexture`.

**Field check: PENDING the next pak rebuild.** Data follow-up (user decision): the arch will render
untextured grey like prod until either mod 42's missing TXD is restored or the DFF's `_257` names are
patched to the shipped `_256` set.

---

### Row C — IdeFlag.ADDITIVE ignored: LV neon overlays welded as lit geometry (vgncircus2neon)

**Symptom (user, 2026-07-22):** `vgncircus2neon` (the Circus casino's timed neon dressing) — many glowing
elements in the original, dull in ours. Suspected the row-A palm problem; it is NOT.

**Trace:**

- The stock DFF's dominant material (`neon_centrala`, 1019 of 1273 verts) is FULLBRIGHT in **both** prelit
  sets (day = night = 255/168/83) — night−day delta is 0, so no emissive rule can or should fire.
- The def is `tobj` 7226, flags **140** = DRAW_LAST (0x4) + **ADDITIVE (0x8)** + 0x80, window 22:00–06:00.
  In vanilla RW the mesh ADDS its fullbright texture onto the base building — that IS the glow.
- Our welder consumed only DISABLE_BACKFACE_CULLING / IS_TREE / IS_PALM from the IDE flags. The neon
  welded as ordinary lit geometry: `prelit × night indirectScale (~0.13) × ao` — crushed to dull.

**Fix (2026-07-22):** honor `IdeFlag.ADDITIVE` end-to-end.

- Pack: `classOf` gained class **4 = additive** (wins over beam), from `def.flags & 0x8`. Composes with
  the timed window and the placement/breakable tables unchanged; AO/sun-vis bakes already skip class > 1.
- Engine: `world-additive-front/double` pipelines — the beam's self-lit shading (`fsBeam`: texel × dn-mixed
  prelit, no sun/indirect terms) with an ADDITIVE blend (`one, one` on colour; dst alpha untouched),
  depth read-only like every blended class. `pipelineIdFor` maps class 4; old paks never emit it.
- Covers every additive-flagged def map-wide (the whole LV strip's neon dressings), not just this model.
- Tests: weld routes a flags-140 def to class 4 (and never without the flag); `pipelineIdFor(4, ·)`.

**Field check: PENDING the next pak rebuild** (the class is assigned at weld time).

---

### Row D — night-only timed models crushed by the synthesized dark night (casinoblock41_nt, Fremont facades)

**Symptom (user, 2026-07-22):** casinoblock4 area (pos 2247.6, 2200.3) — the casino's lit facade glows in
the original, dull in ours. Reported as "animated facade"; the geometry there is the `tobj` pair
`casinoblock41_dy` (5→22) / `casinoblock41_nt` (22→5).

**Trace:** the `_nt` night model is authored FULLBRIGHT (day prelit 255/255/255, lit textures
`casinolights6lit3_256`/`casinobulb2_128n`) and carries NO night set — vanilla renders it at full texture
brightness after the 22:00 swap; that IS the "casino blaze". Our converter synthesized night = day ×
ambient (~0.25) and the shader multiplied by the night indirect (0.7): ~0.18 of vanilla's brightness. The
emissive mask also read delta = synthesized−day < 0 → mask 0. Every `*_nt` night dressing on the map
shares this crush.

**Fix (2026-07-22, weld.ts):** a NIGHT-ONLY timed window (`on ≥ 18 && off ≤ 8`) means the model does not
exist by day, so (1) a missing night set falls back to the DAY prelit verbatim (not the dark ambient), and
(2) the baked emissive compares the night set against VOID — its own brightness is the delta. Authored
night sets still win unchanged. Tests on the `mine` fixture (no prelit/night): night==day + mask 255 for a
22→5 window; day-window keeps the dark synthesis and mask 0.

**The ANIMATION half (user insisted, and was right):** the stripes running down the facade are a real
UV-scroll — `casinoblock41_nt` carries a UVAnimDict (`Material #1611953998`) referenced by the
`casinolights6lit3_256` material. The weld DID route it — but a bucket that is BOTH timed and scrolling
produced TWO objectTable rows (kind 0 + kind 4): the scroll drew around the clock, doubled the geometry
inside the window, and at ~18 % brightness the motion was invisible. Fix: **objectTable kind 5 = timed
UV-scroll** (oscell minor 7; params = slot | on<<16 | off<<24) — weld writes ONE row, the engine gates it
by hour AND feeds it the live scroll uniform; the model's non-scrolling remainder stays kind 0. Older
readers skip unknown kinds (the standing convention). Tests: weld (one kind-5 row per scroll material,
no kind-0 twin, window packed), engine frame (no draw outside the window; scroll uniform refreshed
inside it).

**Field check: PENDING the next pak rebuild.** Note: there is no bulb-chase FRAME animation in the assets
(single `lit3` texture) — vanilla's motion here IS the UV scroll, which kind 5 restores.

---

### Row E — ground glow at Ten Green Bottles: pool restore tried and REVERTED (awaiting the user's spec)

**Symptom (user, 2026-07-22):** at Ten Green Bottles (2345.5, −1704.8) prod spread a GREEN glow across the
ground at night; the original also blinks it. The named model (`telwire_01_lae2`) is just wires — no 2dfx
(the pick hit its street-spanning AABB). Data facts that stay true: the only green 2dfx light within 60 u
is the junction's `trafficlight1` (0/255/0, range 18, showMode 7 = the traffic cycle we ignore — all
three colours glow at once); `lamppost3` is steady amber (255/148/52, shadowSize 8). The parser still
drops `coronaShowMode`, point-light `range` and `shadowSize`/`shadowColourMultiplier`; static lights left
the light pool 2026-07-17 ("lamps igniting ahead of the car").

**Tried 2026-07-22 and REVERTED the same day (user: "не то что нам нужно"):** restoring static 2dfx
lights into the pool with smooth admission (colour premultiplied by gate × distanceFade × rankFade). The
code is in this branch's history if the mechanism is ever wanted; do NOT re-apply it as-is — the user
owes a precise description of the wanted ground-glow behaviour first.

---

### Row F — the OLD pak's magenta roster: 28 models, two data classes, ONE fix (global by-name fallback)

**Symptoms (user, 2026-07-22, five reports in a row):** magenta surfaces on `sw_block02` (next to
sw_shopflat05 @1282,373 — the pick hit the neighbour), `subpen_crane_sfse` (@−1744,−1784, the "purple
bus"), `triadcasno01_lvs` roofs, `vgnlowbuild13` roof, `lacnchasgn*_lvs` (La Conca sign rim).

**Trace:** a MAP-WIDE pak scan (decode every cell, attribute every triangle on the 4×4 colour layer whose
texel is 255/0/255) produced the complete roster — **28 models**, top offenders `bonaventura_lan` (6048
idx), `sw_block02` (3729), `visagesign04` (2304), `triadcasno01_lvs` (726). Every user report is in it.
Spot-checks split the class in two:

- **Mod TXD dropped names** its stock predecessor carried: mod 32 (`Lit Four Dragons Casino`) replaces
  `triadcasino.txd` without `black32`/`greyground256128` — and after install the stock TXD no longer
  exists to fall back to.
- **Stock cross-TXD references**: `lacnchasgn_lvs` names `carparksignplate_64`, which its own
  `laconchasign.txd` NEVER carried — vanilla RW finds it through the loaded-txd pool.

**Fix (2026-07-22, `textures.ts`):** a LAZY global name→txd index (sorted archive order, first-wins,
names only — no pixel data retained) as the LAST-RESORT lookup behind the scoped def→txdp→fallback chain.
Scoped stays first (the lod-common plan-004 lesson). Resolutions land in `report.json`
`textures.crossTxd`, keyed `txd/texture`, each entry carrying the FULL triage view (user's ask): the txd
that LACKED the name, the donor txd it was taken from, the texture name, and every model that asked. The
pack log prints one ℹ line per rescue. Only a true universe-wide absence still takes the row-B grey
stand-in + `textures.missing`. Test: planner resolves a name absent from the def TXD but present in
another archive TXD, ledgered as crossTxd, missing stays empty.

**Field check: PENDING the next pak rebuild** — see `testing-checklist.md` for the six spot positions.

---

## Open rows

### Row G — mod 46 "Animated Radars": models invisible (OPEN — needs a repro session)

The mod's `.ide.merge` moves `ap_radar1_01` from `objs` to `anim` (clip file `radar.ifp`, dist 600) and
mod-installer supports exactly this (its own tests use this mod). The IFP's single clip is named `'0'`,
NOT the model name — `clipForModel` finds nothing, and by the missing-clip rule the def should weld WHOLE
at bind pose (visible, static). The field reports it INVISIBLE — so something else drops it. Also worth
fixing while there: single-clip IFPs should fall back to their first clip (mods name clips arbitrarily);
that would make the radar actually TURN instead of standing still.

### Row E follow-up — ground glow (deferred to 078 ledger #11; user owes the wanted behaviour)
