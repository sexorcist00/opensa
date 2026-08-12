/**
 * The car branch: a mod's gameplay DFF → its cutscene counterpart, shaped by the vanilla template.
 *
 * THE EMIT MODEL (rebuilt after gate 4's two field rounds, 2026-08-12): cutscene animations bind by frame
 * NAME (`CAnimBlendAssociation`, gta-reversed `CCutsceneMgr`) and their channels drive every animated
 * bone to the VANILLA model's locals — the converted rig's own frame transforms only survive on frames
 * the anim leaves alone. So every template-matched frame is emitted with the VANILLA local (the anims'
 * bind pose), and the donor's differing hinge placement is BAKED INTO THE PART'S VERTICES
 * (`rig/bake.ts`): `delta = inv(W_vanilla) ∘ shift_z ∘ W_donor`. Stock donors on body-reusing templates
 * yield identity deltas and byte-identical geometry.
 *
 * Everything else from the earlier rounds still holds:
 *   - part set = template ∩ mod by canonical name, holes in the id sequence are fine; visible mod parts
 *     with no template slot are ADOPTED with fresh bone ids (donor glass — '92 bodies bake theirs);
 *   - a mesh frame under its OWN `<base>_dummy` carries junk the game destroys — the hinge is the dummy;
 *   - wheels sit at the template's corners (spin channels own them; baking would orbit), the mod's wheel
 *     geometry rides all four atomics SHARED; left meshes carry the template's 180°-about-z;
 *   - `shift = (tplNodeZ − tplRadius) − (modDummyZ − modRadius)` aligns the donor's ground plane before
 *     baking; a mod wheel-radius mismatch sinks/floats the tyre by the radius delta (known limit).
 */
import { parseDff } from '@opensa/renderware/parsers/binary/dff';

import { canonicalPartName, type CsTemplate, geometryZHalfExtent, toArrayBuffer, type WheelCorner } from '../template';
import { bakeGeometryBody, isIdentityDelta } from './bake';
import {
  type ClumpAtomic,
  type ClumpFrame,
  type ClumpModel,
  type HierarchyNode,
  type OpaqueChunk,
  readClump,
  writeClump,
} from './clump-io';
import { compose, IDENTITY_ROTATION, invert, type Transform } from './matrix';

/** Frame-list matrix-flags words, mirrored from every vanilla cutscene model. */
const TOP_FRAME_FLAGS = 0x00020003;
const FRAME_FLAGS = 0x00000003;
/** The game rig's wheel dummies (mirrors `build-vehicle-model.ts`'s WHEEL_DUMMY_RE; `m` = 3-axle middles,
 *  which no cutscene template has — they land in `droppedFromMod`). */
const WHEEL_DUMMY_RE = /^wheel_([lr])([fmb])_dummy$/;
/** `f_wheel_<mask>` container frames — the IVF-style wheel sub-model four of the real mods ship instead
 *  of a mesh under the dummies (mirrors the engine builder's WHEEL_CONTAINER_RE + first-atomic pick). */
const WHEEL_CONTAINER_RE = /^f_wheel/;
/** Mod parts worth ADOPTING when the template has no slot for them: visible movable/extra meshes. */
const ORPHAN_PART_RE = /_ok$|^extra\d+$|^misc_[a-h]$/;

export interface CarConvertReport {
  /** Visible mod parts the template has no slot for, carried with fresh bone ids (donor glass, misc). */
  adoptedFromMod: string[];
  /** Parts whose geometry was vertex-baked (non-identity donor-vs-vanilla hinge delta). */
  baked: string[];
  /** Mod meshes with no place in the template (chassis_vlo, damage twins, …) — not carried. */
  droppedFromMod: string[];
  /** Template parts the mod does not ship — their bones drop out of the emitted hierarchy. */
  missingInMod: string[];
  /** Canonical names of the emitted template parts. */
  parts: string[];
  /** The vertical rebase applied to the donor before baking. */
  shiftZ: number;
}

interface Emit {
  atomics: ClumpAtomic[];
  /** Frame index the wheels + chassis hang off (the skeleton root, or the intermediate body frame). */
  bodyParentIndex: number;
  frames: ClumpFrame[];
  geometries: OpaqueChunk[];
  /** Dedupe map for UNBAKED source geometries (baked copies are always their own entry). */
  sourceGeometryIndex: Map<number, number>;
  /** Root-space transform of each emitted frame (parallel to `frames`). */
  worlds: Transform[];
}

interface ModAnalysis {
  atomicByFrame: Map<number, ClumpAtomic>;
  chassisIndex: number;
  chassisTransform: Transform;
  /** The part's HINGE transform: the parent dummy's when that parent is the part's own `<base>_dummy`
   *  (the mesh frame's junk transform is destroyed, like the game does), the frame's own otherwise. */
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
  const emit = emptyEmit(template);
  const report: CarConvertReport = {
    adoptedFromMod: [],
    baked: [],
    droppedFromMod: [],
    missingInMod: [],
    parts: [],
    shiftZ,
  };

  emitBody(emit, template, analysis, shiftZ, report);
  emit.frames[1].hierarchy = buildHierarchy(emit.frames);
  collectDropped(emit, analysis, report);

  const dff = writeClump({
    atomics: emit.atomics,
    frames: emit.frames,
    geometries: emit.geometries,
    version: analysis.model.version,
  });

  return { dff, report };
}

/** Carry visible mod parts the template has no slot for as chassis children with fresh bone ids —
 *  un-animated by cutscene anims (no name match), so their frame locals are safe to use. */
function adoptOrphanParts(
  emit: Emit,
  template: CsTemplate,
  analysis: ModAnalysis,
  shiftZ: number,
  chassisFrame: number,
  carriedModFrames: ReadonlySet<number>,
  report: CarConvertReport,
): void {
  const intoChassis = invert(emit.worlds[chassisFrame]);
  let nextBoneId = nextFreeBoneId(template);
  for (const atomic of analysis.model.atomics) {
    const index = atomic.frameIndex;
    const canonical = canonicalPartName(analysis.model.frames[index].name);
    const skip =
      carriedModFrames.has(index) ||
      index === analysis.wheelMeshIndex ||
      analysis.wheelContainerFrames.has(index) ||
      !ORPHAN_PART_RE.test(canonical) ||
      canonical.endsWith('_dam') ||
      template.parts.has(canonical);
    if (skip) {
      continue;
    }
    const local = compose(intoChassis, lift(analysis.hingeOf(index), shiftZ));
    const frameIndex = pushFrame(emit, {
      boneId: nextBoneId,
      name: analysis.model.frames[index].name.trim(),
      parentIndex: chassisFrame,
      position: local.position,
      rotation: local.rotation,
    });
    emitAtomic(emit, analysis, atomic, frameIndex);
    report.adoptedFromMod.push(canonical);
    nextBoneId += 1;
  }
}

function analyzeMod(modDff: Uint8Array, template: CsTemplate): ModAnalysis {
  const model = readClump(modDff);
  const children = childrenByFrame(model);
  const atomicByFrame = new Map(model.atomics.map((atomic) => [atomic.frameIndex, atomic]));
  const relativeToRoot = worldTransforms(model);
  const hingeOf = (frameIndex: number): Transform => {
    const frame = model.frames[frameIndex];
    const parentIndex = frame.parentIndex;
    const parentName = parentIndex >= 0 ? model.frames[parentIndex].name.trim().toLowerCase() : '';
    const name = frame.name.trim().toLowerCase();
    const isComponent = /_(?:ok|dam)$/.test(name);
    const base = name.replace(/_(?:ok|dam)$/, '');

    // The game's collapse destroys ONLY a `<part>_ok/_dam` frame under its own dummy. Every other mesh
    // frame KEEPS its transform in gameplay — stock copcarla's chassis carries [0,1.637,-0.35] and its
    // geometry is authored in that space (gate-4 round 3: discarding it shifted the whole body).
    return isComponent && parentName === `${base}_dummy` ? relativeToRoot(parentIndex) : relativeToRoot(frameIndex);
  };

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

/** DFS over the emitted tree; flags = (siblings follow ? 2 : 0) | (leaf ? 1 : 0) — the rule reproduced
 *  verbatim from all five vanilla cutscene rig styles (step-2 probe). */
function buildHierarchy(frames: readonly ClumpFrame[]): HierarchyNode[] {
  const children: number[][] = frames.map(() => []);
  frames.forEach((frame, index) => {
    if (frame.parentIndex >= 0 && frames[frame.parentIndex].boneId !== undefined) {
      children[frame.parentIndex].push(index);
    }
  });
  const nodes: HierarchyNode[] = [];
  const visit = (index: number, siblingsFollow: boolean): void => {
    const kids = children[index];
    nodes.push({
      flags: (siblingsFollow ? 2 : 0) | (kids.length === 0 ? 1 : 0),
      id: frames[index].boneId!,
      index: nodes.length,
    });
    kids.forEach((kid, at) => visit(kid, at < kids.length - 1));
  };
  const skeletonRoot = frames.findIndex((frame) => frame.boneId === 0);
  visit(skeletonRoot, false);

  return nodes;
}

function childrenByFrame(model: ClumpModel): number[][] {
  const children: number[][] = model.frames.map(() => []);
  model.frames.forEach((frame, index) => {
    if (frame.parentIndex >= 0) {
      children[frame.parentIndex].push(index);
    }
  });

  return children;
}

function collectDropped(emit: Emit, analysis: ModAnalysis, report: CarConvertReport): void {
  const carried = new Set(emit.sourceGeometryIndex.keys());
  for (const atomic of analysis.model.atomics) {
    if (!carried.has(atomic.geometryIndex)) {
      report.droppedFromMod.push(analysis.model.frames[atomic.frameIndex].name || `frame ${atomic.frameIndex}`);
    }
  }
}

/** Append an atomic. Unbaked geometries dedupe by source index (the shared wheel); a baked copy is
 *  always its own entry. Either way the SOURCE index is registered so `collectDropped` sees it carried. */
function emitAtomic(
  emit: Emit,
  analysis: ModAnalysis,
  source: ClumpAtomic,
  frameIndex: number,
  baked?: OpaqueChunk,
): void {
  let geometryIndex: number;
  if (baked) {
    geometryIndex = emit.geometries.length;
    emit.geometries.push(baked);
    if (!emit.sourceGeometryIndex.has(source.geometryIndex)) {
      emit.sourceGeometryIndex.set(source.geometryIndex, geometryIndex);
    }
  } else {
    const existing = emit.sourceGeometryIndex.get(source.geometryIndex);
    if (existing === undefined) {
      geometryIndex = emit.geometries.length;
      emit.geometries.push(analysis.model.geometries[source.geometryIndex]);
      emit.sourceGeometryIndex.set(source.geometryIndex, geometryIndex);
    } else {
      geometryIndex = existing;
    }
  }
  emit.atomics.push({ extension: source.extension, flags: source.flags, frameIndex, geometryIndex });
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
  for (const entry of order) {
    if (entry.corner) {
      emitWheel(emit, template, analysis, entry.corner);
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
  const chassisFrame = pushFrame(emit, {
    boneId: template.chassisBoneId,
    name: template.chassisName,
    parentIndex: emit.bodyParentIndex,
    position: [...template.chassisLocal.position],
    rotation: [...template.chassisLocal.rotation],
  });
  emitPart(emit, analysis, shiftZ, 'chassis', analysis.chassisIndex, chassisFrame, report);

  const emittedByCanonical = new Map<string, { frameIndex: number; modIndex: number }>([
    ['chassis', { frameIndex: chassisFrame, modIndex: analysis.chassisIndex }],
  ]);
  for (const [canonical, part] of template.parts) {
    const modIndex = analysis.model.frames.findIndex(
      (frame, index) => canonicalPartName(frame.name) === canonical && analysis.atomicByFrame.has(index),
    );
    const parent = emittedByCanonical.get(part.parentCanonical);
    if (modIndex < 0 || modIndex === analysis.chassisIndex || !parent) {
      if (modIndex < 0 || !parent) {
        report.missingInMod.push(canonical);
      }
      continue;
    }
    const frameIndex = pushFrame(emit, {
      boneId: part.boneId,
      name: part.frameName,
      parentIndex: parent.frameIndex,
      position: [...part.position],
      rotation: [...part.rotation],
    });
    emitPart(emit, analysis, shiftZ, canonical, modIndex, frameIndex, report);
    emittedByCanonical.set(canonical, { frameIndex, modIndex });
    report.parts.push(canonical);
  }
  adoptOrphanParts(
    emit,
    template,
    analysis,
    shiftZ,
    chassisFrame,
    new Set([...emittedByCanonical.values()].map((entry) => entry.modIndex)),
    report,
  );
}

/** Emit one part's atomic, vertex-baking the donor-vs-vanilla hinge delta when it is not identity. */
function emitPart(
  emit: Emit,
  analysis: ModAnalysis,
  shiftZ: number,
  canonical: string,
  modIndex: number,
  frameIndex: number,
  report: CarConvertReport,
): void {
  const atomic = analysis.atomicByFrame.get(modIndex)!;
  const delta = compose(invert(emit.worlds[frameIndex]), lift(analysis.hingeOf(modIndex), shiftZ));
  if (isIdentityDelta(delta)) {
    emitAtomic(emit, analysis, atomic, frameIndex);

    return;
  }
  emitAtomic(
    emit,
    analysis,
    atomic,
    frameIndex,
    bakeGeometryBody(analysis.model.geometries[atomic.geometryIndex], delta),
  );
  report.baked.push(canonical);
}

function emitWheel(emit: Emit, template: CsTemplate, analysis: ModAnalysis, corner: WheelCorner): void {
  const wheel = template.wheels.get(corner)!;
  if (wheel.style === 'single') {
    const meshIndex = pushFrame(emit, {
      boneId: wheel.meshBoneId,
      name: wheel.meshName,
      parentIndex: emit.bodyParentIndex,
      position: [...wheel.nodePosition],
      rotation: [...wheel.meshRotation],
    });
    emitAtomic(emit, analysis, analysis.wheelAtomic, meshIndex);

    return;
  }
  const nodeIndex = pushFrame(emit, {
    boneId: wheel.nodeBoneId,
    name: wheel.nodeName,
    parentIndex: emit.bodyParentIndex,
    position: [...wheel.nodePosition],
    rotation: [...IDENTITY_ROTATION],
  });
  const meshIndex = pushFrame(emit, {
    boneId: wheel.meshBoneId,
    name: wheel.meshName,
    parentIndex: nodeIndex,
    position: [...wheel.meshPosition],
    rotation: [...wheel.meshRotation],
  });
  emitAtomic(emit, analysis, analysis.wheelAtomic, meshIndex);
}

function emptyEmit(template: CsTemplate): Emit {
  const emit: Emit = {
    atomics: [],
    bodyParentIndex: 1,
    frames: [],
    geometries: [],
    sourceGeometryIndex: new Map(),
    worlds: [],
  };
  pushFrame(emit, {
    flags: TOP_FRAME_FLAGS,
    name: '',
    parentIndex: -1,
    position: [0, 0, 0],
    rotation: [...IDENTITY_ROTATION],
  });
  pushFrame(emit, {
    boneId: 0,
    name: template.rootName,
    parentIndex: 0,
    position: [0, 0, 0],
    rotation: [...IDENTITY_ROTATION],
  });
  if (template.intermediate) {
    emit.bodyParentIndex = pushFrame(emit, {
      boneId: template.intermediate.boneId,
      name: template.intermediate.frameName,
      parentIndex: 1,
      position: [...template.intermediate.position],
      rotation: [...template.intermediate.rotation],
    });
  }

  return emit;
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

/** The donor transform lifted onto the template's ground plane. */
function lift(transform: Transform, shiftZ: number): Transform {
  return {
    position: [transform.position[0], transform.position[1], transform.position[2] + shiftZ],
    rotation: transform.rotation,
  };
}

/** One past the template's highest bone id — where adopted parts' fresh ids start. */
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

function pushFrame(emit: Emit, frame: Omit<ClumpFrame, 'flags'> & { flags?: number }): number {
  const full: ClumpFrame = { flags: FRAME_FLAGS, ...frame };
  emit.frames.push(full);
  const parentWorld =
    full.parentIndex >= 0
      ? emit.worlds[full.parentIndex]
      : { position: [0, 0, 0] as [number, number, number], rotation: [...IDENTITY_ROTATION] };
  emit.worlds.push(compose(parentWorld, { position: full.position, rotation: full.rotation }));

  return emit.frames.length - 1;
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

/** Memoized frame transforms relative to the mod's root frame (the root's own transform excluded). */
function worldTransforms(model: ClumpModel): (frameIndex: number) => Transform {
  const rootIndex = model.frames.findIndex((frame) => frame.parentIndex < 0);
  const memo = new Map<number, Transform>();
  const resolve = (index: number): Transform => {
    if (index === rootIndex || index < 0) {
      return { position: [0, 0, 0], rotation: [...IDENTITY_ROTATION] };
    }
    let transform = memo.get(index);
    if (!transform) {
      const frame = model.frames[index];
      transform = compose(resolve(frame.parentIndex), { position: frame.position, rotation: frame.rotation });
      memo.set(index, transform);
    }

    return transform;
  };

  return resolve;
}
