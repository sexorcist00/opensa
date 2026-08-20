# 003 — the ADDED cars, and a car shown with the alternatives that hang off it

**Status: PLANNED 2026-08-20**, his ask at the close of session 31: extend cars-server to know about
`tools/add-vehicles`, link the main car with the alternatives attached to it, and draw an alternative as a
**slightly smaller card** than the car it belongs to. Plan first, then the implementation — this is the plan.

## What the page already does, and the one thing the request got wrong

The request written down at session 31's close said `mods-src/<game>/add-vehicles` "is invisible to it". **It
is not.** The added fleet has been on the page since [add-vehicles 102](../../../../tools/add-vehicles/docs/plans/102-add-vehicles/readme.md)
(`269a166e`): `catalog.ts` resolves the added root through `resolveVehicleSources`, lists it as its own
`Added vehicles` section, indexes `add-vehicles/screenshots/`, and already carries `bases` on the card model
— **rendered nowhere**. Measured today with `npm run cars`: **327 cards in 20 sections** (212 replacements +
115 added), and 115/115 added cars have a screenshot.

So this plan is not "show the added cars". It is **show the RELATION**: a stock slot's card and the cars that
vary it, drawn as what they are.

## The relation, measured on the real tree (2026-08-20)

- **115 added cars over 101 distinct bases, and every base has a card** in the replacement fleet — 0 orphans.
- **0 cars name more than one base**, though `parseVehicleBases` accepts a comma list and
  `resolveAddedVehicles` inherits sound and parts from `bases[0]`.
- Alternatives per base: **98 bases with 1**, one with **4** (`freiflat`), one with **5** (`freight`), one
  with **8** (`freibox`). **A base card has to hold eight nested cards**, and nothing caps the number.
- The built ledger (`build/original/sa/data/vehicle-adds.txt`) and the folders agree exactly: **115 `car`
  rows, none missing on either side, 0 base disagreements** — plus **57 `part` rows**, which are a
  replacement car's derived tuning parts and not cars at all.
- `add-vehicles/reserved/` holds 2 folders. The resolver never returns them, so they stay off the page.

## The decisions

1. **The relation is read from the FOLDER NAME**, not the ledger. The whole page is "what the tree will
   install", every other field on a card already comes from the folder, and a page built out of the last
   build would go stale the moment a car is dropped in. **The ledger is read for ONE thing — the id** — and
   the page says which tree it was read from. A folder with no ledger row shows `id — not built yet` rather
   than a number nobody promised; a row whose base disagrees with the folder shows the FOLDER's relation and
   flags the row as stale. Never pick silently between the two.
2. **What the id means.** An added car has one (19 001+, promised by the ledger — a parked spot and a
   ModelVariations entry land in the player's save, so it may not move); a replacement car does not, and its
   card keeps today's behaviour (the mod's own `vehicles.ide` row, falling back to stock). So the id is shown
   only where it means something, labelled as the id the BUILT tree promises.
3. **A car naming several bases appears under EACH of them**, once per base, with the base it INHERITS from
   (`bases[0]`) marked as such. Zero today; the rule exists so a future one is not silently dropped or
   silently duplicated without explanation.
4. **The added cards live under their base**, inside the base's own section (`Sports Cars`, not a bucket at
   the end). The `Added vehicles` section survives ONLY for cars whose base has no card — empty on this tree,
   so it disappears — and the header keeps counting every card on the page, nested ones included.
5. **`--target opensa` shows no added cars at all.** `resolveAddedVehicles` refuses every target but `sa`
   (ModelVariations, FLA's audio loader and Parked Maker are the real game's), so the opensa build never
   installs one — while the page today lists all 115 under both targets, which is a small lie it has been
   telling since 007 (verified: `resolveVehicleSources(add-vehicles, 'opensa')` returns 115). The header says
   why they are absent instead of just dropping them.
6. **The tuning an added car carries is OUT of scope for this pass** — its derived parts (the ledger's 57
   `part` rows) and its paintjobs are both readable, but they belong to the card's TAG set rather than to the
   relation this plan is about. Stated here so the next reader knows it was a decision and not an oversight.

## The shape on screen

- A base card keeps its two panes (Original / Replaced) exactly as it is. Under them sits a strip of
  **alternative cards, a size down**: one picture each (its own screenshot — an added car has no "original",
  because the original is the card above it), the car name and author from the folder, the id, the tags.
- The visual statement is "these are variations of that one", never "these are peers", so the alternatives
  are inset and share the parent card's frame rather than starting a new one.
- **It must survive the phone layout** — one card per row at every width, panes stacked below 560 px (plan
  001's rule, the user's call). Eight nested cards on `freibox` is the case to lay out against, not one.
- An added car keeps its own `#car-<slot>` anchor wherever it is drawn, so the missing-shot warning's links
  still land on it.

## Steps

1. `catalog.ts` — attach each added car to its base's card (`alternatives`), keep the orphan section, gate on
   the target. Unit tests over a temp tree (negative cases first): a base with several alternatives, an added
   car whose base nobody replaced, `--target opensa`, a folder with no ledger row, a ledger row that
   disagrees.
2. `views/index.hbs` — the nested strip and its styles, screenshots served at the smaller size.
3. The ledger id and its staleness state on the card.
4. Docs: this plan's numbers filled in, `scripts/cars-server/readme.md`. The commands do not change, so
   `docs/commands.md` does not.

## Verification (to be measured when it is built)

- The real tree: 327 cards, 101 bases carrying 115 alternatives, `freibox` showing 8; page size before/after.
- Screenshotted at 1440 / 820 / 390 px, the eight-alternative card included.
- `--target opensa`: 212 cards, no added cars, the note present.
- A synthetic tree whose added car names a base nobody replaced → the `Added vehicles` section appears for it.
- Suites cars-server + tool-kit green; tsc + eslint clean.

Neighbours: [`tools/add-vehicles/docs/plans/102-add-vehicles/readme.md`](../../../../tools/add-vehicles/docs/plans/102-add-vehicles/readme.md)
for what an added car is made of, and [`002-layered-screenshots.md`](002-layered-screenshots.md) for the
picture rule this must not break.
