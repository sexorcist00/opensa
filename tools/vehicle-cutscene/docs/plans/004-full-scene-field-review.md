# 004 — full scene field review: every vehicle cutscene checked, then the approval

**Status: PLANNED 2026-08-13 (the user's call: check ALL cutscenes and sign off).** Plans 002/003
field-verified the conversion on FOUR scenes (intro ×2 gates, STRP4B2, PROLOG3). This plan sweeps
every vehicle cutscene in the game — all **35 scenes** the ANPK census found cs vehicles in — through
the cutscene-override instrument (cleo/scripts plan 003: one ini edit per scene, ~15 s to the verdict,
no story progression), records a per-scene verdict, fixes what the field finds, and ends with the
user's blanket APPROVAL of the cutscene fleet.

**Build under review:** the bottle's `NO_COMMIT/cs-mods-plates/` (full 23-model fleet + baked plates,
self-contained TXDs). A fix round re-runs the tool and re-drops `cutscene.img` (+ `txdcut.ide` when it
changes); every fix is one variable per round, per the standing field workflow.

## Coverage facts (measured)

- 35 scenes drive cs vehicles; **21 of 23 models appear** in at least one. The two that appear in
  NONE: `csdinghy` (002 step 9's named gap) and `cscopcarla` — but `cscopcarla` shares its donor and
  its conversion path with `cscopcarla92` byte-for-byte, so it is covered INDIRECTLY by every
  cscopcarla92 scene; only its slot NAME goes unexercised.
- The heaviest models: `csremington92` (4 scenes), `csglendale92` (4), `cscopcarla92` (6),
  `cszr350/b` (4). One scene (`STRP4B2`) and one model (`csmtbike92`) are already field-passed —
  re-checked here only if a later fix touches the shared emit.

## Step 1 — the sweep (user, batched; the ledger IS the record)

Arm each scene (`scene = <name>` in the bottle ini), run, verdict into the table. LOOK-FOR per run:
every listed vehicle present and mod-shaped; standing on its wheels both sides; doors/parts riding
their anims where the scene moves them; gameplay paint (no green/pink markers); plates readable on
plated cars; nothing floating, sunk, detached or stacked (variant containers).

Suggested order: the first column covers every model at least once by scene 13 — a defect that is
per-MODEL shows early; the rest of the sweep then guards the per-SCENE surprises (odd camera angles,
scene-specific anims).

| # | Scene | cs vehicles | Verdict |
| --- | --- | --- | --- |
| 1 | PROLOG1 | cstaxi92 | ✅ (gate 4/7 + 003) |
| 2 | PROLOG3 | cscopcarla92, cstaxi92 | ✅ (gate 4/7 + 003) |
| 3 | STRP4B2 | csmtbike92 | ✅ (002 step 8) |
| 4 | DESERT9 | csbobcat92 | |
| 5 | BCESA4W | csbravura, cszr350b | |
| 6 | BCESAR4 | cssavanna, cszr350 | |
| 7 | BCESAR5 | cssadler, cszr350, cszr350b | |
| 8 | DES_10B | csmothership | |
| 9 | DESERT1 | csmonster | |
| 10 | FARL_3B | csburrito92 | |
| 11 | FINAL2B | csbravura, cssabre92 | |
| 12 | GARAG3A | csremington92 | |
| 13 | HEIST8A | cssecurica92 | |
| 14 | RIOT_4B | csgreenwood | |
| 15 | RIOT4E1 | cscopcarsf, csfirela | |
| 16 | SMOKE1B | csglendale92 | |
| 17 | SWEET2B | csgreenwood, csvoodoo | |
| 18 | SYND_3A | cswashington | |
| 19 | SYND_4A | cssavanna, cswashington | |
| 20 | BCESA5W | cszr350, cszr350b | |
| 21 | BCRAS1 | cscopcarla92 | |
| 22 | BCRAS2 | cscopcarla92 | |
| 23 | CESAR1A | cssavanna | |
| 24 | CRASH3A | cscopcarla92 | |
| 25 | CRASV2A | cscopcarla92 | |
| 26 | CRASV2B | cscopcarla92 | |
| 27 | RIOT4E2 | csfirela | |
| 28 | SCRASH2 | csbravura | |
| 29 | SMOKE2B | csglendale92 | |
| 30 | SMOKE3A | csglendale92 | |
| 31 | SMOKE4A | csglendale92 | |
| 32 | STEAL_2 | csremington92 | |
| 33 | STEAL_4 | csremington92 | |
| 34 | STEAL_5 | csremington92 | |
| 35 | TRUTH_2 | csmothership | |

## Step 2 — fix rounds (as found)

- [ ] Each field finding gets its own round record here (one variable per round): what was seen, the
      root cause, the fix, the re-check verdict. A finding that changes the SHARED emit re-opens the
      already-✅ scenes of the affected branch for one re-check.
- [ ] Anything that becomes a permanent rule lands where its family lives in the same change
      (contracts / edge-cases / the plan-002 emit header).

## Step 3 — the approval

- [ ] All 35 rows carry a verdict; open findings zero. **The user's blanket approval closes the
      plan** — and with it the scene-coverage half of 002 step 11's acceptance (the pipeline-build
      half stays with 002: this sweep runs on the bottle's self-contained build).

**Record:** rounds spent, findings found/fixed, the approval verbatim.
