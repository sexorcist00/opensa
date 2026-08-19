# A DFF's frame list must be topologically ordered — RenderWare parents in the same pass it creates

**Measured 2026-08-19 from the shipping `gta_sa.exe` (1.0 US) and a field crash.** A fact about the
original engine's format handling, not about OpenSA.

## The rule

In a DFF's **Frame List**, every frame carries a `parentIndex`. RenderWare's clump reader creates each
frame and parents it **inside the same loop**, so a frame whose parent index is GREATER than its own index
reads an array slot that has not been written yet:

```
807b1c  movl %edi,(%edx,%ebp,4)   ; frames[i] = the frame just created
807b1f  movl 0x54(%esp),%eax      ; parentIndex, straight from the stream
807b23  testl %eax,%eax
807b25  jl   0x807b47             ; < 0 → it is a root, skip
807b32  movl (%ecx,%eax,4),%edx   ; frames[parentIndex]  <-- UNWRITTEN when parentIndex > i
807b38  calll 0x7f0b00            ; RwFrameAddChild(parent, child)
```

There is no bounds check and no ordering check. **A forward parent reference is undefined behaviour**, and
what happens next is decided by whatever the uninitialised slot happens to hold — which is why this class
presents as intermittent.

## What it looks like when it goes wrong

```
Unhandled exception at 0x007F0BF7 in gta_sa.exe (+0x3f0bf7): 0xC0000005: Access violation reading location 0x00000099.
    EAX: 0x00000000  ESI: 0x00000001  EIP: 0x007F0BF7
```

`0x7F0B00` is `RwFrameAddChild`; `+0xF7` is `movl 0x98(%esi),%eax`, the parent's child-list pointer. `ESI`
is the parent — here **1**, the raw index left in the unwritten slot, so the read lands at `0x99`. The stack
carries the caller chain into `CFileLoader::LoadAtomicFile` (`0x5371F0`), so the crash is on **reading the
model**, not on mounting it.

MixMods' `CrashList.txt` files `0x007F0BF7` as *"Frame did not find the child, it usually occurs when trying
to install a tuning part in a vehicle in which it does not support it"* — the symptom people meet, one step
downstream of the cause.

## The case that found it

Field: tuning a `blade` at Transfender crashes **sometimes**; viewing tuning part **1107** in RZL Trainer
crashes **every time**. 1107 is `wg_r_lr_bl1`, the right side skirt.

`blade` on this install is a mod (`blade - 1964 Ford Thunderbird - gross`, files dated 2008) that ships its
own tuning parts. Of every part in that mod and every stock control, exactly one has a forward reference —
and it is 1107:

| file | frames | parents | atomic frameIndex |
| --- | ---: | --- | ---: |
| mod `wg_l_lr_bl1.dff` | 2 | `[-1, 0]` | 1 |
| mod **`wg_r_lr_bl1.dff`** | 2 | **`[1, -1]`** | 0 |
| stock `wg_r_lr_bl1.dff` | 1 | `[-1]` | — |

The two mod files are the mirrored pair, byte-for-byte the same size (1 736 B) and the same chunk layout:
the right one simply serialises the SAME two-frame hierarchy child-first. Semantically identical, fatal to
this reader.

"Sometimes" at Transfender and "always" in the trainer follow from the same fact — the crash is on the
model READ, so it only fires when 1107 is actually streamed in, and what the unwritten slot holds decides
whether it faults or silently corrupts.

## What it means for us

- **Our pipeline is not the cause and cannot be**: the built archive's copy is byte-identical to the mod's
  own file. Byte-faithful conversion preserves a mod's latent bugs — the same lesson as
  [`mod-dff-winding-and-atomic-frame.md`](../open-issues/fixed/mod-dff-winding-and-atomic-frame.md).
- **It is invisible in OpenSA.** Our own reader resolves parents by INDEX
  (`for (let at = i; at >= 0; at = frames[at].parentIndex)` — `packages/renderware/src/mesh/frame-transform.ts`
  and friends), so order does not matter to it. A file that works perfectly in our engine can still kill the
  target — which is exactly why this needs a build-side check rather than a runtime one.
- **The repair is a pure reordering**: swap the two 56-byte frame records and their two name-extension
  chunks, rewrite the parents to `[-1, 0]`, and move the Atomic's `frameIndex` from 0 to 1. The file stays
  1 736 bytes and nothing else moves.

Neighbour: [`carmods-unknown-part-crash.md`](carmods-unknown-part-crash.md) — the other tuning-part crash of
this install, a `carmods.dat` token with no IDE row.
