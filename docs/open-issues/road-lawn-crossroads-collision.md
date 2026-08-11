# Collision defect at the `road_lawn34` × `road_lawn01` crossroads

**Status: 🔴 open, reported 2026-08-11, not investigated (the user's call: record it, do not fix it yet).**

## Symptom

On the `sa` build, the collision misbehaves right on the junction where `road_lawn34` and `road_lawn01`
meet — the crossroads itself. Reported by the user from a drive; the exact failure mode (a lip, a hole, a
wall, a wrong surface) is not written down yet, only that collision is wrong there. **His own first
suspicion: an incompatibility introduced by one of the installed mods, not stock data.**

The two models, from `find-instances.ts` against the stock tree:

| model | id | placement | source |
| --- | --- | --- | --- |
| `road_lawn34` | 5802 | 1124.57, −950.24, 41.76 | `LaWn.ipl`, lod-link 31 |
| `road_lawn01` | 5747 | 1084.47, −1048.88, 32.07 | `LaWn.ipl`, lod-link 110 |

## What is already known, before anyone starts

- **No mod ships either model by name.** Nothing under `mods-src/original/` mentions `road_lawn34` or
  `road_lawn01`, and no mod carries a DFF or COL file named after them. So if a mod is responsible it is
  through a **wholesale COL archive replacement**, not a per-model override.
- **The first suspect is therefore `0. Map Fixes Pack`**, which replaces the lawn area's collision archives
  outright: `gta3_img/lawn_1.col`, `lawn_2.col`, `lawn_4.col` (and `law_3.col`; `5. SA Xbox Map Features`
  replaces `law_4.col`). Whichever of those holds these two models is where to look first — a replaced
  archive is byte-faithfully installed by us, so **it also carries the mod's own latent defects**, which is a
  pattern this repo has hit before (`docs/open-issues/fixed/mod-dff-winding-and-atomic-frame.md`).
- **The obvious A/B is a build with `0. Map Fixes Pack` excluded** — cheap, and it splits "mod defect" from
  "our pipeline defect" in one field round without any code being read.
- `road_lawn34` is *also* one of the confirmed texel-smear models
  ([`texel-smear-authored-uv.md`](texel-smear-authored-uv.md), 1124.6, −951.4, 40.9). Almost certainly a
  coincidence — that defect is in UVs and this one is in collision — but worth knowing the model has two
  open entries against it.

## What is missing from this report

The failure mode itself. Before anyone spends a build on it, get from the field: does the car stop dead,
climb, sink, or lose grip; is it a thin seam or an area; and does it happen on foot too. That distinction
picks the tool (COL dump vs surface-type read) and this entry cannot pick it.
