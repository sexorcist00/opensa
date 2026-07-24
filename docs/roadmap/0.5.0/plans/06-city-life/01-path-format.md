# 06·01 — The path data model & format (the single source of truth)

[← chain](readme.md) · next: [02 editor](02-path-editor.md)

Everything in city life reads ONE graph. SA's own path data is the seed; our format is the product.

## What SA ships (the importers to write)

- **`nodes*.dat` (64 area files)**: car + ped path nodes with links — positions, lane counts per direction,
  node flags (traffic light, dead end, boat/emergency-only, roadblock candidacy), link lengths, and the
  "flood fill" groups. Community documentation is thorough; the binary layout is fully known.
- **`tracks*.dat` (4 files)**: train track polylines (the rail geometry trains actually follow).
- **Zone/popcycle data** (`popcycle.dat`, zone tables): population density and ped/car type mix per zone
  per time-of-day — the spawn-density source.
- **carcols/handling/peds ide**: agent APPEARANCE pools (which cars/peds spawn where).

## Our format (versioned, binary + JSON debug twin, like `.oscell`/`.ospak`)

`.ospath` — one file per map build, 4 KiB-aligned sections:

1. **Node table**: position, kind (car/ped/rail), flags (light-controlled, stop, yield, rail-crossing,
   spawn-allowed), zone id.
2. **Lane-aware links**: per direction: lane count, width, speed class; curve control points where SA's
   straight links need smoothing (editor-authored beziers — SA links are polylines; ring-0 vehicles want
   curvature).
3. **Intersection records**: node group + a CONTROLLER blob (light phase table / stop priority / rail
   barrier binding) — plan 04 consumes.
4. **Rail network**: track polylines + station nodes + schedule table (plan 05).
5. **Density fields**: per zone × 24 h: car flow (agents/min per lane-km), ped density, type-mix indexes
   (from popcycle import, editable in the editor).
6. **Deterministic ids**: stable node/link ids (content-hashed) so saves, the editor, the engine and the
   ASI all reference the same graph across rebuilds.

## Tasks

> **HEAD START (2026-07-16):** a first-cut `nodes*.dat` parser already SHIPPED as
> `packages/renderware/src/parsers/binary/paths.ts` (`vehiclePathNodes`) for the 074 bench road cars —
> it reads the header, the 28-byte VEHICLE nodes (÷8 fixed-point positions, link count + the boats flag)
> and the link table, and resolves a heading toward each node's first link (cross-area links included).
> Verified against the real install (unit tests + a field run placing 841 cars on the roads). This plan's
> importer EXTENDS it: ped nodes, navi/carpathlink lane data, full flag decode, `tracks*.dat`.

- [ ] `nodes*.dat` importer (car + ped graphs, flags, lanes) with a round-trip test against known
      community-documented samples — extend the shipped `vehiclePathNodes` (see above).
- [ ] `tracks*.dat` importer.
- [ ] popcycle/zone density importer → density fields.
- [ ] `.ospath` codec (encode/decode + validation: connectivity, lane consistency, orphan nodes) in
      `packages/engine-formats` style — same testing discipline (negative cases first).
- [ ] Graph queries library (used by sim + editor + ASI-side generator): nearest-link, route search
      (A\* over links with lane costs), segment walk (advance s metres along route).
- [ ] Debug JSON twin export (the editor's interchange while iterating).
