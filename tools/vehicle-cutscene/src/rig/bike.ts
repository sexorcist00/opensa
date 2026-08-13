/**
 * The bike branch (plan 002 step 8, csmtbike92): the same emit model as cars — vanilla locals as the
 * anims' bind pose, un-animated shims absorbing donor deltas, whole-shell adoption (see `rig/car.ts`) —
 * with the bike vocabulary. The vanilla bike rig has NO wheel corners: every part (wheel_rear, chainset,
 * pedal_l/r, handlebars, forks_front, wheel_front) is a bone in the chassis subtree, so the conversion
 * is template-part matching + adoption, and there is no wheel duplication/mirroring step.
 *
 * What the real corpus adds (probed on the Smooth Criminal Bicycles 3.0 MTB, 2026-08-13):
 *   - a template part may match a mod DUMMY: the mod's `chassis`/`wheel_rear`/`forks_front` carry no
 *     mesh — the geometry hangs in children (`wheel_pj=0-2c`, seat/frame sub-meshes). The bone is
 *     emitted meshless and the subtree meshes are ADOPTED under it, riding its channel (the wheel spins
 *     with its bone);
 *   - `f_extras:<n>`/`f_class:<n>` containers hold variant SUBTREES, not single meshes — the a/b
 *     handlebar sets carry brake levers and grips as sub-meshes. The first child subtree with a mesh is
 *     adopted WHOLE and the other children are dropped; the car branch's one-mesh rule would strip the
 *     levers off the bars. (The car branch keeps its field-frozen rule — gates 4+7.)
 *   - `f_extras:<n>+` containers are ADDITIVE (both wheel reflectors ship in one) — every child is kept.
 */
import { parseDff } from '@opensa/renderware/parsers/binary/dff';

import { canonicalPartName, type CsBikeTemplate, geometryZHalfExtent, toArrayBuffer } from '../template';
import { type ClumpAtomic, type ClumpModel, readClump, writeClump } from './clump-io';
import {
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
  VARIANT_CONTAINER_RE,
  worldTransforms,
} from './emit';
import { compose, invert, type Transform } from './matrix';

export type BikeConvertReport = ConvertReport;

interface BikeAnalysis {
  atomicByFrame: Map<number, ClumpAtomic>;
  chassisIndex: number;
  /** Frames inside non-chosen variant subtrees — never adopted (see the header's container policy). */
  excludedVariants: ReadonlySet<number>;
  hingeOf: (frameIndex: number) => Transform;
  model: ClumpModel;
  relativeToRoot: (frameIndex: number) => Transform;
  wheelRadius: number;
  wheelRearIndex: number;
}

/** Convert one mod bike DFF into its cutscene counterpart. Throws when the mod has no chassis frame or
 *  no rear-wheel mesh — a bike that cannot stand is an error, not a silent skip. */
export function convertBike(
  modDff: Uint8Array,
  template: CsBikeTemplate,
): { dff: Uint8Array; report: BikeConvertReport } {
  const analysis = analyzeBike(modDff);
  const shiftZ = groundShift(template, analysis);
  const emit = emptyEmit({ nextBoneId: nextFreeBoneId(template), rootName: template.rootName });
  const report: BikeConvertReport = {
    adoptedFromMod: [],
    droppedFromMod: [],
    missingInMod: [],
    parts: [],
    shiftZ,
    shimmed: [],
  };

  emitChassisAndParts(emit, template, analysis, shiftZ, report);
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

/** Every remaining visible mod mesh rides its nearest CARRIED ancestor (the wheel mesh spins with its
 *  wheel bone; brake calipers ride the forks); variant containers contribute per the header's policy. */
function adoptOrphanParts(
  emit: Emit,
  analysis: BikeAnalysis,
  shiftZ: number,
  chassisFrame: number,
  carriedFrames: ReadonlyMap<number, number>,
  report: BikeConvertReport,
): void {
  for (const atomic of analysis.model.atomics) {
    const index = atomic.frameIndex;
    const canonical = canonicalPartName(analysis.model.frames[index].name);
    const skip =
      carriedFrames.has(index) ||
      ORPHAN_SKIP_RE.test(canonical) ||
      analysis.excludedVariants.has(index) ||
      inYearVariantSubtree(analysis.model, index);
    if (skip) {
      continue;
    }
    const parentFrame = nearestCarriedAncestor(analysis.model, carriedFrames, index) ?? chassisFrame;
    const local = compose(invert(emit.worlds[parentFrame]), lift(analysis.hingeOf(index), shiftZ));
    const frameIndex = pushFrame(emit, {
      boneId: emit.nextBoneId++,
      name: analysis.model.frames[index].name.trim(),
      parentIndex: parentFrame,
      position: local.position,
      rotation: local.rotation,
    });
    emitAtomic(emit, analysis.model.geometries, atomic, frameIndex);
    report.adoptedFromMod.push(canonical);
  }
}

function analyzeBike(modDff: Uint8Array): BikeAnalysis {
  const model = readClump(modDff);
  const atomicByFrame = new Map(model.atomics.map((atomic) => [atomic.frameIndex, atomic]));
  const relativeToRoot = worldTransforms(model);
  const hingeOf = hingeFactory(model, relativeToRoot);

  const chassisIndex = matchPart(model, atomicByFrame, 'chassis');
  if (chassisIndex < 0) {
    throw new Error('mod has no chassis frame');
  }
  const wheelRearIndex = matchPart(model, atomicByFrame, 'wheel_rear');
  const wheelMesh = firstAtomicInSubtree(model, wheelRearIndex);
  if (wheelRearIndex < 0 || !wheelMesh) {
    throw new Error('mod has no wheel_rear mesh');
  }
  const parsed = parseDff(toArrayBuffer(modDff));

  return {
    atomicByFrame,
    chassisIndex,
    excludedVariants: excludedVariantFrames(model),
    hingeOf,
    model,
    relativeToRoot,
    wheelRadius: geometryZHalfExtent(parsed.geometries[wheelMesh.geometryIndex]),
    wheelRearIndex,
  };
}

function emitChassisAndParts(
  emit: Emit,
  template: CsBikeTemplate,
  analysis: BikeAnalysis,
  shiftZ: number,
  report: BikeConvertReport,
): void {
  const chassisFrame = emitBone(
    emit,
    {
      boneId: template.chassisBoneId,
      local: template.chassisLocal,
      name: template.chassisName,
      parentFrame: emit.bodyParentIndex,
      targetWorld: lift(analysis.hingeOf(analysis.chassisIndex), shiftZ),
    },
    report,
  );
  const chassisAtomic = analysis.atomicByFrame.get(analysis.chassisIndex);
  if (chassisAtomic) {
    emitAtomic(emit, analysis.model.geometries, chassisAtomic, chassisFrame);
  }

  const emittedByCanonical = new Map<string, { frameIndex: number; modIndex: number }>([
    ['chassis', { frameIndex: chassisFrame, modIndex: analysis.chassisIndex }],
  ]);
  for (const [canonical, part] of template.parts) {
    const modIndex = matchPart(analysis.model, analysis.atomicByFrame, canonical);
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
    const atomic = analysis.atomicByFrame.get(modIndex);
    if (atomic) {
      emitAtomic(emit, analysis.model.geometries, atomic, frameIndex);
    }
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

/**
 * Frames excluded by the variant-container policy: inside an `f_extras`/`f_class` container (name not
 * ending `+`), the first direct child subtree containing a mesh is CHOSEN and every later child subtree
 * is excluded. `+` containers are additive — nothing excluded. Containers with no meshed child (the
 * MTB's `f_class:1` switch groups) exclude nothing.
 */
function excludedVariantFrames(model: ClumpModel): Set<number> {
  const children = childrenByFrame(model);
  const atomicFrames = new Set(model.atomics.map((atomic) => atomic.frameIndex));
  const subtreeHasMesh = (index: number): boolean =>
    atomicFrames.has(index) || children[index].some((child) => subtreeHasMesh(child));
  const excludeSubtree = (index: number, excluded: Set<number>): void => {
    excluded.add(index);
    for (const child of children[index]) {
      excludeSubtree(child, excluded);
    }
  };

  const excluded = new Set<number>();
  model.frames.forEach((frame, index) => {
    const name = frame.name.trim().toLowerCase();
    if (!VARIANT_CONTAINER_RE.test(name) || name.endsWith('+')) {
      return;
    }
    let chosen = false;
    for (const child of children[index]) {
      if (chosen) {
        excludeSubtree(child, excluded);
      } else if (subtreeHasMesh(child)) {
        chosen = true;
      }
    }
  });

  return excluded;
}

/** First atomic (in atomic order) whose frame sits in the given frame's subtree, if any. */
function firstAtomicInSubtree(model: ClumpModel, rootIndex: number): ClumpAtomic | undefined {
  if (rootIndex < 0) {
    return undefined;
  }
  const inSubtree = (index: number): boolean => {
    for (let at = index; at >= 0; at = model.frames[at].parentIndex) {
      if (at === rootIndex) {
        return true;
      }
    }

    return false;
  };

  return model.atomics.find((atomic) => inSubtree(atomic.frameIndex));
}

/** `shift = (tplWheelRearZ − tplRadius) − (modWheelRearZ − modRadius)` — both ground planes meet. */
function groundShift(template: CsBikeTemplate, analysis: BikeAnalysis): number {
  const templateGround = template.groundZ - template.wheelRadius;
  const rear = analysis.relativeToRoot(analysis.wheelRearIndex);

  return templateGround - (rear.position[2] - analysis.wheelRadius);
}

/** The mod frame for a template part: canonical name match, mesh-bearing frames preferred (the corpus
 *  ships both shapes — the stock donor's parts ARE meshes, the MTB mod's are dummies over mesh kids). */
function matchPart(model: ClumpModel, atomicByFrame: ReadonlyMap<number, ClumpAtomic>, canonical: string): number {
  const meshed = model.frames.findIndex(
    (frame, index) => canonicalPartName(frame.name) === canonical && atomicByFrame.has(index),
  );
  if (meshed >= 0) {
    return meshed;
  }

  return model.frames.findIndex((frame) => canonicalPartName(frame.name) === canonical);
}

/** One past the template's highest bone id — where shim + adopted bones' fresh ids start. */
function nextFreeBoneId(template: CsBikeTemplate): number {
  let max = template.chassisBoneId;
  for (const part of template.parts.values()) {
    max = Math.max(max, part.boneId);
  }

  return max + 1;
}
