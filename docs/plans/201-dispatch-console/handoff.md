# 201 — the handoff spec

**Written 2026-09-05 for the agent that picks this up next.** The `## Status` table in
[readme.md](readme.md) is still the chain's state of record; this is the working spec it points at, because a
handoff that has to fit in a table cell stops being read at about the point it starts being useful.

Read [`CLAUDE.md`](../../../CLAUDE.md)'s chain first, then this.

---

## 1. Where the project actually is

**The console meets its frame budget on an empty map and does not on a full one, and until today only the
first half of that sentence had ever been measured.**

| | empty map | 9 units as models | **150 units as models** |
| --- | --- | --- | --- |
| draws | 96 | 837 | **12 197** |
| triangles | 242 k | 344 k | **1.30 M** |
| `overlay-2d` (CPU) | 0.5–0.9 ms | — | **6.17 ms** of an 11.65 ms body |
| frame | 17–21 ms, 74–92 % on one vsync interval | — | not yet measured on the route |

Rows: [the empty-map series](../../benchmarks/index.md) (09-05) and
[units as models, first look](../../benchmarks/opensa-engine/2026-09-05-mobile-units-as-models-first.json).

**Chain 9 is spent.** It took the frame from 48 ms to ~17 with ~90 % of frames on one display interval. The
win was the post chain, not the world: removing the bloom chain is 7.7 ms of a 23.4 ms frame while the whole
streamed city is 3.8, and the shipped fix is a half-resolution bloom prefilter taken on an operator's night
verdict.

**Chains 4 and 5 moved today.** [4/04](4-a-console-is-not-a-game/readme.md) (sway keeps the frame awake) is
built; [5/05](5-symbology-and-picking-as-product/readme.md) is open with a decision in it that needs the
user.

---

## 2. Do this first, or every number you take is of the wrong thing

**The device is running the previous app.** The long `phone` job is serving out of `./build/phone-cars` and a
job holds the runner, so `pull` is refused while it runs. Until this is done the phone has neither the
five-type board nor 4/04's sway:

```bash
# on the phone, after stopping the serving job
git pull --ff-only && rm -rf build/webapp/assets && tar -xzf prebuilt/opensa-webapp.tar.gz -C build/webapp
```

**There are now TWO paks and they are not interchangeable.**

| pak | what it is | use it for |
| --- | --- | --- |
| `./build/phone` | `19:23 28-08-2026`, `MODELS=0` — no cars, no collision | every 09-05 row in the benchmark index. Keep it: those rows are only re-flyable against it |
| `./build/phone-cars` | `07:40 05-09-2026`, `MODELS=1 BAKE=1`, 5 vehicles, collision baked | anything with units drawn as models, and anything that will ever need collision |

`map_open` takes `out`, so you can point the console at either without touching the panel.

**Verify the app you are measuring by grepping the SERVED bundle, never by the stamp.** The stamp names the
last COMMIT and a prebuilt archive is always built before its own commit, so it reads one behind with a `+`
whenever the tree was dirty.

---

## 3. The work, in order

### 3.1 — The comparable row at the declared load

The first-look row is deliberately **not** comparable: new pak, ten-leg route not flown, 260 frames against
the 300 the collector asks for, three model types rather than five. Fly the route properly at
`board` against `./build/phone-cars` and file it as a row that can be subtracted from.

**The route, and it is not negotiable if a row is to be comparable.** Settle at `[1500,-1500]` h200
pitch −1.3 yaw π. Warm the rect's four corners (`[1380,-1620] [1620,-1380] [1380,-1380] [1620,-1620]`).
Return to the settle pose. **Reading A.** Fly the ten legs — the four corners, then `[1380,-1500]` h180,
`[1620,-1500]` h200, `[1500,-1620]` h220, `[1500,-1380]` h180, then the first two corners again.
**Reading B.** The window is the delta of the two `frame.dtHistogramMs` readings; moving is every bin below
the 100 ms tail; read the MEAN and the vsync ladder beside it.

**Pass every pose field explicitly** (`yaw: 3.141592653589793`, `projection: 'perspective'`) — the console
completes a partial pose from the one it holds, so an omitted field is no longer a black screen but an arm
flown at whatever yaw the last operator left is not the route.

### 3.2 — Instance the unit models

**12 197 draws.** ~80 a car, because a vehicle is a part hierarchy rather than a mesh. The
[frame audit](../../audit/frame-path-vs-aaa.md) ranked GPU-driven work as *interesting only at this load*;
this is the load. **Instancing comes before a culling pipeline** — the audit says so and the numbers agree:
150 units of 3–5 types is a handful of models drawn many times, which is what instancing is for.

**What bounds it**: `multi-draw indirect` and `bindless` are WebGPU **proposals**, not shipped surface.
Compute shaders and single `drawIndirect` are core. Design against that, not against the desktop shape.

### 3.3 — The 2D symbology layer

`overlay-2d` is **6.17 ms of an 11.65 ms CPU body** at 150 units — twice `engine-frame`. At the declared
count the CPU goes into the **2D layer, not the 3D one.** This is
[5/02](5-symbology-and-picking-as-product/readme.md)'s owed `board` − `field` subtraction, and
[9/01](9-the-mobile-frame/readme.md) already lists what is known to be waste in it: a label plate built from
four `arcTo` calls for a 1 px radius, and a fresh path per unit symbol per frame where a sprite cache is the
standard answer.

### 3.4 — What 4/04 still owes

Built today, unverified on the device: a **look verdict** that the sway now reads as continuous at map zoom,
`framesSkipped` before and after over a still map with foliage in frame, and **4/01's battery/thermal delta
re-taken** — this step is the thing most likely to have moved it, and it costs 4/01's whole win on any view
with foliage.

### 3.5 — The decision that needs the user, not you

[5/05](5-symbology-and-picking-as-product/readme.md) step 4. The user has decided that a unit should be *"an
ordinary GTA SA car — model, physics, drives on the map surface"*, which reverses a framing taken with them
on 2026-08-26 and written up as a
[restriction](../../restrictions/architecture.md) (now annotated UNDER REVIEW rather than deleted).

**Do not build it before putting the separation back to them**, with its five costs attached: collision
returns to the map profile's pak, the layer boundary moves (`apps/dispatch` currently reaches the game layer
through the environment driver alone), see-only residency stops qualifying, a dynamic body still may not
spawn outside its collision, and the frame budget re-opens at a load that is already 12 197 draws.

The separation is the part to settle: a **fed** unit's position is owned upstream and correcting it makes the
map disagree with the server, while a car the console **drives** is owned by nobody else. Those are two
different objects that both look like a car on a map.

---

## 4. The rules that shape any answer here

**The instrument's floor is measured per session and never carried over.** A null arm — one that removes
nothing — read **2.47 ms** on the morning of 09-05 and **~1.0 ms** that evening. `render/ablation.ts` used to
claim ~0.5 ms; that was inferred from the frame count, never measured.

**A delta is not a measurement until a control says it is not noise.** Twice in one day three windows agreed
on a story that was false — once for the probe, once for the vendor levers — and the same discipline caught
both: bracket the arm with its own baseline and sample both twice.

**An arm must be proven non-null before its number is read.** `?ablate=probe` was priced at 1.6 ms on a
surface where the probe has never rendered a face, because `apps/dispatch` never assigns `probeCenter`. The
report now carries `surface.probeFaces` so this cannot repeat silently; check what a pass is gated on in the
**host**, not only in the engine.

**Standing calls from the user.** Frame time may not be bought with resolution, sampling or anti-aliasing
(2026-09-04). Any change that alters the picture goes to the operator as an A/B **on the device** before it
is kept. A [protected-list](1-the-map-profile/protected-list.md) item is released by a field verdict and by
nothing else. A feature ships on a phone and on a desk in the same change.

---

## 5. Where the seams are

| what | where |
| --- | --- |
| the one place a console verdict lands | `apps/dispatch/src/world/console-budget.ts` |
| what a surface may ask for / what the device grants | `packages/engine/src/render/budget.ts`, `resolveRenderBudget` |
| the ablation arms | `packages/engine/src/render/ablation.ts`, `apps/dispatch/src/world/capture-ablation.ts` |
| the query knobs a capture reads | `apps/dispatch/src/world/capture-budget.ts` |
| the panel's link table (its test pins that a pair differs by ONE field) | `tools-debug/phone-console/app/links.mjs` |
| render-on-demand, and 4/04's animation rate | `apps/dispatch/src/world/render-gate.ts` |
| units as models | `apps/dispatch/src/map/unit-models.ts`, `world/model-source.ts` |
| what the mock board drives | `apps/dispatch/src/ops/seed.ts` (`DEMO_MODELS`), pinned against `scripts/phone.sh` |

---

## 6. Still unpaid, by everyone

- **No row in `docs/benchmarks/` records battery, charging state or die temperature.** Every thermal
  argument in this chain is made without them.
- **No capture records how many console tabs the browser holds**, which was the null arm's one unclosed
  candidate for its own spread. A capture that cannot count its competitors cannot bound its own noise.
- **Upstream has not been merged.** `AlexSergey/opensa` cannot be fetched from the web container (no
  credentials, and `add_repo` is refused there), so the fork's divergence is unmeasured. Do it from a
  checkout that can.
