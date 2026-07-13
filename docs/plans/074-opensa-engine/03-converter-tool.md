# 074·03 — Converter tool (`tools/opensa-pack`)

[← chain](readme.md) · prev: [02 formats](02-native-formats.md) · next: [04 lab+P0](04-engine-lab-p0.md)

Game-ready file set → `.ospak`. Sits AFTER the whole existing chain (map-optimizer prelight → lod-generator →
installer output); consumes the exact files the prod web app loads (gta3.img + IDE/IPL + timecyc), so the new
format inherits prelight, LODs, merges and mods automatically. Existing tools never learn about it.
Composition-first: parsing = `@opensa/renderware`; grid/cell assignment = the same IPL logic the engine uses.

## Pipeline stages (deterministic, per-cell parallelizable)

```
load game set → resolve cells (HD + LOD levels, IPL targets — existing logic)
  → per cell: gather models → mergeable predicate → weld into groups → per-vertex layer assignment
  → texture collection → CLASSIFY α → process α subset → bucket into arrays → emit .ostex
  → emit .oscell (+ object/light tables) → pak writer + manifest → budget report
```

### The mergeable predicate (from 066/02, finalized here)

Merged into groups: plain static geometry (the ~90 % single-placement world + repeated props — instances get
their transform BAKED into vertices at convert time; no runtime instancing needed for statics).
Kept as ObjectRecords: `timed` (on/off hours), `breakable` (must vanish independently), IDE-`anim`, roadsign
text, 2dfx anchors. DoubleSided (0x200000) merges into `side=double` groups — never mixed with front-side.
Implementation status: `timed` and 2dfx-light anchors are live; IDE-`anim` currently welds into the plain
STATIC groups at bind pose (2026-07-12 field fix, 06 row 17 — skipping deleted whole buildings), and moves
to ObjectRecords when plan 08 promotes them to animated entities; `breakable`/roadsign kinds land with
plan 08 (see its coverage matrix).

### The ALPHA PIPELINE (early, M0 — this is where [alpha-edge](../../open-issues/alpha-edge.md) dies)

1. **Classification** per texture (decoded alpha histogram): `opaque` (all 255 — pass through untouched),
   `cutout` (bimodal: leaves/fences/gratings), `softBlend` (everything else). Manual override list in the
   config for the inevitable dozen weird ones.
2. **Edge dilation** on the base level: flood transparent texels' RGB from nearest opaque (full BFS — the
   capped-pass variant left gaps; both learned in the open issue, decoder already exists).
3. **Premultiply** RGB by alpha.
4. **Mip chain offline**: alpha-weighted downsample (transparent texels contribute nothing to RGB) + per-mip
   **coverage preservation** for cutouts (scale each mip's alpha so the % of texels passing `cutoutRef` matches
   the base level — the classic fix for foliage thinning out at distance).
5. **Re-encode**: BC3 in v0 (own encoder or wasm — options: `bc7enc_rdo` wasm build, `basis_universal` CLI,
   or hand-rolled BC3 [we already have the decoder; the encoder is ~200 lines]). BC7 = v1 upgrade, measured.
6. Odd-size textures (62×62 …): resample to nearest pow2 BEFORE the above (kills WebGPU BC alignment forever).

**Acceptance for this stage is VISUAL + automated**: the harness renders vgsebushes / Upt_Fence_Mesh / fence_64
against a mid-grey background and diffs edge luminance vs the known-bad baseline; plus "no black halo" manual
sign-off at M0.

### Texture-array bucketing

Group by (W, H, format, wrap-compat) → assemble arrays (cap layers at device limit margin, e.g. ≤ 256/array).
Assignment is GLOBAL (arrays shared across cells — a district reuses a handful of arrays), manifest records the
mapping; per-vertex layer indexes written during group weld. Report: array count, fill rates, orphan textures.

### Budget guards + determinism (pmb spirit, non-negotiable)

Config caps: max bytes/cell, max groups/cell (HD 8 / LOD 4 to start), max arrays, max layers. Exceeding FAILS
the build with the offending cell listed. Fixed ordering everywhere (sorted inputs, no map-iteration
nondeterminism); same input ⇒ byte-identical pak (hash-tested in CI).

## CLI shape

`opensa-pack --game <dir> --out <dir> [--cells x0,y0,x1,y1] [--district ls] [--report] [--only-textures]`
— district/rect filtering is what makes M0 (one district) and incremental work cheap; `--report` emits the
measurement ledger tables (bytes, groups, arrays) the plan docs consume.

## Tasks

- [ ] Scaffold `tools/opensa-pack` (nx package; deps: renderware parsers + engine-formats) — after approval.
- [ ] Cell resolve + gather (reuse grid/IPL logic; unit tests against a fixture district).
- [ ] Mergeable predicate + group weld + per-vertex layer assignment (tests: group counts, winding/side
      preservation, transform baking correctness vs a rendered reference).
- [ ] α classification + override config + histogram tests on real textures (the issue names the cases).
- [ ] Dilation port (from issue groundwork) + premultiply + alpha-weighted mips + coverage preservation —
      golden-image tests per mip level.
- [ ] BC3 encoder decision spike (own vs wasm; quality + speed table in the ledger) → implement.
- [ ] Pow2 resample for odd sizes (quality check on the known 62×62 cases).
- [ ] Array bucketing + manifest + pak writer + `--report`.
- [ ] Determinism test (double run ⇒ identical hashes) + budget-guard failure tests.
- [ ] M0 run: one LS district; ledger filled; hand blobs to 04.

## Measurement ledger

(convert time, pak size vs source slice, groups/cell histogram, array fill rates, α-subset size)
