# 081/10 — Surface types: the wheel learns what it stands on

**Status: QUEUED 2026-07-27** (scouted, not started). The last item of the agreed queue after the regression
pack (07 §2), the kerb close-out (06 §2) and the step-cost measurement (07 §3).

Today every tyre in the world drives on tarmac. `ROAD_ADHESION = 4.5` in `vehicle/steering.ts` is the
rubber×road cell of `data/surface.dat` hardcoded, and the per-wheel `frictionSlip` is the car's authored
`fTractionMultiplier` with no idea what is under it. A comet on a beach grips exactly as it does on the LV
strip, and `bOffroadAbility` means nothing.

## What the data actually says (measured 2026-07-27, from the BUILT game)

- **`data/surface.dat`** is a 6×6 adhesion matrix between material groups. The rubber row is the one a tyre
  uses: **road 4.5 · hard 3.6 · loose 3.2 · sand 3.0 · wet 2.8 · rubber 6.0**. So grass and dirt are 71 % of
  tarmac, sand 67 %, wet 62 % — a real difference, and a bounded one (no surface is grippier than tarmac
  except rubber, which nothing drives on).
- **`data/surfinfo.dat`** has 179 rows; **row order IS the COL material byte**, and `parseSurfaceNames`
  already reads the name column for procobj. Group spread: **ROAD 73 · LOOSE 60 · HARD 29 · SAND 12 ·
  RUBBER 3 · WET 2**.
- **The per-surface `TYRE_GRIP` column is 1.0 on all 179 rows** — the override the file's own legend
  advertises is unused in stock data, so the group matrix is the whole story. Do not build a mapping around
  a column the data never sets; read it, apply it, and expect it to be 1.
- **`WET_GRIP` is live**: 116 rows at 0.00, 38 at −0.40, 18 at −0.25, 6 at +0.50, 1 at +0.40. It is the
  rain-time modifier, and it is what makes a wet road worth having weather for.
- **The map's collision carries the materials, and they are varied.** Sampled from the real COL faces:
  LV strip → `tarmac`, `pavement`; Red County crest → `rock_dry`, `dirttrack`, `dirt`, `grass_medium_dry`,
  `golfgrass_smooth`, `gravel`; LS beach → `sand_beach`. This is not a feature waiting on data.

## What is missing, in layers

1. **The seam drops the material.** `ColliderShape` (`packages/game/src/interfaces/collider.interface.ts`)
   carries vertices, indices, boxes and spheres — no per-face material, though `col.ts` parses one (`u8`)
   for every face and primitive. Nothing downstream can ask what a triangle is made of.
2. **DRCVC will not say what a wheel rides.** The raycast controller exposes contact, impulses and
   suspension length — not the collider or triangle it hit. Identifying the surface needs OUR OWN downward
   ray per wheel, or a design that encodes the answer in the collider itself (see the decision below).
3. **The steering limiter reads the same constant.** `steering.ts` uses `ROAD_ADHESION` in the original's
   own lock formula — when the tyre's adhesion becomes a lookup, the limiter must read the SAME number, or
   the car will be granted lock its tyre cannot answer. That coupling is what 081/09's saga was about.

## The decision to make first (measure, don't argue)

How a wheel learns its surface, priced against the **measured** vehicle budget (081/07 §3: the whole vehicle
slice is ~8 µs per car per step, 0.605 ms at 80 live cars):

- **A — a downward ray per wheel per step.** Four rays per car. On the driven car alone: free. On all 80
  bench cars: roughly doubles the slice (~0.6 → ~1.2 ms/step). Simple, exact, and it reads whatever the map
  says at that point.
- **B — colliders split by adhesion group.** The cell builder emits one trimesh per group, so the ray hit's
  COLLIDER is the answer with no per-triangle lookup. Costs a handful more colliders per cell and a pipeline
  change; still needs a ray, since DRCVC hides its own.
- **C — sample rarely.** Surfaces change slowly under a car: probe the driven car every step and traffic
  every N steps (or never — traffic follows the road graph and stays on tarmac).

Recommended entry: **A + C** (exact, one place, cheap where it matters), with B kept as the optimisation if
the per-triangle lookup turns out to be the expensive half. **Whatever is chosen, the capture must record
which surface each wheel reported** — the same self-describing rule the springs and dials follow.

## Steps

1. **`surfinfo.dat`, fully typed.** Extend `parseSurfaceNames` into a per-material record (adhesion group,
   tyre grip, wet grip, skidmark type, the `W_*` effect flags, `PAVEMENT`/`SAND`/`WATER`) — the effect flags
   are read here even though 089 consumes them, because one file should be parsed once. Unit tests pin real
   rows (`TARMAC`, `GRASS_SHORT_LUSH`, `SAND_BEACH`, `WATER`), including the all-1.0 `TYRE_GRIP` fact.
2. **`surface.dat`, the 6×6 matrix**, parsed and unit-tested against the file's own header (it is a lower
   triangle — the parser must mirror it, and prove it does on rubber×road = 4.5).
3. **Materials through the seam.** `ColliderShape` gains a per-triangle material array (and per-primitive
   for boxes/spheres); the adapter fills it; the physics layer keeps it beside the collider. Nothing changes
   in behaviour — this step ships green with the numbers unchanged, and the regression pack proves it.
4. **The probe.** A per-wheel downward ray on the driven car (and the chosen policy for traffic), the hit's
   material resolved to a surface record, exposed through the vehicle handle + the `[phys]` capture. Still
   no behaviour change: the capture starts REPORTING the surface while the grip stays tarmac.
5. **Grip from the surface.** `frictionSlip` per wheel = the authored `fTractionMultiplier` scaled by the
   matrix's rubber×group cell relative to road (so tarmac is exactly today's feel and only off-road moves),
   with the steering limiter reading the same adhesion. **This is the step that moves the pack** — a
   deliberate re-record after the field verdict, not a band widening.
6. **Wet.** `WET_GRIP` applied while it rains, tied to the existing weather state.
7. **Field round** on grass, dirt, sand and a wet road, plus the pack re-recorded on acceptance.

## Acceptance

- A car on grass/dirt/sand slides earlier than on tarmac, and the difference is the matrix's, not a dial's.
- Tarmac feel is **byte-identical** to today (the pack passes untouched until step 5, and step 5 moves only
  off-road laps unless the field asks otherwise).
- The vehicle slice stays inside 081/07 §3's budget with the probe live — measured, in this ledger.
- Field: "the car finally behaves differently off the road", and no complaint that town driving changed.

## Risks

- **The steering limiter must follow the tyre** (see above) or off-road becomes the 081/09 complaint again.
- **A grip change is a feel change**: every SA-faithful grip move in this chain was field-rejected. This one
  is different in kind — it does not scale the tyre, it says WHERE the tyre is — but the field decides.
- **`p_*` procobj surfaces** (grass tufts etc.) are in the same table and must not be treated as ground.

## Ledger

_(surface counts, the chosen probe policy + its measured cost, before/after captures, field verdict)_

### 2026-07-27 — steps 1-2: both data files are read, and the tests pin what they actually contain

No behaviour change; this is the data half, and it ships green.

- **`parseSurfaceInfo`** (`renderware/parsers/text/surfinfo.parser.ts`) turns each row into the full record —
  adhesion group, tyre/wet grip, skidmark type, friction effect, and every flag the legend names, including
  the `W_*` wheel effects plan 089 will read. The file's header is a **four-line stacked legend**, so the
  token positions are spelled out in one `COLUMN` table rather than counted at each use. `parseSurfaceNames`
  stays as its own entry point (procobj wants one string per row).
  **A malformed row keeps its name and takes defaults instead of being dropped** — row index IS the COL
  material id, and dropping one would silently shift every surface after it.
- **`parseSurfaceAdhesion`** (`surface.parser.ts`) reads `surface.dat`'s lower triangle and **mirrors it**,
  so `get(a, b) === get(b, a)` and no caller has to know which half the file stored. Comments there start
  with `;`, not `#`, so it cannot use the shared `cleanLines` — noted at the top of the file.
- **`data/surface.dat` is now a test fixture** (`scripts/test-fixtures.ts`), so both parsers are tested
  against the real files rather than against snippets someone typed.

What the tests pin, because these are the numbers the rest of the plan is built on:

| fact                                                | value                                                   |
| --------------------------------------------------- | ------------------------------------------------------- |
| the rubber row (what a tyre actually gets)           | road **4.5** · hard 3.6 · loose 3.2 · sand 3.0 · wet 2.8 |
| nothing drivable out-grips tarmac                    | asserted, not assumed                                    |
| every cell of the 6×6 filled                         | asserted (a missing pair would read as no grip)          |
| `TYRE_GRIP` across all 179 rows                      | **1.0 — the override is unused; the alarm if it changes** |
| adhesion census                                      | road 73 · loose 60 · hard 29 · sand 12 · rubber 3 · wet 2 |

Suite 2840 → **2853 green**. Next: step 3, materials through the collider seam (still no behaviour change).

### 2026-07-27 — step 3: the material reaches the physics world, and a point can be asked what it is

Still no behaviour change — nothing reads the answer yet, and the regression pack is untouched.

- **The seam carries it.** `ColliderShape` gained `materials?: Uint8Array` — **one byte per TRIANGLE**, in
  index order — and `ColliderBox`/`ColliderSphere` an optional `material`. `toModelColliders` fills them from
  the COL faces and primitives it was already reading and throwing away. A byte per triangle beside twelve
  per vertex is free, and the old test that asserted the drop ("dropping surface data") is now the test that
  asserts the carry.
- **The physics world remembers it** per collider handle (the same array by REFERENCE for every placement of
  a model — a cell holds hundreds of copies of one wall), and **forgets it with the body**: Rapier reuses
  handles, so a stale entry would answer for whatever a streaming world creates next. That cleanup has its
  own test.
- **`PhysicsWorld.surfaceBelow(position, maxDrop, excludeBody?)`** answers the SA surface id under a point.
  The triangle comes from the ray hit's own `featureId` — Rapier reports the trimesh face index, which is
  what makes per-triangle resolution possible at all and settles the design question this plan's header
  raised (no need to split colliders by group). A box or sphere has one id and no feature to read.
- **Null means UNKNOWN, never surface 0.** `default` is a real row in the table; collision built without
  materials must not read as tarmac. Tested both ways.

Learned in passing, and worth a line because it cost the first two test runs: **a ray sees nothing until the
world has stepped once** — the query pipeline is built during `step`, so a probe written against
freshly-created colliders silently reports "no ground".

Suite **2859 green**. Next: step 4, the per-wheel probe (still no behaviour change — the capture starts
reporting the surface while the grip stays where it is).

### 2026-07-27 — step 4: every wheel now says what it is standing on, and a lap says what it drove on

Still no behaviour change; the grip is untouched and the pack is untouched. What moved is what a capture can
tell you.

- **`readVehicleWheelSurfaces(controller, chassisBody)`** — DRCVC never reports what its own suspension ray
  hit, so the probe re-casts a short one (5 cm above the contact point it DOES report, 35 cm of reach)
  through `surfaceBelow`. One ray per wheel **in contact**; an airborne wheel costs nothing. Wired for the
  DRIVEN car only, and only while a capture runs.
- **The table reaches the engine side**: `WorldAdapter.surfaces()` returns the parsed rows as
  `SurfaceRecord` — deliberately structural, so the adapter's `surfinfo.dat` objects satisfy it with no copy
  and the `game` layer still names no renderware type. The adapter now parses the table whenever the file is
  there, not only when `procobj.dat` is too (what a wheel stands on has nothing to do with ground clutter).
- **The capture reports it**: `WheelFrame.surface`, and a per-lap `summary.surfaces` — the share of
  wheel-on-ground samples per surface, counted PER WHEEL (a car with two wheels on grass is half off the
  road, and that is the state the grip change has to be read against), re-keyed from material ids to NAMES
  when the capture is printed.

**Verified in the game, which is the only place this could be verified:**

| lap                     | reported                                                            |
| ----------------------- | ------------------------------------------------------------------- |
| `brake-strip` (SF road) | `{ default: 1 }`                                                     |
| `crest-jump` (Red County) | `{ tarmac: 0.79, dirt: 0.10, grass_medium_lush: 0.07, pavement: 0.03 }` |

**And it took a full in-game diagnosis, because the unit tests were green while the game reported nothing.**
The probe returned null for every wheel of every lap. The chain was intact — 3 943 colliders carried
materials, the ray hit a face, the lookup found the right 106-entry array — and the `featureId` came back as
**127**, then **133**. Parry encodes a hit on a triangle's BACK side as `featureId + triangleCount`, and the
game's roads are wound so a downward ray lands on exactly that side: 127 − 106 = 21, 133 − 106 = 27, both
real triangles. Read straight, the id runs off the end of the table and every wheel reports "unknown". The
fix is one modulo; the test that would have caught it (a quad wound away from the ray) is now in the suite,
beside the one that would not have (a quad wound toward it, which is what a hand-written fixture naturally
does). Two lessons worth carrying: **the harness only forwards `[phys]`, `[slow]` and console WARNINGS**, so
a `console.log` diagnostic is invisible from a headless lap; and a probe that reads geometry has to be
verified against the map, not against a fixture that agrees with it by construction.

Suite **2868 green**. Next: step 5 — grip from the matrix. That one MOVES the pack, deliberately.
