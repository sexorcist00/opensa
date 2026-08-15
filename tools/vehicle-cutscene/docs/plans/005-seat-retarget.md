# 005 — seat retarget: a cutscene actor sits in the DONOR's seat, not R\*'s

**Status: OPEN, designed 2026-08-15 (plan 004 round 22 is the research record).** An IMPROVEMENT over the
original in the goals-doc sense: R\* authored every cutscene actor's position against their own car, so a
converted donor whose cabin rides higher seats its occupants below their own seat. Measured on SMOKE2B:
**0.281 m low**. The user's design call, the same day: **read the donor's own seat dummies when it has
them, and fall back to the animation's authored placement when it does not.**

## The mechanism (measured, plan 004 round 22)

A cutscene actor's position is ABSOLUTE, out of the scene's own `anim/cuts.img` root channel;
`ped_frontseat` is read by the GAMEPLAY code only. That split is the whole finding — and the field's own
control proves it: the same glendale seats its GAMEPLAY ped perfectly (its dummy is used) while the
cutscene puts him 28 cm down (the dummy is not).

| quantity | value |
| --- | --- |
| SMOKE2B's actor offset from the car | z = −0.120 |
| `ped_frontseat`, STOCK gameplay glendale | z = −0.141 → **the scene was authored at R\*'s seat, within 2 cm** |
| `ped_frontseat`, the MOD's glendale | z = −0.048 |
| our ground lift `shiftZ` for this donor | +0.209 m (CORRECT and immovable: wheels compose to −0.70 against vanilla's −0.69) |
| the mod's seat point in cutscene space | z = +0.161 |
| **actor below the donor's own seat** | **0.281 m** |

## How big is this — the census (measured 2026-08-15)

Every scene in `anim/cuts.img` was walked for pairs whose root offset stays inside a cabin box with a
standard deviation under 0.12 m (a static track holds its last frame — a parked car gets 5 keyframes, and
comparing only the overlap made the first census miss RIOT_4B entirely):

| scene | car | actor | offset | seated |
| --- | --- | --- | --- | --- |
| FINAL2B | csbravura | csplay | `[0.52, 0.06, −0.11]` | 100 % |
| FINAL2B | csbravura | cscesar | `[−0.52, 0.01, −0.12]` | 99 % |
| SMOKE2B | csglendale92 | csplay | `[−0.51, 0.17, −0.11]` | 100 % |
| SMOKE2B | csglendale92 | cssmoke | `[0.50, 0.26, −0.15]` | 85 % |
| PROLOG1 | cstaxi92 | csstew | `[−0.24, 1.68, −0.08]` | 92 % |

**Three scenes, five actors, two cars.** Everything else the census caught is a prop riding a vehicle (an
ammo box on the bobcat's bed, the mothership's stand) and is out of scope. The x offsets come in ± pairs
around 0.5 m — the two front seats, mirrored, which is exactly how SA stores them.

## The design

1. **Read the donor's seats.** SA ships ONE `ped_frontseat` dummy (the passenger side); the driver is its
   x-mirror. `ped_backseat` likewise. Both are already in the mod clump the converter reads — no new input.
2. **Derive the delta per (car, actor), never per name.** `delta = (donorSeatZ + shiftZ) − sceneOffsetZ`,
   picking the donor seat whose mirrored x and y sit nearest the actor's measured offset. For SMOKE2B's
   csplay that is +0.281.
3. **Z ONLY.** The measured defect is vertical, and a full retarget would move an actor whose POSE is
   authored for R\*'s cabin — his hands would leave the wheel. Lateral and longitudinal placement stays
   the scene's.
4. **Fall back to the animation when the donor has no dummy** — the user's call, and it is also the safe
   default: a mod without `ped_frontseat` gives us nothing to derive from, so we change nothing.
5. **Patch the same way round 20 did.** `stash-patch.ts` already rewrites cuts.img channels in place
   (12 bytes per channel, chunk sizes untouched); this is a sibling pass over the ACTOR root channels.

### The one real design cost, and the v1 answer

An actor who is seated for only part of a scene walks up, opens the door and gets in. Lifting his whole
root track would float him while he walks; lifting only the seated frames pops at the boundary. **v1
patches only actors the census reports SEATED FOR THE WHOLE SCENE** — csplay in SMOKE2B, csplay and
cscesar in FINAL2B. cssmoke (85 %) and csstew (92 %) are left exactly as authored and recorded here as
the follow-up, which needs a blend and its own field round.

## Steps

- [ ] **1. The census as a real instrument.** Promote the throwaway walker into `scripts/debug/` with its
      row in `docs/debug/README.md` (what it answers: which scenes seat an actor in a converted car, and
      the per-frame offset). It is the input to step 2 and the guard for step 4. Verification: reproduces
      the five rows above.
- [ ] **2. Seat resolution in the converter.** Read `ped_frontseat`/`ped_backseat` from the donor,
      mirror for the opposite side, express in cutscene space (`+ shiftZ`), and report them per slot.
      Verification: unit test on the glendale — front seat resolves to z +0.161; a donor with no dummy
      resolves to null.
- [ ] **3. The patch pass.** Sibling to `stash-patch.ts`: for every fully-seated (car, actor) pair, lift
      the actor's root channel by the derived z delta. Verification: rebuilt `cuts.img` where SMOKE2B's
      csplay offset reads z ≈ +0.161, every other channel byte-identical.
- [ ] **4. Field.** SMOKE2B and FINAL2B, one sitting. LOOK-FOR: the occupants read through the glass at
      seat height; head clear of the roof (our glendale's is 0.27 m taller, so there is room); hands and
      feet not obviously detached from wheel and floor — the pose is R\*'s and only the root moved.
- [ ] **5. Contracts.** `docs/contracts/vehicles.md`: `ped_frontseat`/`ped_backseat` now carry behaviour
      in the CUTSCENE path too, and what happens when a donor omits them (nothing — the scene's own
      placement stands). Say it, because a missing dummy is silent by nature.

## Risks / open measurements

- The actor's pose is authored for R\*'s cabin; only the root moves. Step 4 is what decides whether a
  28 cm lift reads as "sitting properly" or as "floating".
- PROLOG1's csstew sits at y +1.68 — far forward of the taxi's root. Whether that is a seat at all or
  someone leaning on the bonnet is unresolved; the census flags it, step 3 skips it (92 %), and step 4
  should glance at it.
- A donor whose `ped_frontseat` is itself badly placed would now move the actor to a bad spot where today
  it merely sits low. The census's own offset is the sanity bound: refuse a delta that would put the actor
  outside the cabin box.
