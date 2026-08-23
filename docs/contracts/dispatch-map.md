# Contract — the dispatch map's own files

What the dispatch console (`apps/dispatch`) looks for beside a built game, and what happens when a name is
spelled wrong. Its neighbours in this folder are [mods.md](mods.md) and [vehicles.md](vehicles.md); this file
is the console's half, and it exists for the same reason they do — a name that carries behaviour and cannot
be grepped for is a name nobody can follow.

## 1. `tiles.pmtiles` — the flat 2D map's whole pyramid

**Where:** beside the built game the console streams, i.e. at the root `?src=` names —
`build/<game>/opensa/tiles.pmtiles` for a field run. `?tiles=<url>` overrides it with an archive anywhere.

**What it is:** one [PMTiles v3](../links.md) archive, read by HTTP range requests. Written by the console's
own baker (`?bake=tiles`, [201/6-02](../plans/201-dispatch-console/6-display-modes/readme.md)) and readable
by `pmtiles`, MapLibre and QGIS as it stands.

**What it must carry**, because the reader takes it from the file rather than assuming San Andreas:

| Metadata key | Meaning |
| --- | --- |
| `scheme.origin` | the world square's south-west corner, GTA ground coordinates |
| `scheme.span` | world units per side (the pyramid is square by construction) |
| `scheme.tileSize` | pixels per tile side, as baked |
| `scheme.minZoom` / `scheme.maxZoom` | the levels the archive actually carries |
| `world` | which build it was baked from |
| `built` | when |

**When it is spelled wrong, or absent:** the console keeps its projected grid and the status bar says
`grid — <reason>`. Nothing throws, nothing is logged as an error, and the map still works — so the reason on
screen is the only thing that distinguishes "there is no archive here" from "the tiles have not arrived
yet". An archive that parses but carries no `scheme` is refused by name (`the archive carries no world
square`) rather than drawn on a guessed square: a pyramid read on the wrong square is not a broken picture,
it is a picture that is silently in the wrong place.

**Directory compression is `none`.** Our writer produces it and our reader refuses anything else by name — a
gzip stream is a valid varint stream, so a reader with no inflater would return entries that decode, address
real offsets and serve the wrong bytes.
