# The dispatch map opens VOID — cell bytes arrive, no cell is created, and nothing says so

**Found 2026-08-31 on the phone** (MGA-LX3 / ARM Bifrost, DPR 2), while taking
[201/9-01](../plans/201-dispatch-console/9-the-mobile-frame/readme.md)'s three-arm circuit through the
console's MCP channel. It killed one arm of that circuit — `field`, which is THE FIELD RUN itself — and
every number the chain is meant to subtract from is taken in that arm, so it blocks the chain rather than
inconveniencing it.

## The symptom

The console boots, fetches the district's cells, and draws an empty world for as long as it is left open.

```
warnings: ["VOID: no cells streamed (cellsTotal 0) — these numbers describe an empty world."]
errors:   []
bytes.byKind: cell-hd 4 requests / 2 644 738 B      ← the bytes ARE in
world:  cellsTotal 0 · cellsVisible 0 · draws 12 · triangles 113 494
streaming: cellsCreated 0 · lateCreates 0 · worstCreateMs 0
```

The screenshot is black with the scale bar reading 5000 m at a 600 m camera. `errors` is empty, so the app
reports nothing at all; the only thing that says the window is worthless is the collector's own `VOID`
warning ([`world/inventory.ts`](../../apps/dispatch/src/world/inventory.ts)), which exists for exactly this.

Two attempts, both on app `4ce659b`, pak `19:23 28-08-2026` (ASTC), district `los-santos-centre`:

| | window | drawn / skipped | `cell-hd` fetched | `cellsCreated` | `pendingCells` |
| --- | --- | --- | --- | --- | --- |
| first | 156.0 s | 343 / 1357 | 8 requests, 5 289 476 B | 0 | 0 |
| second (fresh load) | 86.4 s | 19 / 851 | 4 requests, 2 644 738 B | 0 | **4, and stuck** |

## What it is NOT

- **Not the pak and not the district.** The `engine` and `cleared` arms — the same URL rule, the same pak,
  the same district, the same six-pose route, minutes earlier in the same session — created **12** and
  **28** cells and drew 112 draws over 4/4 cells.
- **Not a fetch failure.** The bytes arrived: the request counts and byte totals above are the console's own
  `bytes.byKind`, and `cachedRequests` shows most of them served from the browser cache on the second
  attempt.
- **Not (only) the render gate sleeping through an arrival.** That was the first hypothesis, and it is the
  obvious one: [`world/boot.ts`](../../apps/dispatch/src/world/boot.ts) calls `world.follow()` — the only
  thing that turns an arrived blob into a cell — *after* `gate.shouldDraw()`, and the gate's signals carry
  `lastStream.pendingCells` / `created` / `evicted`, values refreshed only by a drawn frame. A blob landing
  while the loop is asleep changes none of them. **But a `map_goto` — a wake, a flight, and drawn frames,
  so `follow()` ran — did not clear it**, and the first attempt had 343 drawn frames. So the gate may be
  part of it; it is not the whole of it.

## Where to start

1. Reproduce with the streamer's own counters open: whether `follow()` is being handed the arrived blobs at
   all, or is refusing them (the ring test against the camera's ground point and the drawing-buffer height —
   the second attempt's `pendingCells` sat at 4 while the camera stood over the district centre at 600 m).
2. The `pendingCells` 4 → creation path is the narrow suspect: four cells in flight, four blobs fetched,
   zero created, nothing pending afterwards on the first attempt and four pending forever on the second.
3. Whether it correlates with a tab that was **backgrounded during boot** — both attempts were opened by
   `phone_run open` while another console tab held the foreground, and Android freezes a tab that is not in
   front. If it does, it is a resume path rather than a streaming bug, and the fix is still ours: a console
   that comes back from a freeze with bytes in hand and no cells must either create them or say so.

## What was built instead of a fix (2026-08-31, the same day)

Nothing here is repaired — the cause is not known, and guessing at one would be a fix nobody could verify.
What was built is the instrument the diagnosis needs, because every list above ends in *"we cannot tell from
the capture"*:

- **`StreamStats` counts what a wanted cell is blocked ON** — `blockedOnBlob` and `blockedOnArrays`, per
  update, a cell in exactly one of the two, blob first (`packages/engine/src/stream/streaming.ts`). The
  split costs nothing and it is the difference between the three failures above: nothing wanted is the RING,
  blocked-on-blob is the fetch path, blocked-on-arrays is the texture-upload path.
- **The `VOID` warning names the cause** rather than the symptom (`world/inventory.ts`, `voidCause`), so the
  next occurrence arrives as *"4 cells want a level, 1 waiting on their geometry blob, 3 on a texture
  array"* instead of *"no cells streamed"*.
- The counters are READINGS in the report (`streaming.pendingCells` / `blockedOnBlob` / `blockedOnArrays`),
  never sums: the same four cells blocked for a thousand frames are four, not four thousand.

So the next field run either reproduces this with a named cause, or does not reproduce it — and both of
those are progress from here. It reaches the device with the next `prebuilt/opensa-webapp.tar.gz`.

## What it blocks

[201/9-01](../plans/201-dispatch-console/9-the-mobile-frame/readme.md)'s `field` arm, and with it the
`field` − `cleared` subtraction and every re-take chain 9 owes on the map run
([the circuit's row](../benchmarks/opensa-engine/2026-08-31-mobile-map-circuit-arms.json)).
