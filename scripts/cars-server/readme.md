# cars-server

A local page showing what the vehicle fleet **replaced**: the stock car beside the mod that took its slot,
its author, and what the mod brings. Internal tool — no build step, no auth, nothing persisted.

```sh
npm run cars                              # http://localhost:5178, game `original`
npm run cars -- --game gostown --port 5200
```

Every card carries the model id, `<slot> replaced to: <car>`, the author, the tags below, and two pictures —
**Original** (the stock car, from the bundled metadata) and **Replaced** (the field screenshot). The catalog
is rebuilt on every page load, so editing `mods-src` and hitting reload shows the new fleet.

## Where the three sources meet

| Source                                                 | Gives                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `data/original.json` (committed)                       | 19 sections × 212 stock cars: the section, the SLOT and a `data:` picture |
| `mods-src/<game>/vehicles` via `resolveVehicleSources` | the fleet the BUILD installs — `models/`, overridden per slot by `new/`   |
| `mods-src/<game>/vehicles/screenshots/`                | the replaced car in the field                                             |

**Joined on the SLOT, never on the folder name.** All three line up 1:1 on the real tree, but five
screenshots do not match their folder's name character for character
(`at400 - Boeing 727-100 Liveries- carcer.png` lost a space) — a filename join loses exactly those five and
looks like missing pictures.

A `new/` candidate is shown, because the build installs it, and marked `from new/` — with **no** replaced
screenshot: the picture filed under that slot is of the car it displaced.

## Tags — read from the mod folder, in this order

| Tag                | Means                                                                              |
| ------------------ | ---------------------------------------------------------------------------------- |
| `Tuning`           | its carmods line names a part beyond the universal `nto_*` nitros                  |
| `New Tuning Parts` | the folder ships more than one `.dff` — the mod re-modelled the kit                |
| `N Paint Jobs`     | `<slot>1.txd`, `<slot>2.txd`, … beside `<slot>.txd`                                |
| `Car4 Supported`   | its carcols line carries 4 values per combo (the installer's own `carcolsSection`) |
| `New Colors`       | the settings file appends `R,G,B  # newN` palette lines                            |
| `Has Cleo Script`  | the folder has a `cleo/` subfolder                                                 |

No tags = a plain model swap. The settings file is read with the installer's own `decodeSettings` +
`parseVehicleSettings`, so a UTF-16 file (what most Windows-authored mods ship) reads correctly.

See [docs/plans/001-cars-server.md](./docs/plans/001-cars-server.md).
