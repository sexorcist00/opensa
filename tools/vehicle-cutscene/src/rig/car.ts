/**
 * The car branch: a mod's gameplay DFF → its cutscene counterpart, shaped by the vanilla template.
 *
 * The transform (measured on the vanilla pairs, 001's research record + the step-2 probe):
 *   - flattened tree: `*_dam` twins, `chassis_vlo`, `ug_*`, service dummies and embedded collision are
 *     dropped; each kept part hangs off `chassis` carrying its composed hinge transform;
 *   - a HAnim skeleton over the whole tree, bone ids copied from the template per canonical part name —
 *     dropped parts leave holes in the id sequence (the hand-made pack proves partial hierarchies work);
 *   - four wheel nodes at the mod's `wheel_*_dummy` positions, each with a mesh frame child; the LEFT
 *     mesh frames carry the template's 180°-about-z rotation; all four atomics SHARE one geometry (the
 *     vanilla duplicates it — shared is the smaller emission, the parity gate arbitrates);
 *   - the whole car rises by `shift` so the mod's tyres touch the template's ground plane:
 *     `shift = (tplNodeZ − tplRadius) − (modDummyZ − modRadius)`, radii = wheel-geometry z half-extents
 *     (vanilla donor ⇒ 0.900 on bobcat, reproducing the vanilla rig exactly).
 */
import { parseDff } from '@opensa/renderware/parsers/binary/dff';

import { canonicalPartName, type CsTemplate, geometryZHalfExtent, toArrayBuffer, type WheelCorner } from '../template';
import {
  type ClumpAtomic,
  type ClumpFrame,
  type ClumpModel,
  type HierarchyNode,
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

export interface CarConvertReport {
  /** Mod meshes with no place in the template (chassis_vlo, damage twins, misc_*, …) — not carried. */
  droppedFromMod: string[];
  /** Template parts the mod does not ship — their bones drop out of the emitted hierarchy. */
  missingInMod: string[];
  /** Canonical names of the emitted parts. */
  parts: string[];
  /** The vertical rebase applied to every root child. */
  shiftZ: number;
}

interface Emit {
  atomics: ClumpAtomic[];
  frames: ClumpFrame[];
  geometryIndexes: number[];
}

interface ModAnalysis {
  atomicByFrame: Map<number, ClumpAtomic>;
  chassisIndex: number;
  chassisTransform: Transform;
  model: ClumpModel;
  /** frame transform relative to the mod's root frame. */
  relativeToRoot: (frameIndex: number) => Transform;
  wheelAtomic: ClumpAtomic;
  wheelDummies: Map<WheelCorner, number>;
  wheelRadius: number;
}

/** Convert one mod car DFF into its cutscene counterpart. Throws when the mod has no usable chassis,
 *  wheel dummies or wheel mesh — a car that cannot stand is an error, not a silent skip. */
export function convertCar(modDff: Uint8Array, template: CsTemplate): { dff: Uint8Array; report: CarConvertReport } {
  const analysis = analyzeMod(modDff, template);
  const shiftZ = groundShift(template, analysis);
  const emit = emptyEmit(template);
  const report: CarConvertReport = { droppedFromMod: [], missingInMod: [], parts: [], shiftZ };

  emitRootChildren(emit, template, analysis, shiftZ, report);
  emit.frames[1].hierarchy = buildHierarchy(emit.frames);
  collectDropped(emit, analysis, report);

  const dff = writeClump({
    atomics: emit.atomics,
    frames: emit.frames,
    geometries: emit.geometryIndexes.map((index) => analysis.model.geometries[index]),
    version: analysis.model.version,
  });

  return { dff, report };
}

function analyzeMod(modDff: Uint8Array, template: CsTemplate): ModAnalysis {
  const model = readClump(modDff);
  const children = childrenByFrame(model);
  const atomicByFrame = new Map(model.atomics.map((atomic) => [atomic.frameIndex, atomic]));
  const relativeToRoot = worldTransforms(model);

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
    chassisTransform: relativeToRoot(chassisIndex),
    model,
    relativeToRoot,
    wheelAtomic,
    wheelDummies,
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
  const carried = new Set(emit.geometryIndexes);
  for (const atomic of analysis.model.atomics) {
    if (!carried.has(atomic.geometryIndex)) {
      report.droppedFromMod.push(analysis.model.frames[atomic.frameIndex].name || `frame ${atomic.frameIndex}`);
    }
  }
}

/** Append an atomic, registering its geometry (shared geometries keep their first emitted index). */
function emitAtomic(emit: Emit, source: ClumpAtomic, frameIndex: number): void {
  let geometryIndex = emit.geometryIndexes.indexOf(source.geometryIndex);
  if (geometryIndex < 0) {
    geometryIndex = emit.geometryIndexes.length;
    emit.geometryIndexes.push(source.geometryIndex);
  }
  emit.atomics.push({ extension: source.extension, flags: source.flags, frameIndex, geometryIndex });
}

function emitChassisAndParts(
  emit: Emit,
  template: CsTemplate,
  analysis: ModAnalysis,
  shiftZ: number,
  report: CarConvertReport,
): void {
  const chassis = analysis.chassisTransform;
  const chassisFrame = pushFrame(emit, {
    boneId: template.chassisBoneId,
    name: template.chassisName,
    parentIndex: 1,
    position: [chassis.position[0], chassis.position[1], chassis.position[2] + shiftZ],
    rotation: [...chassis.rotation],
  });
  emitAtomic(emit, analysis.atomicByFrame.get(analysis.chassisIndex)!, chassisFrame);

  const inverseChassis = invert(chassis);
  for (const [canonical, part] of template.parts) {
    const modIndex = analysis.model.frames.findIndex(
      (frame, index) => canonicalPartName(frame.name) === canonical && analysis.atomicByFrame.has(index),
    );
    if (modIndex < 0 || modIndex === analysis.chassisIndex) {
      if (modIndex < 0) {
        report.missingInMod.push(canonical);
      }
      continue;
    }
    const relative = compose(inverseChassis, analysis.relativeToRoot(modIndex));
    const frameIndex = pushFrame(emit, {
      boneId: part.boneId,
      name: part.frameName,
      parentIndex: chassisFrame,
      position: relative.position,
      rotation: relative.rotation,
    });
    emitAtomic(emit, analysis.atomicByFrame.get(modIndex)!, frameIndex);
    report.parts.push(canonical);
  }
}

/** Root children in template bone order — wheel nodes and chassis interleave per the vanilla style. */
function emitRootChildren(
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
      emitWheel(emit, template, analysis, shiftZ, entry.corner);
    } else {
      emitChassisAndParts(emit, template, analysis, shiftZ, report);
    }
  }
}

function emitWheel(emit: Emit, template: CsTemplate, analysis: ModAnalysis, shiftZ: number, corner: WheelCorner): void {
  const wheel = template.wheels.get(corner)!;
  const dummy = analysis.relativeToRoot(analysis.wheelDummies.get(corner)!);
  const nodeIndex = pushFrame(emit, {
    boneId: wheel.nodeBoneId,
    name: wheel.nodeName,
    parentIndex: 1,
    position: [dummy.position[0], dummy.position[1], dummy.position[2] + shiftZ],
    rotation: [...dummy.rotation],
  });
  const meshIndex = pushFrame(emit, {
    boneId: wheel.meshBoneId,
    name: wheel.meshName,
    parentIndex: nodeIndex,
    position: [0, 0, 0],
    rotation: [...wheel.meshRotation],
  });
  emitAtomic(emit, analysis.wheelAtomic, meshIndex);
}

function emptyEmit(template: CsTemplate): Emit {
  return {
    atomics: [],
    frames: [
      {
        flags: TOP_FRAME_FLAGS,
        name: '',
        parentIndex: -1,
        position: [0, 0, 0],
        rotation: [...IDENTITY_ROTATION],
      },
      {
        boneId: 0,
        flags: FRAME_FLAGS,
        name: template.rootName,
        parentIndex: 0,
        position: [0, 0, 0],
        rotation: [...IDENTITY_ROTATION],
      },
    ],
    geometryIndexes: [],
  };
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
  if (named < 0) {
    throw new Error('mod has no wheel mesh under its wheel dummies');
  }

  return named;
}

/** `shift = (tplNodeZ − tplRadius) − (modDummyZ − modRadius)` — both ground planes meet (plan 002/2a). */
function groundShift(template: CsTemplate, analysis: ModAnalysis): number {
  const corner: WheelCorner = template.wheels.has('rf') ? 'rf' : [...template.wheels.keys()][0];
  const templateGround = template.wheels.get(corner)!.nodeZ - template.wheelRadius;
  const dummy = analysis.relativeToRoot(analysis.wheelDummies.get(corner)!);

  return templateGround - (dummy.position[2] - analysis.wheelRadius);
}

function pushFrame(emit: Emit, frame: Omit<ClumpFrame, 'flags'> & { flags?: number }): number {
  emit.frames.push({ flags: FRAME_FLAGS, ...frame });

  return emit.frames.length - 1;
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
