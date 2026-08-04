# 2 — Universal textures: one pak, every GPU

**Gate: [concepts/universal-texture-transcode.md](../../../../../concepts/universal-texture-transcode.md).**
The direction is decided (Basis/KTX2 + transcode at load); what is *not* decided is whether the quality
survives the trip, and that is a measurement, not an opinion. No step below starts before the concept's
go/no-go.

## What makes this cheap, and what makes it expensive

Cheap: **`.ostex` is already the right shape.** One `texture2d_array`, every layer the same W×H×format, full
mip chain baked offline, premultiplied, 256-byte-aligned rows so `queue.writeTexture` consumes the payload
verbatim. Models use the same container (`tools/opensa-pack/src/model-ostex.ts` — "no new format was
needed"), so **one format change covers the world, the vehicles and the peds.** If a transcode stage outputs
that same aligned layout, then `beginOstexUpload`, the resumable upload drain, the alpha classification, the
render bundles and every shader are untouched.

Expensive: SA ships **DXT**, so a universal encode is a second generation of loss on the world's textures.
That is the concept's whole question. (Models are already re-encoded today — `model-ostex.ts` runs
`encodeDxt` over the dictionary — so for vehicles and peds this is not a new class of loss.)

## 01 — `.ostex` v1: the container gains a supercompressed payload

The reader already rejects an unknown major (`unsupported .ostex major`), so **the break is caught, loudly,
by code that exists**. Bump `OSTEX_VERSION_MAJOR` 0 → 1.

- New format ids for the universal payload + a supercompression field; `width`/`height`/`layers`/`mipCount`
  and the per-layer record (`nameHash`, `alphaClass`, `cutoutRef`, `wrap`) stay exactly as they are.
- The invariant to preserve in the type: a *decoded* `.ostex` still hands out the layer-major, mip-minor,
  256-aligned payload. Universal changes what is on disk, not what the uploader receives.
- Verification: round-trip tests per format; an old reader against a v1 file must fail with the version
  message, not with a payload-size mismatch.

## 02 — The encode side (`opensa-pack` / `cell-weld`)

- `--textures=universal|bc|rgba8`, defaulting per the concept's verdict. `bc` keeps today's DXT passthrough
  byte-for-byte — it is the desktop-quality reference and the A/B partner.
- The alpha pipeline runs **before** the universal encode, unchanged: premultiply, dilate, classify
  (cutout / soft-blend / opaque), `cutoutRef`. A universal encoder that re-orders that pipeline silently
  changes 1 422 cutout layers.
- **The run this chain owes:** two paks from the same tree with only the switch flipped. Plan 092 shipped
  without its equivalent and its `pass` column is unreadable for it; this chain does not repeat that.

## 03 — The transcode side (worker)

- The transcoder (wasm) lives in the pak worker, next to the existing decode; the target format is chosen
  from the device's feature set — BC7/BC1 where BC exists, ASTC 4×4 where it does, ETC2 otherwise, RGBA8 as
  the last resort.
- Output is the existing aligned layout, so the upload path is unchanged and keeps the applied
  **≤1.5 ms/frame** drain ([texture-upload-budget](../../../../../performance/applied/texture-upload-budget.md)).
- Budget: transcode is off-frame by construction, but it is not free — it must not starve the worker's
  streaming duty. Measure per-array transcode ms on desktop **and** on the phone; a per-array cost that
  exceeds the cell's streaming deadline is a finding, not a footnote.
- Watch the resource-lifetime restriction: a texture array that **grows** invalidates every bundle recorded
  against it. The pak path never welds incrementally, so this stays clear — but a transcoder that "fills in
  layers later" would walk straight into a use-after-destroy the driver reports however it feels like.

## 04 — Models, and the single-mip decision

`model-ostex.ts` writes a **single level** — no mips. On a phone that is a texture-cache and aliasing
decision, not just a size one, and vehicles are the assets a player looks at from a metre away.

- Re-price mips for model dictionaries on the mobile target.
- Cross-check the parked lever: [one texture array per vehicle, at its largest texture's
  size](../../../../../performance/deferred-optimizations/vehicle-texture-array-buckets.md) — 220 → 34 MB by
  buckets, ~24 → 3.5 MB VRAM per type. On a phone that lever is likely to stop being optional; if this chain
  pulls it, it moves to `performance/applied/` with its before/after.

## 05 — The map on a phone

The end of the chain and the bundle's headline: a **real district** of the real map, universal-encoded,
loaded and driven on the Mali row's device.

- The benchmarks index already names this debt: the mobile first-light row "is owed a successor on a real
  `--rgba8` district". This step pays it with a universal pak instead.
- **Same change:** rewrite `browser-runtime.md`'s "Mobile GPUs: no BC, so no SA-built pak" section — it
  describes a limitation this chain removes, and `edge-cases/` holds current limitations only.

## Acceptance

- One pak, produced once, loads on a BC desktop and a no-BC phone.
- Desktop quality: no visible regression at the field's own judgement, with the concept's PSNR/SSIM floor met
  on the full texture set.
- Desktop performance: the eight-scene sweep neutral-or-better against a same-tree `--textures=bc` pak.
- Phone: a district loads, drives, and produces a benchmark row that names its adapter, its DPR and its pak.
