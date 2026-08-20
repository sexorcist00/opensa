# 003 — the ADDED cars, and a car shown with the alternatives that hang off it

**Status: ASKED FOR 2026-08-20, not planned yet.** The user's words at the close of session 31: extend
cars-server to know about `tools/add-vehicles`, link the main car with the alternatives attached to it, and
draw an alternative as a **slightly smaller card** than the car it belongs to. **Plan first, then the
implementation** — this file is the request written down, not the plan.

## What the page knows today

The fleet that REPLACED a stock slot: `mods-src/<game>/vehicles` through `resolveVehicleSources`, one card
per slot, the picture read from the car's own layer's `screenshots/` ([002](002-layered-screenshots.md)).
`mods-src/<game>/add-vehicles` — 115 cars in this game — is invisible to it.

## What it has to know as well

- **The added fleet**, out of `resolveAddedVehicles` (`@opensa/add-vehicles/sources`), with the same
  screenshot rule: an added car's picture lives in its own layer's `screenshots/`.
- **The relation between them.** An added car names its base in its folder name (`… (remingtn)`), and that
  base is a slot the page already draws. So the page can show a stock slot, the mod that took it, and every
  added car that varies it — which is exactly what the game does with them in traffic
  (`### remingtn` / `[534]` / `Global=534,19050`).

## The shape the user asked for

A car's card carries the alternatives hanging off it, each drawn **a size down** — the visual statement is
"these are variations of that one", not "these are peers". Everything else about a card stays as it is.

## What has to be decided when the plan is written

- **What the id means on the page.** An added car has one (19 001+, promised by `data/vehicle-adds.txt`) and
  a replacement car does not; the page has never shown ids at all.
- **Where the relation is READ from.** The folder name's `(base)` suffix is the source of truth for the
  fleet on disk, and the built tree's ledger is the source of truth for what was actually installed. They
  disagree whenever a build is stale, and the page should say which one it is showing rather than pick
  silently.
- **A car with several bases**, which the resolver allows: it appears under each, or once with both named.
- **The tuning an added car carries** — its own derived parts and paintjobs, both of which the page could
  read off the built tree. Probably out of scope for a first pass; worth stating either way.

Neighbours: [`tools/add-vehicles/docs/plans/102-add-vehicles/readme.md`](../../../../tools/add-vehicles/docs/plans/102-add-vehicles/readme.md)
for what an added car is made of, and [`002-layered-screenshots.md`](002-layered-screenshots.md) for the
picture rule this must not break.
