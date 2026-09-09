# How San Andreas makes a place sound like a place

Recovered 2026-09-09 from [gta-reversed-modern](../links.md), reading
`CAEAmbienceTrackManager`, `CAEWeatherAudioEntity`, `CAETwinLoopSoundEntity` and `CAudioZones`, against the
real files on the phone. Written down because plan [203](../plans/203-audio/readme.md) was about to choose an
ambience design from an assumption, and the assumption was half wrong.

## The finding that matters most: there is no city hum

**San Andreas plays no general ambience bed anywhere.** The SFX bank enum has no ambience bank; nothing
loops a "city" or a "countryside" track under the world. A street sounds like a street because **cars, peds
and doors are emitting sounds** — the ambience is EMERGENT, not authored.

That is worth stating plainly because it is the opposite of what a modern engine usually does, and because a
surface with no traffic and no pedestrians — the dispatch console, for instance — cannot inherit it. There is
nothing there to emit.

## The two things that ARE authored, and they are not alternatives

### 1. Weather, from the SFX banks

`CAEWeatherAudioEntity` plays rain, wind and thunder out of the ordinary sound banks —
`SND_BANK_GENRL_RAIN` loaded into `SND_BANK_SLOT_WEATHER` — as continuous loops, with a volume it walks
towards a target (`notsa::step_to(m_sfRainVolume, targetVolume, 0.5f)`) rather than jumping. Rain is a stereo
pair placed left and right of the listener at ±0.423.

### 2. Zone tracks, from the streams

`CAEAmbienceTrackManager::UpdateAmbienceTrackAndVolume` takes the **active audio zone** — the `AUZO` rows of
the IPLs, through `CAudioZones` — and maps its id to a **stream track id** with a `switch`:

| zone id | track | note |
| --- | --- | --- |
| 4 | 143 | volume falls with camera height below z = 1372 |
| 5, 10 | 140, 139 | volume from the zone centre's distance to the camera |
| 13, 41 | 157, 169 | **overrides the radio** |
| 30 | — | plays the player's most-listened radio station instead (`CStats::FindMostFavoriteRadioStation`) |
| 37 | 144 | starts the track at its beginning rather than at a random point |
| 8, 12, 15, 17, 19, 20, 21, 23, 24, 25, 26, 28, 29, 34, 36, 39, 44 … | 135–169 | plain |

**Only a few dozen zone ids get a track**; the rest of the 155 zones get nothing from this manager. The
volume rule is per zone and hand-written, and the whole mapping is CODE — which
[directive 1](../project-goals.md) says is not ours to port. What is worth taking from it is the DATA inside:
which place is meant to sound like what, and that a zone's sound can be positional (two of them are) or
flat (most are).

Attenuation for the positional ones is
`CAEAudioEnvironment::GetDistanceAttenuation(distanceToCamera * 0.2f) - 6.f`.

## The idiom that makes a short loop sound continuous

`CAETwinLoopSoundEntity` is how SA hides a loop. It is small and worth copying by BEHAVIOUR:

- **Two sounds, same bank slot, started together.** One plays at its volume; the other is muted at −100 dB.
- **At a random time between `swapTimeMin` and `swapTimeMax`, the volumes are exchanged** — literally
  `next->m_Volume = std::exchange(curr->m_Volume, -100.f)` — and the next swap time is re-rolled.
- **Neither sound ever stops or restarts**, so there is no seam to hear and no click to fade.
- **The random interval is the point.** A fixed swap would make a rhythm, and a rhythm is what an ear learns
  and then cannot stop hearing. Rain swaps between **65 ms and 350 ms**.

It is not an ambience-only trick: vehicle skids, the frontend and ped audio all use it.

## What this repository already measured, alongside it

From [the 2026-09-09 census](../benchmarks/opensa-engine/2026-09-09-phone-audio-census.json):

- **`audio/streams/` is 15 files, 92.5 MB**, of which `AMBIENCE` alone is **44.4 MB** and `AA` is 0.7 MB.
  The 16-byte XOR and the 8 068-byte header are confirmed on the real files.
- **The SFX banks carry 351 looping sounds, 172 of them at least a second**, the longest 5.25 s — which is
  exactly the shape the twin-loop idiom is built for, and nothing like a pre-mixed bed.
