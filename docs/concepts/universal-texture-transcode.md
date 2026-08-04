# Concept — universal textures in `.ostex` (Basis/KTX2 + transcode at load)

**Status: live, go/no-go pending.** Opened 2026-08-04 as the gate on
[plan 097 / chain 2](../plans/097-platform-reach/2-universal-textures/readme.md).

## The question

A pak built from SA assets is BC throughout — the converter passes SA's own DXT blocks through untouched —
and **BC is desktop-only**. Mobile GPUs ship ETC2 and ASTC, never BC. So "which devices can run this world"
is decided by the converter at build time and cannot be re-taken at runtime
([restrictions/assets-and-data.md](../restrictions/assets-and-data.md#a-worlds-texture-format-decides-which-gpus-can-display-it)).

The chosen direction is **one universal payload, transcoded to the device's format at load**. The direction
is decided. What is not decided — and what this concept exists to settle before a line of code — is whether
the quality survives, at what size, and at what per-array cost.

## Why it is not obviously fine

**SA ships DXT.** A universal encode therefore starts from already-lossy blocks, and the device then
transcodes *again*. That is generation 2 on the world's textures, and the failure mode is not a crash: it is
a world that looks slightly worse everywhere, which is exactly the kind of regression this project's own
rules say must be demonstrated rather than assumed.

Two things soften it. Models already take a second generation today — `tools/opensa-pack/src/model-ostex.ts`
runs `encodeDxt` over each dictionary — so for vehicles and peds this is not a new class of loss. And the
`bc` passthrough stays available as a build switch, so the desktop can keep the zero-loss path if the
measurement says it must.

## What the container makes easy

`.ostex` is already "one `texture2d_array`, every layer the same W×H×format, full mip chain offline,
premultiplied, 256-byte-aligned rows". Models share it. If the transcoder's **output** is that same aligned
layout, then `beginOstexUpload`, the resumable ≤1.5 ms/frame upload drain, the offline alpha classification
(1 422 cutout / 661 soft-blend / 380 opaque across 43 arrays) and every render bundle are untouched. The
change is on disk and in the worker, nowhere else.

The version break is **caught by code that already exists**: `decodeOstex` rejects an unknown major with a
named error.

## The go/no-go, stated as numbers

The concept graduates only if all of these hold. Each is a measurement, taken before analysis and recorded in
`docs/benchmarks/` per the standing rule.

| Question | How it is answered | Bar |
| --- | --- | --- |
| Quality | PSNR/SSIM of the transcoded result vs the DXT-decoded reference, over the **whole** shipped texture set — not a sample | A stated floor, plus **no visible regression at field judgement** on the two scenes the record already calls fill-heavy |
| Size | Pak bytes vs the current BC pak (reference: 1 272 901 632 B at 1137 cells) | Not materially larger; smaller is the expectation |
| Transcode cost | ms per array, desktop **and** the Mali row's phone | Must not starve the worker's streaming duty; the upload keeps its existing budget |
| Alpha fidelity | The classification pipeline's outputs before/after | Identical counts; cutout edges are the thing SA content is most sensitive to |
| Reach | One pak uploads on a BC adapter and a no-BC adapter | Binary |

**A no-go is a real outcome.** If quality fails, the honest fallback is the per-target offline encode
(ASTC + ETC2 variants chosen at load) — more build outputs, more bytes to host, no second generation of loss.
That is the path this concept would die into, and it would go to `docs/postmortem/` with the numbers that
killed it, not be quietly reworded.

## Open questions

- **UASTC vs ETC1S**, or both by texture class? Cutout foliage and vehicle paint have very different
  tolerances, and the pipeline already classifies every layer — the classification could pick the encoder.
- **Where does the transcoder come from**, and what does its wasm cost at boot on a phone?
- **Is the mip chain worth keeping universal**, or should mips be generated after transcode on the device?
  (Today the chain is baked offline and the runtime never generates mips — a deliberate rule, and models ship
  a single level.)
- **What does a fitted quality knob look like** when it appears — because one will, and it gets a file in
  `docs/hacks/` naming what it was judged on.

## Exits

- **Survives** → its research record moves into the chain-2 plan folder and the steps begin.
- **Dies** → `docs/postmortem/`, with the per-target encode named as the successor.
