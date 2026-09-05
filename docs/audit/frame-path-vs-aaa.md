# The frame path, audited against what AAA does — 2026-09-05

**What this is.** A pass-by-pass read of what OpenSA's frame actually does, set against the published
standard practice for the same problems, and ranked by what **our own measurements** say each difference
would buy. Written after 201/9 closed, because that chain ended with the frame sitting on the display's
floor and the honest question became *"is the shape right, or only the constants?"*

**What it is not.** A wish list. Every gap below carries what it would cost, what our numbers say it would
buy, and — for three of them — why the technique **cannot be expressed in WebGPU today at all**. Two entries
are the opposite of a gap: places where the generic advice is wrong for this target and our measurement says
so.

The measured record this reads against:
[the ablation sweep](../benchmarks/opensa-engine/2026-09-05-mobile-map-ablation-sweep.json),
[the bloom levers](../benchmarks/opensa-engine/2026-09-05-mobile-bloom-levers.json),
[the null arm](../benchmarks/opensa-engine/2026-09-05-mobile-ablation-null-arm.json) and
[the vendor levers](../benchmarks/opensa-engine/2026-09-05-mobile-vendor-levers.json).

---

## 1. The frame, as it actually runs

Read out of `Engine.frame()` rather than from any description of it. Device: MGA-LX3, ARM Bifrost, DPR 2,
`?surface=720x640`, `los-santos-centre`, board empty.

| # | Stage | What it is | Measured |
| --- | --- | --- | --- |
| 1 | CPU setup | camera matrices, one 104-float frame uniform, light pool fill | part of `engine-frame` 1.6 ms |
| 2 | `refreshSkyLut` | keyed on a quantized input; an early return on every frame after the first | µs |
| 3 | `scheduleProbe` | returns at `!probeCenter` — **the console has never rendered a probe face** | 0 |
| 4 | cull | sphere-vs-frustum + fog-cut per cell, over 4 resident cells | part of the same 1.6 ms |
| 5 | `bakeCloudField` | 256² two-fbm bake, **gated on travel since 9/06** | ~0 (was 1.8 ms) |
| 6 | **world pass** | ONE render pass: opaque bundles → objects → clutter → ped → vehicles → **sky** → water → skid → blend bundles → glass → particles → coronas | **3.8 ms** for 96 draws / 242 k tri |
| 7 | **bloom chain** | 1 prefilter + 8 downsample + 7 upsample = **16 render passes** | **7.7 ms** at full-res prefilter; ~3.3 after |
| 8 | post | godrays (20-tap radial) + bloom composite + ACES → sRGB swapchain | inside the 7.7 above |

**18 render passes a frame, 17 of them full-screen.** The frame is 17 ms with **90 % of frames on one
16.7 ms display interval**, and the single largest line in it is the post chain, not the world.

**The structural facts, established by grep rather than by memory:** no shadow maps (sun visibility and AO
are **baked**, 074/07), **no compute pipeline anywhere in the engine**, no indirect draws, no depth prepass,
no temporal anything, and no occlusion culling beyond the frustum and the fog cut.

---

## 2. Where we already match the standard — and two places where matching it means NOT doing the obvious thing

| Practice | Standard | Us |
| --- | --- | --- |
| **Reversed-Z depth** | universal since ~2014 for float depth precision | ✔ `depthClearValue: 0`, far plane at 0 |
| **Tile attachment discipline** | Arm's first recommendation: clear rather than load, never store a multisample attachment | ✔ `loadOp: 'clear'` on every attachment; 4× colour resolves and **discards**; `depth32float` **discards** |
| **Sky after opaque** | draw the background last so it shades only surviving pixels | ✔ the sky triangle is issued after the opaque bundles |
| **Tonemap last** | godrays → bloom → ACES, on the HDR sum | ✔ exactly this order, ACES fit as calibrated |
| **Command reuse** | WebGPU's render bundles are its answer to per-draw CPU cost | ✔ every cell is a pre-recorded bundle |
| **Half-resolution bloom** | the standard shape is a pyramid starting at half res | ✔ since 2026-09-05, on an operator's night verdict |
| **NO depth prepass** | **Arm: avoid them on Mali** — Forward Pixel Kill already does hidden-surface removal, and a prepass doubles both draw calls and processed vertices | ✔ we have never had one, and adding one would be a regression here |
| **NO compute for post** | AFBC cannot compress storage images, so a compute post chain surrenders framebuffer compression exactly where a tiler is bandwidth-bound | ✔ ruled out before it was written |

The last two are the ones worth stating loudly: they are cases where the **desktop-AAA** answer and the
**mobile** answer diverge, and this engine is on the mobile side of both on purpose.

---

## 3. The gaps, ranked by what our own numbers say they would buy

### 3.1 — Nothing is measured at the load the budget actually declares (**the top item, by a distance**)

Every number above is from a map with **no units on it**. 201's declared budget is **150 units drawn as
models with symbols over them**, and **no capture in this repository has ever been taken at it**
([5/04](../plans/201-dispatch-console/5-symbology-and-picking-as-product/readme.md)). At 96 draws we are
vsync-bound and every micro-lever is invisible — which this session proved twice, at a cost of two arms that
read nothing. At 150 units × their submeshes the draw count moves by an order of magnitude, and that is
where every remaining item on this list either binds or does not.

**So the ranking below is provisional by construction, and the first optimisation task is a measurement.**

### 3.2 — Opaque draw order is never sorted front-to-back

Arm's Forward Pixel Kill has done automatic hidden-surface removal since Mali-T620, but **its efficiency is
sensitive to draw order** on everything before Mali-G725 — that is precisely why the newer Fragment Prepass
is advertised as letting applications *stop* sorting. The 2/03 device is Bifrost, i.e. the sensitive side.

We sort **blend** cells back-to-front (`orderBlendBundles`) and do not sort **opaque** cells at all —
`bundles.push(cell.bundle)` walks `Map.values()` in insertion order. Two levels to it:

- **Between cells** — five lines, reusing the distance the blend path already computes. But **four cells are
  resident at map zoom**, so sorting four bundles is worth approximately nothing here. It would matter in
  the game, at street level, with a full ring.
- **Inside a cell** — the draw order is **baked by `opensa-pack`**, grouped by material and texture array
  rather than spatially. Front-to-back within a cell is therefore a **build-time** decision that has never
  been taken, and per [build-vs-runtime](../restrictions/build-vs-runtime.md) it cannot be retaken at
  runtime.

**Not shipped, deliberately.** The runtime half is cheap and standard and its win here is below the ~1–2.5 ms
noise floor — which is exactly the shape of change this session already refused twice. It is worth taking
**together with 3.1**, where a busy frame can actually show it.

### 3.3 — No GPU-driven culling, and the AAA form of it is not expressible in WebGPU yet

The 2026 desktop standard is: a compute pass culls, writes surviving instances into a buffer, and one
**multi-draw indirect** call draws them — so the CPU cost stops scaling with object count entirely.

**Two thirds of that is unavailable to us.** `multi-draw indirect` and `bindless` are **feature proposals**
in the WebGPU pipeline, not shipped surface. What *is* core is compute shaders plus single
`drawIndirect`/`drawIndexedIndirect` — enough for compute culling that writes an instance count, not enough
for the one-call-for-everything shape.

Our CPU cull is a sphere test over 4 cells and is not a cost worth attacking. **This becomes interesting
only at 3.1's load**, and even then the honest first move is instancing the unit models, not a GPU culling
pipeline.

### 3.4 — No occlusion culling

Standard for city scenes at street level, where a facade hides a block. **Nearly worthless at map zoom**:
the console looks down from 180–220 m, where almost nothing occludes anything. High value for the game,
low for the surface this chain is about — and the frustum + fog-cut pair already removes what a top-down
camera can remove.

### 3.5 — The bloom chain builds levels down to 2×2

`bloomMinLevelPx` defaults to 1, so at a 360×320 base the chain builds eight levels, the last of them a few
pixels across — six textures, six bind groups and six uniforms for mips smaller than a chip. **Measured at
0.2 ms**, i.e. nothing. It is object count and memory, not frame time, and the budget field to fix it
already exists and is simply not set by the console.

### 3.6 — No dynamic shadows at all

Static sun shadowing and AO are **baked** (074/07), which for a world that never moves is better than a
shadow map, not worse. But a **unit drawn as a model has no contact shadow of any kind**, and at 3.1's load
that is 150 vehicles floating on the road. This is a **look** gap rather than a performance one, and the
cheap standard answer (a blob or a projected quad) belongs to 5/04 rather than here.

### 3.7 — No temporal techniques

TAA and temporal upscaling are the desktop standard for both quality and cost. Two reasons they are not
simply missing: the standing call forbids buying frame time with resolution, sampling or anti-aliasing; and
a dispatch map's units arrive at **4-second intervals** from a self-reported feed
([202](../plans/202-pcad-dispatch/readme.md)) with no motion vectors that mean anything. A temporal pass
here would smear exactly the objects the operator is watching.

---

## 4. What the evidence overturns about the generic advice

**"Every render pass costs a tile flush on a tiler, so cut the pass count."** True in general and **false
here as a lever**: cutting the chain from eight levels to four removed four whole passes and cost **0.2 ms
of a 23.4 ms frame**. On this device a pass over a small mip is free, and the money was in the FIRST levels
— the bytes moved by the two or three biggest passes. Halving where the pyramid *starts* bought **4.4 ms**
where removing four passes bought nothing.

**"fp16 is roughly 2× on Arm ALUs, so use it."** Sound, and **unmeasurable here**: with the colour maths at
half width and Bjørge's five-tap downsample kernel in place of Jimenez's thirteen, the combined arm read
16.83 / 17.86 ms against a baseline of 17.42 / 16.89 — the ranges overlap and the slowest of the four
windows is a vendor window. Both levers provably do less work; the frame does not notice, because 90 % of
frames already sit on the display's floor.

**The general form of both**: *a lever worth tenths of a millisecond cannot be seen from under a vsync
floor, and an engine that is display-bound at its current load is optimised at the wrong load.* That is
§3.1, and it is why it is first.

---

## 5. The conclusion

**The shape is right.** Forward rendering with baked visibility, one world pass, reversed-Z, discarded
multisample attachments, sky after opaque, tonemap last, render bundles for the static world, and no depth
prepass — that is the correct mobile-forward answer, and three of those are places where following desktop
AAA would have made this frame slower.

**The constants have been taken as far as this instrument can see.** Chain 9 moved the frame from 48 ms to
17 with 90 % of frames on one display interval, and the last four levers it tried all landed inside the
noise.

**So the next optimisation is not a lever, it is a load.** Measure the frame at the 150 units the budget
declares, drawn as models, with the symbology over them. Everything in §3 is ranked against a frame we have
never seen, and at least three of those rankings will change when we do.

---

## Sources

- [Arm GPU Best Practices — avoid depth prepasses](https://developer.arm.com/documentation/101897/0304/Optimizing-application-logic/Avoid-using-depth-prepasses)
  and the [Best Practices guide](https://documentation-service.arm.com/static/67a62b17091bfc3e0a947695) — Forward
  Pixel Kill since Mali-T620, and why a prepass doubles draw calls and vertex count.
- [Immortalis-G925: the Fragment Prepass](https://developer.arm.com/community/arm-community-blogs/b/mobile-graphics-and-gaming-blog/posts/immortalis-g925-the-fragment-prepass)
  — culling that is *not* sensitive to draw order, which is what tells you the older parts are.
- [The Mali GPU: an abstract machine, part 2 — tile-based rendering](https://developer.arm.com/community/arm-community-blogs/b/mobile-graphics-and-gaming-blog/posts/the-mali-gpu-an-abstract-machine-part-2---tile-based-rendering)
  — 16×16 tiles.
- [Post-processing effects on mobile: optimization and alternatives](https://developer.arm.com/community/arm-community-blogs/b/mobile-graphics-and-gaming-blog/posts/post-processing-effects-on-mobile-optimization-and-alternatives)
  — the post budget our 7.7 ms was judged against.
- [Bjørge, *Bandwidth-Efficient Rendering* (SIGGRAPH 2015)](https://community.arm.com/cfs-file/__key/communityserver-blogs-components-weblogfiles/00-00-00-20-66/siggraph2015_2D00_mmg_2D00_marius_2D00_slides.pdf)
  — dual filtering, adapted in 9/05b.
- [What's next for WebGPU](https://developer.chrome.com/blog/next-for-webgpu) — multi-draw indirect and
  bindless as **proposals**, which is what bounds §3.3.
- [PlayCanvas — indirect drawing](https://developer.playcanvas.com/user-manual/graphics/advanced-rendering/indirect-drawing/)
  and [Indirect draws in WebGPU](https://tigerabrodi.blog/indirect-draws-in-webgpu-and-why-they-re-so-powerful)
  — the GPU-driven shape as it exists in WebGPU today.
- [AFBC](https://www.arm.com/technologies/graphics-technologies/arm-frame-buffer-compression) — why the post
  chain stays in fragment shaders.
