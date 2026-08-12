# 003 — plate bake: readable license plates in cutscenes

**Status: PLANNED 2026-08-12.** An IMPROVEMENT over the original, in the goals-doc sense: vanilla
cutscene cars show a BLANK white plate — the user's own gate-7 vanilla A/B screenshot is the recorded
evidence — because `CCustomCarPlateMgr` generates plate textures only for GAMEPLAY vehicles, and a
cutscene object renders the raw placeholders. The converted models can do better offline: bake a real,
readable plate into each slot's cs TXD. Zero DFF changes, zero runtime cost, kilobytes per slot.

## The mechanism (research already banked)

- Every plated DFF carries two quads, keyed by their material's placeholder TEXTURE name (the reversed
  `CCustomCarPlateMgr` keys on exactly these — `build-vehicle-model.ts`'s PLATE_TEXTURES mirror):
  `carplate` = the text strip, `carpback` = the background it is inset into.
- At gameplay model setup the manager swaps `carpback` → `plateback<town>` and `carplate` → a texture it
  RENDERS from the `platecharset` glyph strip. Cutscene objects never get that call.
- All source art lives in the resident `models/generic/vehicle.txd`, **uncompressed RGBA8888** (no DXT
  round-trip needed): `platecharset` 32×256, `plateback1/2/3` 64×32 (LS/SF/LV), the blank `carplate`
  16×16 (measured 2026-08-12).
- **Texture resolution prefers the model's OWN TXD over the txdp chain** — so shipping textures NAMED
  `carplate`/`carpback` inside the emitted `cs*.txd` overrides the placeholders with no DFF surgery at
  all. This is the whole trick.
- The hand-made pack half-knew this: it shipped `plateback1-3` + `platecharset` copies per car (megabytes)
  but never composed a text — its plates render the background only.

## Steps

### 1 — recover the original's plate-render formula

- [ ] Read `CCustomCarPlateMgr` in gta-reversed (`CreatePlateTexture`, `RenderLicensePlate`): the glyph
      cell layout inside `platecharset` (which rows map to which characters), the generated raster's
      dimensions, per-character advance/spacing, and how `plateback<town>` is chosen. Record the layout
      here — per the standing rule, the formula is recovered, never fitted.
- [ ] Confirm the `carplate` quad's UVs span the whole texture on 2–3 real DFFs (stock bobcat + one mod)
      so a differently-sized baked texture cannot mis-map.

**Verification:** a documented byte-accurate glyph map (char → cell) reproduced from the source, cited
by file/function. **Record:** the layout table in this doc.

### 2 — `plate.ts`: compose + encode

- [ ] Compose the plate raster in plain RGBA: `plateback<town>` pixels as base, glyphs blitted per the
      recovered formula. Text is DETERMINISTIC per slot — derived from the cs model name (stable across
      rebuilds; reproducible-build rule) — with a `--plate <text>` CLI override for all slots.
- [ ] Encode two TextureNative entries (`carplate` = the composed raster, `carpback` = the town
      background copy) as RGBA8888 singles-mip, byte-built like `clump-io` builds its chunks (rw-codec
      writer; no engine writes).
- [ ] Tests first-negative: an unknown town index throws; a text longer than the plate truncates loudly
      (warning, not silence). Positive: composed pixels contain the glyph rows (compare a rendered
      char's cell against the charset source), both entries parse back via `parseTxd` with the right
      names/sizes.

**Verification:** unit round-trip — `textureNames` sees `carplate`+`carpback`, decoded pixels match the
composition. **Record:** bytes per baked TXD entry pair.

### 3 — wire into the emit

- [ ] `slotTxd` gains the pair in BOTH routes: appended to the empty dictionary (the pipeline route) and
      into the self-contained TXD (the bottle route). The closure check already treats these names as
      resolvable — now they resolve one hop earlier.
- [ ] Town selection: default LS (`plateback1`) — the intro's scenes; expose `--plate-town ls|sf|lv`
      for later scenes if the field ever shows a wrong-town plate mattering.
- [ ] Summary line reports plates baked; plan 002's step-10 numbers pick the TXD growth up.

**Verification:** full mod run — 21/21 slots carry the pair; converted intro build installed in the
bottle. **Record:** per-slot TXD bytes before/after (expect ≈ +6 KB against the 40 B empty dictionary).

### 4 — FIELD: the improvement demonstrated

- [ ] Intro run (user): the sheriff's and taxi's plates READ as plates — text on a town background —
      where the vanilla A/B frame shows a white blank. Screenshot pair goes into the record; that pair
      IS the "better must be demonstrated" evidence for this improvement.

**STOP: the user's verdict closes the plan.** **Record:** verdict + screenshot reference.

## Risks / notes

1. The `carplate` placeholder is 16×16 and the generated raster is larger — step 1's UV check guards the
   only way this could mis-render (a quad UV-mapped to a sub-rect instead of 0..1).
2. Mods whose plate quads carry NON-placeholder textures (a custom baked plate) already resolve their
   own art; the override pair in the cs TXD would shadow SAME-NAMED textures only — a mod using
   `carplate` deliberately gets ours (acceptable: same look class), any other name is untouched.
3. Gameplay parity note: gameplay plates are random per instance; the cutscene plate is one deterministic
   text per slot. That is strictly better than vanilla's blank, and nothing in a scene reads a plate's
   text as story content.
