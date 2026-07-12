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
