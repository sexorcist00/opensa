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
 */
import { parseDff } from '@opensa/renderware/parsers/binary/dff';

import { canonicalPartName, type CsTemplate, geometryZHalfExtent, toArrayBuffer, type WheelCorner } from '../template';
import { isIdentityDelta, mirrorGeometryBodyX } from './bake';
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
/** Mod meshes NEVER adopted: damage twins and LOD copies. Everything else the game renders in gameplay. */
const ORPHAN_SKIP_RE = /_dam$|_vlo$/;
/** IVF-style VARIANT containers: the runtime plugin shows ONE mesh per container. */
const VARIANT_CONTAINER_RE = /^f_(?:extras|class)/;
/** Year-variant subtrees (`_[1991]:2`, with the mod's own `}` typo tolerated): ALTERNATIVES to base
 *  parts the rig already carries — never adopted at all (the taxi stacked three door sets). */
const YEAR_VARIANT_RE = /\[\d{4}[\]}]/;
/** Shim frame name suffix — must never collide with an anim channel name (vanilla frame names). */
const SHIM_SUFFIX = '_pv';

export interface CarConvertReport {
  /** Visible mod parts the template has no slot for, carried with fresh bone ids (shell, glass, misc). */
  adoptedFromMod: string[];
  /** Mod meshes with no place in the template (damage twins, LOD copies, surplus variants). */
  droppedFromMod: string[];
  /** Template parts the mod does not ship — their bones drop out of the emitted hierarchy. */
  missingInMod: string[];
  /** Canonical names of the emitted template parts. */
  parts: string[];
  /** The vertical rebase applied to the donor. */
  shiftZ: number;
  /** Bones that needed a shim frame (non-identity donor-vs-vanilla placement delta). */
  shimmed: string[];
}

interface BoneSpec {
  boneId: number;
  /** The VANILLA local — what the anims replay. */
  local: { position: readonly number[]; rotation: readonly number[] };
  name: string;
  parentFrame: number;
  /** Where the bone must LAND (body-parent-relative world) — the donor's placement, ground-lifted. */
  targetWorld: Transform;
}

interface Emit {
  atomics: ClumpAtomic[];
  /** Dedupe map for derived geometry copies (the mirrored left wheel). */
  bakedGeometryIndex: Map<OpaqueChunk, number>;
  /** Frame index the wheels + chassis hang off (the skeleton root, or the intermediate body frame). */
  bodyParentIndex: number;
  /** Source geometry indexes carried in ANY form (original or derived) — `collectDropped`'s ledger. */
  carriedSources: Set<number>;
  frames: ClumpFrame[];
  geometries: OpaqueChunk[];
  /** Fresh bone ids for shims + adopted parts, allocated past the template's. */
  nextBoneId: number;
  /** Dedupe map for source geometries. */
  sourceGeometryIndex: Map<number, number>;
  /** Root-space transform of each emitted frame (parallel to `frames`). */
  worlds: Transform[];
}

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
  const emit = emptyEmit(template);
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
  collectDropped(emit, analysis, report);

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
  const servedVariantContainers = new Set<number>();
  for (const atomic of analysis.model.atomics) {
    const index = atomic.frameIndex;
    const canonical = canonicalPartName(analysis.model.frames[index].name);
    const skip =
      carriedFrames.has(index) ||
      index === analysis.wheelMeshIndex ||
      analysis.wheelContainerFrames.has(index) ||
      ORPHAN_SKIP_RE.test(canonical) ||
      inYearVariantSubtree(analysis, index);
    if (skip) {
      continue;
    }
    const container = variantContainerOf(analysis, index);
    if (container >= 0) {
      if (servedVariantContainers.has(container)) {
        continue; // one variant per f_extras/f_class container, like the runtime plugin
      }
      servedVariantContainers.add(container);
    }
    const parentFrame = nearestCarriedAncestor(analysis, carriedFrames, index) ?? chassisFrame;
    const local = compose(invert(emit.worlds[parentFrame]), lift(analysis.hingeOf(index), shiftZ));
    const frameIndex = pushFrame(emit, {
      boneId: emit.nextBoneId++,
      name: analysis.model.frames[index].name.trim(),
      parentIndex: parentFrame,
      position: local.position,
      rotation: local.rotation,
    });
    emitAtomic(emit, analysis, atomic, frameIndex);
    report.adoptedFromMod.push(canonical);
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
  for (const atomic of analysis.model.atomics) {
    if (!emit.carriedSources.has(atomic.geometryIndex)) {
      report.droppedFromMod.push(analysis.model.frames[atomic.frameIndex].name || `frame ${atomic.frameIndex}`);
    }
  }
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

/** Append an atomic; source geometries dedupe by index, derived copies (mirrored wheel) by identity. */
function emitAtomic(
  emit: Emit,
  analysis: ModAnalysis,
  source: ClumpAtomic,
  frameIndex: number,
  derived?: OpaqueChunk,
): void {
  let geometryIndex: number;
  if (derived) {
    // A derived copy NEVER aliases the source's dedupe slot — doing so handed the mirrored LEFT wheel
    // to the right side too (whichever side emitted first won; gate-7 "wheels splayed" round).
    const shared = emit.bakedGeometryIndex.get(derived);
    if (shared === undefined) {
      geometryIndex = emit.geometries.length;
      emit.geometries.push(derived);
      emit.bakedGeometryIndex.set(derived, geometryIndex);
    } else {
      geometryIndex = shared;
    }
    emit.carriedSources.add(source.geometryIndex);
  } else {
    const existing = emit.sourceGeometryIndex.get(source.geometryIndex);
    if (existing === undefined) {
      geometryIndex = emit.geometries.length;
      emit.geometries.push(analysis.model.geometries[source.geometryIndex]);
      emit.sourceGeometryIndex.set(source.geometryIndex, geometryIndex);
    } else {
      geometryIndex = existing;
    }
    emit.carriedSources.add(source.geometryIndex);
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
  const mirrored = mirroredLeftWheel(template, analysis);
  for (const entry of order) {
    if (entry.corner) {
      emitWheel(emit, template, analysis, shiftZ, entry.corner, mirrored, report);
    } else {
      emitChassisAndParts(emit, template, analysis, shiftZ, report);
    }
  }
}

/**
 * Emit an anim-targeted bone: the VANILLA local (what the anims replay), with an un-animated SHIM frame
 * absorbing the donor delta when the target placement differs. Returns the bone's frame index.
 */
function emitBone(emit: Emit, spec: BoneSpec, report: CarConvertReport): number {
  const local: Transform = { position: [...spec.local.position] as never, rotation: [...spec.local.rotation] };
  const shim = compose(invert(emit.worlds[spec.parentFrame]), compose(spec.targetWorld, invert(local)));
  let parentIndex = spec.parentFrame;
  if (!isIdentityDelta(shim)) {
    parentIndex = pushFrame(emit, {
      boneId: emit.nextBoneId++,
      name: `${spec.name}${SHIM_SUFFIX}`,
      parentIndex: spec.parentFrame,
      position: shim.position,
      rotation: shim.rotation,
    });
    report.shimmed.push(spec.name);
  }

  return pushFrame(emit, {
    boneId: spec.boneId,
    name: spec.name,
    parentIndex,
    position: local.position,
    rotation: local.rotation,
  });
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
  emitAtomic(emit, analysis, analysis.atomicByFrame.get(analysis.chassisIndex)!, chassisFrame);

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
    emitAtomic(emit, analysis, analysis.atomicByFrame.get(modIndex)!, frameIndex);
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
    emitAtomic(emit, analysis, analysis.wheelAtomic, meshIndex, useMirror ? mirrored : undefined);

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
  emitAtomic(emit, analysis, analysis.wheelAtomic, meshIndex, useMirror ? mirrored : undefined);
}

function emptyEmit(template: CsTemplate): Emit {
  const emit: Emit = {
    atomics: [],
    bakedGeometryIndex: new Map(),
    bodyParentIndex: 1,
    carriedSources: new Set(),
    frames: [],
    geometries: [],
    nextBoneId: nextFreeBoneId(template),
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

/** Whether the frame (or an ancestor) carries a year-variant tag — an alternative part set. */
function inYearVariantSubtree(analysis: ModAnalysis, frameIndex: number): boolean {
  for (let at = frameIndex; at >= 0; at = analysis.model.frames[at].parentIndex) {
    if (YEAR_VARIANT_RE.test(analysis.model.frames[at].name)) {
      return true;
    }
  }

  return false;
}

/** The donor transform lifted onto the template's ground plane. */
function lift(transform: Transform, shiftZ: number): Transform {
  return {
    position: [transform.position[0], transform.position[1], transform.position[2] + shiftZ],
    rotation: transform.rotation,
  };
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

/** The emitted frame of the closest carried (template-matched) ancestor of a mod frame, if any. */
function nearestCarriedAncestor(
  analysis: ModAnalysis,
  carriedFrames: ReadonlyMap<number, number>,
  frameIndex: number,
): number | undefined {
  for (let at = analysis.model.frames[frameIndex].parentIndex; at >= 0; at = analysis.model.frames[at].parentIndex) {
    const emitted = carriedFrames.get(at);
    if (emitted !== undefined) {
      return emitted;
    }
  }

  return undefined;
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

/** The closest `f_extras`/`f_class` VARIANT container above (or at) a mod frame, or -1. */
function variantContainerOf(analysis: ModAnalysis, frameIndex: number): number {
  for (let at = frameIndex; at >= 0; at = analysis.model.frames[at].parentIndex) {
    if (VARIANT_CONTAINER_RE.test(analysis.model.frames[at].name.trim().toLowerCase())) {
      return at;
    }
  }

  return -1;
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
