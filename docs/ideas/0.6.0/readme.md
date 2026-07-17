# Ideas — 0.6.0

Future-work plans for the 0.6.0 cycle. Same convention as [0.5.0](../0.5.0/readme.md): each feature is a
chain of small plans under [plans/](plans/).

## Dynamic vehicle deformation (VehDeform-style, GTA4 feel)

Impact-driven MESH deformation of vehicle bodies (not just the SA ok/dam part swaps): dents scale with
impact force and direction, accumulate, and stay. Reference projects researched: zzpuma's VehDeform 1.0
(SA, dynamic deformation by impact strength) and Kiminaze/VehicleDeformation (FiveM — radius/falloff vertex
displacement from impact points). Feasibility verdict inside: **very portable to the 074 engine — we own
the vertex pipeline**, which is exactly what the SA modders had to hack around.

Full plan: [plans/01-vehdeform/readme.md](plans/01-vehdeform/readme.md).

## Water realism (own-engine v4+)

The 074 water v3 (baked depth field, oscillating foam front, swash surge) hit the ceiling of "analytic
shader x 2005 sprite textures" — user parked it: the look needs AUTHORED textures first (foam atlas,
ocean normal maps — buying assets is approved), then live tuning knobs, a baked shore-direction field,
a refraction tap off the plan-09 scene target, and the Gerstner-Jacobian whitecaps carried over from the
deleted 0.5.0 water idea.

Full plan: [plans/02-water-realism/readme.md](plans/02-water-realism/readme.md).

## Graphic improvements — shadows + street-lamp lighting (DRAFT)

A draft bundle of three parked look questions, kept together because one thinking round (possibly the
hd-realtime concept decision) may answer them all: (01) baked directional sun shadows, second attempt —
moved from ideas/0.5.0/03, the receiver-densification prerequisite stands; (02) street-lamp surface
lighting v2 — light ALL lamps of the loaded HD cells at once (the 2026-07-17 field observation says the
budget likely exists), killing the ignition-pop artifact class by construction; (03) contact darkening/
shadows for dynamics — the "SSAO for cars/peds" question reformulated (near cascade / capsule AO / blob
v2 candidates).

Full bundle: [plans/04-graphic-improvements/readme.md](plans/04-graphic-improvements/readme.md).
