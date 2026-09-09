# `audio/streams/` — the authored zone tracks, decoded and not used

**Came out of** [203/4-02](../plans/203-audio/readme.md), 2026-09-09, the step that was BLOCKED on which of
two products a zone's ambience is.

## What was investigated, and what is already known

Everything needed to play a stream is measured and written down. Nothing here is research left to do:

- **The obfuscation is broken.** `audio/streams/*` is a repeating 16-byte XOR —
  `EA 3A C4 A1 9A A8 14 F3 48 B0 D7 23 9D E8 FF F1` — then an **8 068-byte header** (1000 beat entries of
  8 bytes, 8 length pairs, a 4-byte footer), then plain **Ogg Vorbis**. Confirmed on the real files by the
  `OggS` magic appearing exactly where the arithmetic says it should.
- **The size is priced**: [15 files, 92.5 MB](../benchmarks/opensa-engine/2026-09-09-phone-audio-census.json), of
  which `AMBIENCE` alone is **44.4 MB** and `AA` is 0.7 MB.
- **`scripts/debug/audio-streams-probe.ts --dump` already writes one out as a playable `.ogg`**, so any
  question about what a track SOUNDS like is one command away.
- **The mapping is recovered**: `CAEAmbienceTrackManager::UpdateAmbienceTrackAndVolume` maps an AUZO zone id
  to a track id (135–169) with a hand-written `switch`, with per-zone volume rules — two positional, one
  overriding the radio, one starting at the beginning rather than at a random point. The whole table is
  transcribed in [audio-ambience.md](../gta-sa-original/audio-ambience.md).

## Why it is deferred

**Two reasons, and the second is the one that decides.**

1. **Scope.** Plan 203's own first decision puts `audio/streams/` out of v1 — *radio and ped speech are
   deliberately out* — and a zone track is served by the same reader as the radio.
2. **The user chose the assembled bed** (2026-09-09, through the Ask Menu: *"Строить окружение"*). The
   census settled that the SFX banks carry enough to assemble one — **351 looping sounds, 172 of them at
   least a second** — and an assembled bed is the product a mod author can change by dropping a bank in,
   while a stream is what Rockstar mixed once.

There is a third, smaller reason worth recording: a decoded stream is a **44.4 MB** artifact against a
**64 MB** audio budget, and it would be fetched whole because `decodeAudioData` decodes a whole buffer.
Range-fetching a Vorbis stream by page is a fourth piece of work nobody has scoped.

## THE TRIGGER

**A zone that has no assembled bed at all, or one an ear calls thin.** Concretely, either of:

- `AmbienceReport.layers` is 0 while a bed is named — the event table carries no `AMB_` row for the place;
- the operator's ear round on 4/02 says the assembled bed does not carry a place SA's own `AMBIENCE` track
  does.

## Where the trigger is checked in code

- **`AmbienceHost.noLayers(bed)`** in [`packages/audio/src/ambience.ts`](../../packages/audio/src/ambience.ts),
  called once per bed that resolved to nothing. Its doc comment names this card.
- The console wires it to `AudioAbsence.unknownName` in
  [`apps/dispatch/src/world/audio.ts`](../../apps/dispatch/src/world/audio.ts), whose call site names this
  card as well — so the condition reaches a capture (`audio.absence.reasons`) and a log line, not just a
  folder.

## What it would cost when the trigger fires

The decode path is a day: XOR, skip 8 068, hand the rest to `decodeAudioData`. What is NOT a day is
everything after it — a per-zone track table (ours, not the `switch`), the 44.4 MB against the budget, and
the streaming fetch that avoids paying it all at once.
