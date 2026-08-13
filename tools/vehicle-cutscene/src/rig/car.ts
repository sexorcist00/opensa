/**
 * The car branch: a mod's gameplay DFF → its cutscene counterpart, shaped by the vanilla template.
 *
 * THE EMIT MODEL (v3, after gate 7's door/wheelbase round, 2026-08-12): cutscene animations bind by
 * frame NAME (`CAnimBlendAssociation`, gta-reversed `CCutsceneMgr`) and drive every animated bone's
 * LOCAL — relative to its PARENT — to the vanilla model's values. So each template-matched bone keeps
 * the VANILLA local (the anims' bind pose), and the donor's differing placement is absorbed by an
 * un-animated SHIM frame inserted between the bone and its parent: `shim = inv(W_parent) ∘ shift_z ∘
 * W_donor ∘ inv(L_vanilla)`. The anim then swings a door around the MOD's hinge (the shim moved the
 * pivot), wheels stand on the MOD's corners including the wheelbase, and geometry is carried UNBAKED —
 * closed pose AND animated pose are both exact, which the earlier vertex-bake could not do (a door
 * opened around the vanilla hinge with a baked mesh detached by the hinge delta — the gate-7 field
 * round). Stock donors yield identity shims, i.e. none at all.
 *
 * Still true from the earlier rounds:
 *   - part set = template ∩ mod by canonical name; every other visible mod mesh is ADOPTED under its
 *     nearest carried ancestor (fresh bone ids, un-animated) — only `_dam`/`_vlo` and f_wheel variant
 *     containers stay out, one mesh per `f_extras`/`f_class` container;
 *   - a `<part>_ok/_dam` frame under its own dummy carries junk the game destroys — the hinge is the
 *     dummy; every OTHER mesh frame (stock copcarla's junk-space chassis) keeps its transform;
 *   - LEFT wheels on identity-rotation templates (cscopcarla/cstaxi92 style) get a MIRRORED geometry
 *     copy (x flipped, triangles rewound) — the shared unmirrored wheel showed its inner barrel
 *     outward; z-180 templates (bobcat style) mirror through their own bind rotation;
 *   - `shift = (tplNodeZ − tplRadius) − (modDummyZ − modRadius)` aligns the donor's ground plane.
 *
 * The branch-agnostic emit machinery lives in `rig/emit.ts` (shared with the bike branch).
 */
import { parseDff } from '@opensa/renderware/parsers/binary/dff';

import { canonicalPartName, type CsTemplate, geometryZHalfExtent, toArrayBuffer, type WheelCorner } from '../template';
import { mirrorGeometryBodyX } from './bake';
import { type ClumpAtomic, type ClumpModel, type OpaqueChunk, readClump, writeClump } from './clump-io';
import {
  adoptedFrameName,
  buildHierarchy,
  childrenByFrame,
  collectDropped,
  type ConvertReport,
  type Emit,
  emitAtomic,
  emitBone,
  emptyEmit,
  hingeFactory,
  inYearVariantSubtree,
  lift,
  nearestCarriedAncestor,
  ORPHAN_SKIP_RE,
  pushFrame,
  reservedFrameNames,
  variantContainerOf,
  worldTransforms,
} from './emit';
import { compose, IDENTITY_ROTATION, invert, type Transform } from './matrix';

/** The game rig's wheel dummies (mirrors `build-vehicle-model.ts`'s WHEEL_DUMMY_RE; `m` = 3-axle middles,
 *  which no cutscene template has — they land in `droppedFromMod`). */
const WHEEL_DUMMY_RE = /^wheel_([lr])([fmb])_dummy$/;
/** `f_wheel_<mask>` container frames — the IVF-style wheel sub-model four of the real mods ship instead
 *  of a mesh under the dummies (mirrors the engine builder's WHEEL_CONTAINER_RE + first-atomic pick). */
const WHEEL_CONTAINER_RE = /^f_wheel/;

export type CarConvertReport = ConvertReport;

interface ModAnalysis {
  atomicByFrame: Map<number, ClumpAtomic>;
  chassisIndex: number;
  chassisTransform: Transform;
  /** The space the frame's GEOMETRY is authored in: the dummy's for a `<part>_ok/_dam` under its own
   *  dummy (the game destroys that junk), the frame's own full world otherwise. */
  hingeOf: (frameIndex: number) => Transform;
  model: ClumpModel;
  /** frame transform relative to the mod's root frame. */
  relativeToRoot: (frameIndex: number) => Transform;
  wheelAtomic: ClumpAtomic;
  /** Frames inside `f_wheel_*` containers — never adopted as parts. */
  wheelContainerFrames: ReadonlySet<number>;
  wheelDummies: Map<WheelCorner, number>;
  wheelMeshIndex: number;
  wheelRadius: number;
}

/** Convert one mod car DFF into its cutscene counterpart. Throws when the mod has no usable chassis,
 *  wheel dummies or wheel mesh — a car that cannot stand is an error, not a silent skip. */
export function convertCar(modDff: Uint8Array, template: CsTemplate): { dff: Uint8Array; report: CarConvertReport } {
  const analysis = analyzeMod(modDff, template);
  const shiftZ = groundShift(template, analysis);
  const emit = emptyEmit({
    intermediate: template.intermediate,
    nextBoneId: nextFreeBoneId(template),
    rootName: template.rootName,
  });
  const report: CarConvertReport = {
    adoptedFromMod: [],
    droppedFromMod: [],
    missingInMod: [],
    parts: [],
    shiftZ,
    shimmed: [],
  };

  emitBody(emit, template, analysis, shiftZ, report);
  emit.frames[1].hierarchy = buildHierarchy(emit.frames);
  collectDropped(emit, analysis.model, report);

  const dff = writeClump({
    atomics: emit.atomics,
    frames: emit.frames,
    geometries: emit.geometries,
    version: analysis.model.version,
  });

  return { dff, report };
}

/** Carry every remaining mod mesh (the game renders them all in gameplay) as a child of its nearest
 *  CARRIED ancestor — door glass swings with its door; body/interior shells ride the chassis. */
function adoptOrphanParts(
  emit: Emit,
  analysis: ModAnalysis,
  shiftZ: number,
  chassisFrame: number,
  carriedFrames: ReadonlyMap<number, number>,
  report: CarConvertReport,
): void {
  const reserved = reservedFrameNames(emit);
  const servedVariantContainers = new Set<number>();
  for (const atomic of analysis.model.atomics) {
    const index = atomic.frameIndex;
    const canonical = canonicalPartName(analysis.model.frames[index].name);
    const skip =
      carriedFrames.has(index) ||
      index === analysis.wheelMeshIndex ||
      analysis.wheelContainerFrames.has(index) ||
      ORPHAN_SKIP_RE.test(canonical) ||
      inYearVariantSubtree(analysis.model, index);
    if (skip) {
      continue;
    }
    const container = variantContainerOf(analysis.model, index);
    if (container >= 0) {
      if (servedVariantContainers.has(container)) {
        continue; // one variant per f_extras/f_class container, like the runtime plugin
      }
      servedVariantContainers.add(container);
    }
    const parentFrame = nearestCarriedAncestor(analysis.model, carriedFrames, index) ?? chassisFrame;
    const local = compose(invert(emit.worlds[parentFrame]), lift(analysis.hingeOf(index), shiftZ));
    const frameIndex = pushFrame(emit, {
      boneId: emit.nextBoneId++,
      // Renamed on a name collision with an emitted frame — a duplicate of a vanilla name still
      // BINDS its anim channel and double-transforms (DESERT9 door glass, plan 004 round 1).
      name: adoptedFrameName(reserved, analysis.model.frames[index].name.trim()),
      parentIndex: parentFrame,
      position: local.position,
      rotation: local.rotation,
    });
    emitAtomic(emit, analysis.model.geometries, atomic, frameIndex);
    report.adoptedFromMod.push(canonical);
  }
}

function analyzeMod(modDff: Uint8Array, template: CsTemplate): ModAnalysis {
  const model = readClump(modDff);
  const children = childrenByFrame(model);
  const atomicByFrame = new Map(model.atomics.map((atomic) => [atomic.frameIndex, atomic]));
  const relativeToRoot = worldTransforms(model);
  const hingeOf = hingeFactory(model, relativeToRoot);

  const chassisIndex = model.frames.findIndex(
    (frame, index) => canonicalPartName(frame.name) === 'chassis' && atomicByFrame.has(index),
  );
  if (chassisIndex < 0) {
    throw new Error('mod has no chassis mesh');
  }

  const wheelDummies = findWheelDummies(model, template);
  const wheelMeshIndex = findWheelMesh(model, children, atomicByFrame, wheelDummies);
  const wheelAtomic = atomicByFrame.get(wheelMeshIndex)!;
  const analysis = parseDff(toArrayBuffer(modDff));

  return {
    atomicByFrame,
    chassisIndex,
    chassisTransform: hingeOf(chassisIndex),
    hingeOf,
    model,
    relativeToRoot,
    wheelAtomic,
    wheelContainerFrames: wheelContainerFrameSet(model),
    wheelDummies,
    wheelMeshIndex,
    wheelRadius: geometryZHalfExtent(analysis.geometries[wheelAtomic.geometryIndex]),
  };
}

/**
 * The game keys a component by its DUMMY, not the mesh child's name — a mod that misnames the child
 * still works in gameplay (the taxi ships `door_lr_ok` under `door_rr_dummy`). Mirror it: for a missing
 * `<base>_ok`, take the `<base>_dummy`'s `_ok`-suffixed mesh child, whatever it is called.
 */
function dummyChildFallback(analysis: ModAnalysis, canonical: string): number {
  if (!canonical.endsWith('_ok')) {
    return -1;
  }
  const dummyName = `${canonical.slice(0, -3)}_dummy`;
  const dummyIndex = analysis.model.frames.findIndex((frame) => frame.name.trim().toLowerCase() === dummyName);
  if (dummyIndex < 0) {
    return -1;
  }

  return analysis.model.frames.findIndex(
    (frame, index) =>
      frame.parentIndex === dummyIndex &&
      analysis.atomicByFrame.has(index) &&
      frame.name.trim().toLowerCase().endsWith('_ok'),
  );
}

/** Wheel nodes + chassis under the body parent, in template bone order (vanilla interleaves per style). */
function emitBody(
  emit: Emit,
  template: CsTemplate,
  analysis: ModAnalysis,
  shiftZ: number,
  report: CarConvertReport,
): void {
  const order: { boneId: number; corner?: WheelCorner }[] = [
    ...[...template.wheels.entries()].map(([corner, wheel]) => ({ boneId: wheel.nodeBoneId, corner })),
    { boneId: template.chassisBoneId },
  ];
  order.sort((a, b) => a.boneId - b.boneId);
  const mirrored = mirroredLeftWheel(template, analysis);
  for (const entry of order) {
    if (entry.corner) {
      emitWheel(emit, template, analysis, shiftZ, entry.corner, mirrored, report);
    } else {
      emitChassisAndParts(emit, template, analysis, shiftZ, report);
    }
  }
}

function emitChassisAndParts(
  emit: Emit,
  template: CsTemplate,
  analysis: ModAnalysis,
  shiftZ: number,
  report: CarConvertReport,
): void {
  const chassisFrame = emitBone(
    emit,
    {
      boneId: template.chassisBoneId,
      local: template.chassisLocal,
      name: template.chassisName,
      parentFrame: emit.bodyParentIndex,
      targetWorld: lift(analysis.chassisTransform, shiftZ),
    },
    report,
  );
  emitAtomic(emit, analysis.model.geometries, analysis.atomicByFrame.get(analysis.chassisIndex)!, chassisFrame);

  const emittedByCanonical = new Map<string, { frameIndex: number; modIndex: number }>([
    ['chassis', { frameIndex: chassisFrame, modIndex: analysis.chassisIndex }],
  ]);
  for (const [canonical, part] of template.parts) {
    let modIndex = analysis.model.frames.findIndex(
      (frame, index) => canonicalPartName(frame.name) === canonical && analysis.atomicByFrame.has(index),
    );
    if (modIndex < 0) {
      modIndex = dummyChildFallback(analysis, canonical);
    }
    const parent = emittedByCanonical.get(part.parentCanonical);
    if (modIndex < 0 || modIndex === analysis.chassisIndex || !parent) {
      if (modIndex < 0 || !parent) {
        report.missingInMod.push(canonical);
      }
      continue;
    }
    const frameIndex = emitBone(
      emit,
      {
        boneId: part.boneId,
        local: { position: part.position, rotation: part.rotation },
        name: part.frameName,
        parentFrame: parent.frameIndex,
        targetWorld: lift(analysis.hingeOf(modIndex), shiftZ),
      },
      report,
    );
    emitAtomic(emit, analysis.model.geometries, analysis.atomicByFrame.get(modIndex)!, frameIndex);
    emittedByCanonical.set(canonical, { frameIndex, modIndex });
    report.parts.push(canonical);
  }
  adoptOrphanParts(
    emit,
    analysis,
    shiftZ,
    chassisFrame,
    new Map([...emittedByCanonical.values()].map((entry) => [entry.modIndex, entry.frameIndex])),
    report,
  );
}

/** Wheels: the node bone lands on the MOD's corner (shim absorbs track/wheelbase/height deltas), the
 *  mesh keeps the template's local. LEFT corners take the mirrored copy on identity-rotation templates. */
function emitWheel(
  emit: Emit,
  template: CsTemplate,
  analysis: ModAnalysis,
  shiftZ: number,
  corner: WheelCorner,
  mirrored: null | OpaqueChunk,
  report: CarConvertReport,
): void {
  const wheel = template.wheels.get(corner)!;
  const dummyWorld = lift(analysis.relativeToRoot(analysis.wheelDummies.get(corner)!), shiftZ);
  const useMirror = corner.startsWith('l') && mirrored !== null;
  if (wheel.style === 'single') {
    const meshIndex = emitBone(
      emit,
      {
        boneId: wheel.meshBoneId,
        local: { position: wheel.nodePosition, rotation: wheel.meshRotation },
        name: wheel.meshName,
        parentFrame: emit.bodyParentIndex,
        targetWorld: { position: dummyWorld.position, rotation: [...wheel.meshRotation] },
      },
      report,
    );
    emitAtomic(emit, analysis.model.geometries, analysis.wheelAtomic, meshIndex, useMirror ? mirrored : undefined);

    return;
  }
  const nodeIndex = emitBone(
    emit,
    {
      boneId: wheel.nodeBoneId,
      local: { position: wheel.nodePosition, rotation: IDENTITY_ROTATION },
      name: wheel.nodeName,
      parentFrame: emit.bodyParentIndex,
      targetWorld: dummyWorld,
    },
    report,
  );
  const meshIndex = pushFrame(emit, {
    boneId: wheel.meshBoneId,
    name: wheel.meshName,
    parentIndex: nodeIndex,
    position: [...wheel.meshPosition],
    rotation: [...wheel.meshRotation],
  });
  emitAtomic(emit, analysis.model.geometries, analysis.wheelAtomic, meshIndex, useMirror ? mirrored : undefined);
}

function findWheelDummies(model: ClumpModel, template: CsTemplate): Map<WheelCorner, number> {
  const dummies = new Map<WheelCorner, number>();
  model.frames.forEach((frame, index) => {
    const match = WHEEL_DUMMY_RE.exec(frame.name.trim().toLowerCase());
    if (match && match[2] !== 'm') {
      dummies.set(`${match[1]}${match[2]}` as WheelCorner, index);
    }
  });
  for (const corner of template.wheels.keys()) {
    if (!dummies.has(corner)) {
      throw new Error(`mod has no wheel_${corner}_dummy`);
    }
  }

  return dummies;
}

function findWheelMesh(
  model: ClumpModel,
  children: readonly number[][],
  atomicByFrame: ReadonlyMap<number, ClumpAtomic>,
  wheelDummies: ReadonlyMap<WheelCorner, number>,
): number {
  for (const dummyIndex of wheelDummies.values()) {
    const mesh = children[dummyIndex].find((index) => atomicByFrame.has(index));
    if (mesh !== undefined) {
      return mesh;
    }
  }
  const named = model.frames.findIndex(
    (frame, index) => frame.name.trim().toLowerCase() === 'wheel' && atomicByFrame.has(index),
  );
  if (named >= 0) {
    return named;
  }
  const container = wheelContainerMesh(model);
  if (container < 0) {
    throw new Error('mod has no wheel mesh under its wheel dummies');
  }

  return container;
}

/** `shift = (tplNodeZ − tplRadius) − (modDummyZ − modRadius)` — both ground planes meet (plan 002/2a). */
function groundShift(template: CsTemplate, analysis: ModAnalysis): number {
  const corner: WheelCorner = template.wheels.has('rf') ? 'rf' : [...template.wheels.keys()][0];
  const templateGround = template.wheels.get(corner)!.nodeZ - template.wheelRadius;
  const dummy = analysis.relativeToRoot(analysis.wheelDummies.get(corner)!);

  return templateGround - (dummy.position[2] - analysis.wheelRadius);
}

/** A mirrored wheel copy for the LEFT side of identity-rotation templates: their anims replay identity
 *  (no z-180 mirror), so the shared wheel geometry showed its inner barrel outward (gate-7 field). */
function mirroredLeftWheel(template: CsTemplate, analysis: ModAnalysis): null | OpaqueChunk {
  const leftHasFlip = [...template.wheels.entries()].some(
    ([corner, wheel]) => corner.startsWith('l') && wheel.meshRotation[0] < 0,
  );
  if (leftHasFlip) {
    return null; // bobcat-style: the bind rotation mirrors, and the anims replay it
  }

  return mirrorGeometryBodyX(analysis.model.geometries[analysis.wheelAtomic.geometryIndex]);
}

/** One past the template's highest bone id — where shim + adopted bones' fresh ids start. */
function nextFreeBoneId(template: CsTemplate): number {
  let max = template.chassisBoneId;
  if (template.intermediate) {
    max = Math.max(max, template.intermediate.boneId);
  }
  for (const part of template.parts.values()) {
    max = Math.max(max, part.boneId);
  }
  for (const wheel of template.wheels.values()) {
    max = Math.max(max, wheel.meshBoneId, wheel.nodeBoneId);
  }

  return max + 1;
}

/** `f_wheel_*` container frames plus every descendant. */
function wheelContainerFrameSet(model: ClumpModel): Set<number> {
  const containers = new Set<number>();
  model.frames.forEach((frame, index) => {
    if (WHEEL_CONTAINER_RE.test(frame.name.trim().toLowerCase())) {
      containers.add(index);
    }
  });
  if (containers.size === 0) {
    return containers;
  }
  model.frames.forEach((frame, index) => {
    for (let at = frame.parentIndex; at >= 0; at = model.frames[at].parentIndex) {
      if (containers.has(at)) {
        containers.add(index);
        break;
      }
    }
  });

  return containers;
}

/** First atomic (in atomic order, like the engine builder) inside an `f_wheel_*` container subtree. */
function wheelContainerMesh(model: ClumpModel): number {
  const containers = wheelContainerFrameSet(model);
  for (const atomic of model.atomics) {
    if (containers.has(atomic.frameIndex)) {
      return atomic.frameIndex;
    }
  }

  return -1;
}
