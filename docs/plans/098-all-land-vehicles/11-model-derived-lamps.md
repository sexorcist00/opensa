# 11 — Model-derived lamps: light what the model authors, and nothing else

**Goal:** a vehicle's night lighting derives from what its own asset carries. Field symptom that opened
this: the user reported that the hotring has no working headlights in his SA install even without the
CLEO script that exists to smash them — while in OpenSA the same car lights up. Field checkpoint: a
trailer, a tow box and an aeroplane show no headlights at night, and every car that authors lamps still
lights exactly as it did.

**Not a hardcode.** No model id appears anywhere below — every rule reads the dummy positions and
material tags the asset itself ships, so it applies to whatever a modder installs into a slot. That
matters more here than usual: 098 exists to install and field many custom cars.

## What is measured (2026-08-07, `scripts/debug/lamp-census.ts` over both archives)

**Per model, the two things an asset can say about its lamps:** a `headlights`/`taillights` dummy (real,
at the model ORIGIN, or absent) and how many submeshes carry a head/tail lamp material.

Stock SA archive, 170 vehicles:

| | dummy real | dummy at ORIGIN | dummy absent | no lamp material |
| --- | --- | --- | --- | --- |
| head | 154 | 1 (`dumper`) | **15** | 29 |
| tail | 156 | 1 | **13** | 28 |

- **12 models carry no usable lamp dummy at either end**: the trailers (`artict1/2/3`, `farmtr1`,
  `utiltr1`, `bagboxa`, `bagboxb`, `tugstair`) and the aircraft (`androm`, `at400`, `cargobob`,
  `cropdust`, `nevada`, `rustler`). **OpenSA gives every one of them headlights today.**
- **27 carry no lamp material at either end** (28 in the built archive — the extra one is the modded
  `hotring`): 11 that also have no dummy at all (`androm`, `at400`, `bagboxa`, `bagboxb`, `cargobob`,
  `cropdust`, `farmtr1`, `nevada`, `rustler`, `tugstair`, `utiltr1`), 12 with both dummies real
  (`bloodrb`, `combine`, `dodo`, `freiflat`, `hunter`, `kart`, `leviathn`, `quad`, `rcbandit`, `rccam`,
  `rctiger`, `shamal`) and 4 mixed (`artict2`, `artict3`, `rdtraint`, `hydra`).
- **That 27 is NOT the blast radius of Rule B**, and conflating the two is easy: `coach` is absent from
  it because it carries a REAR lamp material and lacks only the front one. Applied per END, Rule B would
  newly darken **30 ends across 18 models** — every end whose dummy is real while its material count is
  zero. See the Rule B step.

**The car the report came from**, measured rather than assumed:

| | `headlights` | `taillights` | lamp materials | `ivflights` |
| --- | --- | --- | --- | --- |
| stock `hotring` | real | real | **head + tail** | 0 |
| the installed mod (Buick Regal, pav3l) | 0.802, 2.538, −0.059 | **0, 0, 0** | **none of 91 submeshes**, every `nightTwin=0` | 0 |

So the mod's car authors no lamps at all and zeroes its rear dummy; the STOCK car it replaces authors
both. The modded build differs from stock by exactly one zeroed tail dummy and one lamp-material-free
model — this car.

## SA's own rule, recovered

`CVehicle::DoHeadLightBeam` (0x6E0E20), gta-reversed:

```cpp
CVector pointModelSpace = mi->GetModelDummyPosition(2 * dummyId);
if (dummyId == DUMMY_LIGHT_REAR_MAIN && pointModelSpace.IsZero())
    return;
```

A missing dummy reads back as (0,0,0) from `CVehicleModelInfo::m_avDummyPos`, and `IsZero()` IS the
absence test. **SA has no fallback anywhere** — what the model does not author, the game does not light.

## What we did instead, and why it is a defect

`lampAnchorsOf` invented an anchor from a fraction of the half-extents when the dummy was missing, and
took a zeroed dummy at face value. So OpenSA gave the 15 dummy-less models headlights that exist in no
asset, and put both of the hotring's tail lamps at the car's own origin — which is the red glow on its
rear deck in the 2026-08-07 field capture.

## Design

- **Rule A (this step).** A lamp anchor is the model's dummy or NOTHING: absent, or within float noise
  of the model origin, means that end has no lamp — no beam, no pool light, no corona. The half-extents
  fallback is deleted, not softened.
  - **Deviation from SA, deliberate:** SA guards only the REAR on `IsZero`; a zeroed FRONT dummy makes it
    draw the beam from the car's centre. We treat zero as absent at both ends — a beam emitted from
    inside the bodywork is not something an author asked for. One stock model is affected (`dumper`,
    both dummies zero); it keeps its glowing lamp glass, which is material-driven.
- **The MESH half already derives correctly** and is not touched: the lit-twin swap and the emissive glow
  key on the submesh's lamp material (`vsRigid`), so a model with no lamp glass has nothing to light.
- **Rule B is NOT taken here.** "No lamp material → no beam either" would make the modded hotring fully
  dark, matching the report — but measured per END it newly darkens **30 ends across 18 models**, and
  `DoVehicleLights` (0x6E1A60) is still a plugin-call stub in gta-reversed, so there is no source to
  settle whether SA's corona comes from the dummy or the material. A field A/B decides it, not an
  argument. Step 2.

  The ones a player actually drives at night, which is where the verdict will be won or lost:

  | Model | What Rule B takes |
  | --- | --- |
  | `coach` | **the bus's headlight beam** — the strongest argument against |
  | `bloodrb` (Bloodring Banger) | both ends |
  | `combine`, `kart`, `quad` | both ends |
  | `tractor` | rear lamps |
  | `artict2`, `artict3`, `rdtraint`, `freiflat` | rear lamps (trailers/train) |
  | `dodo`, `hydra`, `hunter`, `leviathn`, `shamal` | aircraft — not flyable this version |
  | the RC trio (`rcbandit`, `rccam`, `rctiger`) | both ends |
  | the modded `hotring` | **the front beam — the outcome that opened this plan** |

## Steps

- [x] Rule A: `lampAnchorsOf` returns null for an absent or origin dummy, `lampsOf` emits only the ends
      that exist, the half-extents fallback is deleted. Negative tests first. Field: trailers and
      aircraft dark, every lamp-authoring car unchanged.
- [ ] Rule B go/no-go: a field A/B on a car with a head dummy but no head material (`coach` is the stock
      case) — does dropping its beam read as a fix or as a regression? Verdict into this ledger.

## Verification

Headless: the lamp suites (a model with no dummies emits nothing; an origin dummy is not an anchor), and
`scripts/debug/lamp-census.ts` re-run after the change so the affected model list is a measurement rather
than a prediction. Field: night A/B — an `artict1` and a `hotring` against a lamp-authoring car.

## Ledger

### Step 1 — Rule A, and FIELD: PASSED (2026-08-07)

`lampAnchorsOf` now answers null for an end whose dummy is absent or within `1e-6` of the model origin,
`lampsOf` skips that end, and the half-extents fallback is gone. ~20 lines, no new abstraction.

Guarded by two tests in `vehicle-lamps.test.ts`, **both verified to fail with the null-skip reverted**:
a car with no lamp dummies yields `{front: null, rear: null}` and no lamps at all, and a dummy at the
origin is not an anchor (that car keeps its two head lamps and loses its two tail lamps).

**Field A/B, night, same spot, seated** (captures in the session):

| Run | Result |
| --- | --- |
| the modded `hotring` | **the phantom red glow on the boot deck is GONE** — that was both tail lamps sitting at the car's own origin. The head beam remains |
| `admiral` (authors both ends) | unchanged: both tails glow, headlight pool on the asphalt |

**The hotring's front beam is still there, and that is Rule A working correctly, not a miss** — its head
dummy is real (0.802, 2.538, −0.059). Fully darkening that car is Rule B's job, and the field is the only
thing that can decide it (below).

**Honest scope of what this fixes today.** Our lamps only light the car being DRIVEN, so the 12
dummy-less models are not all visibly fixed right now — trailers are never driven, and the aircraft that
carry no head dummy are not flyable in this version (0.6.0 roadmap). What IS fixed today is every car
whose dummy is zeroed or missing while it is driven — the hotring's case, confirmed above — and the rule
is in place before 098 installs the custom cars that will hit it. Recorded so nobody reads the 12-model
census as 12 visible fixes.

### Note for the custom-model rounds this plan exists for

`ivflights` — ImVehFt's own light geometry — is a convention we do NOT read. In the current fleet exactly
one model carries it (the GTA 5 Rhino, 15 submeshes) and it also authors standard lamp materials and
dummies, so nothing depends on it today. **That is a property of today's fleet, not a rule**: the user
expects more ImVehFt-authored cars as 098 installs them, and for such a car "no standard lamp material"
would mean "its lamps are authored somewhere we do not look", not "it has no lamps". Re-run the census
after each batch — it prints the `ivflights` cross-tab for exactly this reason. Recorded in
[`docs/edge-cases/converter-pipeline.md`](../../edge-cases/converter-pipeline.md).
