# 098/2 — Real device truth: the trimmed console, a real district, real hardware

Second rather than first, and deliberately so. Dropping bytes that are never read needs no device to justify
it — but the **tuning** half of the profile (rings, resolution, residency) may not aim at a device nobody has
measured, and the first real mobile row in this repo should be a row of *the thing we intend to ship*.

The stakes beyond this chain: [097/1-04](../../097-platform-reach/1-device-truth/readme.md) refused to write
a residency ceiling because WebGPU exposes no VRAM and a number invented before a device is measured is a
fitted constant with no residual. This chain is what unblocks it.

## Steps

### 01 — A phone-sized district pak

Built with the [chain-1 profile](../1-the-map-profile/readme.md) and `opensa-pack --rgba8` (which converts
the model dictionaries too, since 2026-08-04 — a car is not in the pak), over the **district pinned in
[1/01](../1-the-map-profile/readme.md)** — not a fresh one, or the before/after stops being an A/B. Record the exact
invocation, and what `--platforms mobile` reports
(`tools/opensa-pack/src/platforms.ts`, `docs/development/mobile-pak.md`).

**Owes:** bytes and cell count, **profiled against unprofiled**, so chain 1's claim is visible on the artifact
that actually ships. Record which pak build every later run reads (standing rule).

### 02 — Serve it from the shareable build

The console inlines to a single file **for `?demo=1` only**. The pak worker is emitted as a separate
`assets/pak-worker-*.js` chunk which `?demo=1` never constructs, so the gap stayed invisible until a real pak
was streamed on a phone and the console 404'd on the worker with the manifest already fetched
([features/dispatch-console.md](../../../features/dispatch-console.md#verification)).

Close it: a real `?src=` must stream from the built artifact, at the path the bundle's own code names.

**Owes:** the console streaming a real pak out of the built artifact, and a note in the feature doc replacing
the known-gap paragraph.

### 03 — The field run

A real phone, the 01 district, panned and zoomed the way an operator does — not a static frame, and not a
synthetic city. This is the run the whole chain exists to produce.

**Owes:** a row in `docs/benchmarks/` under the **mobile schema**
([097/1-02](../../097-platform-reach/1-device-truth/readme.md)) — adapter features *and what is missing*, no
`gpuMs` column when there is no `timestamp-query`, `featureLevel`, DPR, CSS px, and the pak's platform field.
Numbers: fps p50 **and p95** (the synthetic row has no p95, so it cannot see a hitch), cells visible/total,
draws, resident MB, and the cold-entry cost the desktop measures at 235 ms.

Record the row **before** analysing it (standing rule), and state plainly that mobile and desktop rows are
not comparable.

### 04 — The residency ceiling, derived

Not written — **derived from 03**. The rule the ceiling has to satisfy: it comes from what the device did,
not from a per-device table, and it says what it was measured over.

**Owes:** the ceiling, and it is handed back to
[097/1-04](../../097-platform-reach/1-device-truth/readme.md) with the row it came from.

## Verification

- The row exists, in the mobile schema, and names the pak build it read.
- A second run on the same device reproduces the band; a single capture is not a measurement.
- The claim "a real district, driven on a real phone" is either true with a row behind it or is not made.
