/**
 * The console's library entry: the map surface, without the console's own chrome.
 *
 * `main.tsx` mounts a whole application — top bar, panels, the mockup board. A host that already HAS a
 * dispatch board (a CAD with its own units, calls and radio) wants none of that; it wants the map, fed from
 * its own data. That is what this entry exports, and it is deliberately nothing new: the two boot functions
 * below are the same ones `app.tsx` calls, so an embedding host and this repo's own console run identical
 * code and cannot drift.
 *
 * What a host owes the surface:
 *
 * - **two stacked canvases of the same size.** The WebGPU one takes the gestures and must carry
 *   `touch-action: none`; the overlay is the symbology and must not eat pointer events — except in plan
 *   mode, where the surface hides the WebGPU canvas and claims the overlay itself.
 * - **a live board getter.** `ops()` is called once a frame; it must be cheap and must not allocate a new
 *   board per call if the host can avoid it.
 * - **configuration through `window.__opensaDispatch`**, not the address bar. A host owns its own URL, and
 *   the surface must not read it — see `dispatchParams`.
 * - **the pak worker chunk served beside the bundle**, at the path the bundle names. A single-file build
 *   only ever runs `demo=1`; with a real `src=` it 404s on the worker with the manifest already fetched,
 *   which reads as a hang rather than a missing file.
 *
 * Full write-up: `docs/features/dispatch-console.md`.
 */

export type { GtaGround } from './map/coords';
export type { CursorPick, MapPose } from './map/map-camera';
export { MAP_YAW, MapCamera } from './map/map-camera';
export type {
  Incident,
  IncidentPriority,
  IncidentStatus,
  Operations,
  Selection,
  Unit,
  UnitKind,
  UnitStatus,
} from './ops/types';

export type { BootOptions, DispatchHandle, DispatchReadout, MapClick } from './world/boot';
export { bootDispatch, dispatchParams } from './world/boot';
export { bootPlanMode } from './world/plan-mode';
