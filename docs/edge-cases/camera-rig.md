# Camera rig (080 director) — edge cases

Current limitations of the shipping follow camera (`apps/web/src/ui/camera/`). Read alongside
`docs/features/camera.md`; the shelved rework that would lift the first entry is
[`docs/ideas/aaa-camera-polish/`](../ideas/aaa-camera-polish/readme.md).

## The vehicle yaw chase is MUTED mid-corner (hands-off, hard corners)

The 09 directional yaw authority (`smoothstep(footYawAuthorityStart, footYawAuthorityFull, away)`) applies
in VEHICLE mode too, and mid-corner the car's velocity crosses the frame → away ≈ 0 → the auto-center
chase and any in-flight turn-follow swing are suppressed (`step.released` drops the target). Measured live
(2026-07-28, headless `?phys=u-turn` + a `[peek]` log): after a hands-off u-turn the yaw FROZE ~135° off
"behind the car" for 10+ seconds while the heading kept moving — a self-sustaining deadlock (camera
sideways → motion across the frame → authority 0) until any mouse input.

Consequences:

- Hands-off driving through a hard corner can leave the camera hanging off-axis for many seconds. Mouse
  input hides it, which is why four 080 field rounds never caught it.
- **Any camera writer that is only non-zero in corners cannot ride the auto-center heading channel** — it
  is muted exactly where such a writer lives. This killed the 080/10 corner peek twice (2026-07-28); the
  full diagnosis and the rework order live in the idea doc above.

Nothing catches this today (no test drives a hands-off hard corner); the idea's R3 step would turn that
scenario into a transitions-suite exam.

## Composition writers must share ONE frame of reference and ONE time authority

From the same rounds: a look-point offset expressed in the camera's SCREEN frame rotates while a yaw swing
is in flight, and an offset decaying on its own clock while the yaw channel swings on another reads as a
JUMP ("sticks and jumps in big corners"). Constraint on any future look-point writer: express the offset
in the CAR's heading frame, give it a spring slower than the yaw channel, and hold its target while a
steered swing (`yawTarget`) is active. Detail in the idea doc §3.
