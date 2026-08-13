import type { ClumpAtomic, ClumpFrame, ClumpModel, HierarchyNode, OpaqueChunk } from './clump-io';

/**
 * Branch-agnostic emit machinery shared by the rig branches (car, bike; boat is plan 002 step 9): the
 * Emit accumulator, vanilla-local bone emission with shim frames, atomic/geometry dedupe, hierarchy
 * recomputation and the adoption vocabulary. The emit model itself — vanilla locals as the anims' bind
 * pose, un-animated `_pv` shims absorbing the donor deltas, whole-shell adoption — is documented at the
 * top of `rig/car.ts`, where it was field-won (plan 002 gates 4 and 7).
 */
import { isIdentityDelta } from './bake';
import { compose, IDENTITY_ROTATION, invert, type Transform } from './matrix';

/** Frame-list matrix-flags words, mirrored from every vanilla cutscene model. */
export const TOP_FRAME_FLAGS = 0x00020003;
export const FRAME_FLAGS = 0x00000003;
/** Mod meshes NEVER adopted: damage twins and LOD copies. Everything else the game renders in gameplay. */
export const ORPHAN_SKIP_RE = /_dam$|_vlo$/;
/** IVF-style VARIANT containers: the runtime plugin shows ONE variant per container. */
export const VARIANT_CONTAINER_RE = /^f_(?:extras|class)/;
/** Year-variant subtrees (`_[1991]:2`, with the mod's own `}` typo tolerated): ALTERNATIVES to base
 *  parts the rig already carries — never adopted at all (the taxi stacked three door sets). */
export const YEAR_VARIANT_RE = /\[\d{4}[\]}]/;
/** Shim frame name suffix — must never collide with an anim channel name (vanilla frame names). */
export const SHIM_SUFFIX = '_pv';

export interface BoneSpec {
  boneId: number;
  /** The VANILLA local — what the anims replay. */
  local: { position: readonly number[]; rotation: readonly number[] };
  name: string;
  parentFrame: number;
  /** Where the bone must LAND (body-parent-relative world) — the donor's placement, ground-lifted. */
  targetWorld: Transform;
}

export interface ConvertReport {
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

export interface Emit {
  atomics: ClumpAtomic[];
  /** Dedupe map for derived geometry copies (the mirrored left wheel). */
  bakedGeometryIndex: Map<OpaqueChunk, number>;
  /** Frame index the parts hang off (the skeleton root, or the intermediate body frame). */
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

/** DFS over the emitted tree; flags = (siblings follow ? 2 : 0) | (leaf ? 1 : 0) — the rule reproduced
 *  verbatim from all five vanilla cutscene rig styles (step-2 probe). */
export function buildHierarchy(frames: readonly ClumpFrame[]): HierarchyNode[] {
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

export function childrenByFrame(model: ClumpModel): number[][] {
  const children: number[][] = model.frames.map(() => []);
  model.frames.forEach((frame, index) => {
    if (frame.parentIndex >= 0) {
      children[frame.parentIndex].push(index);
    }
  });

  return children;
}

export function collectDropped(emit: Emit, model: ClumpModel, report: ConvertReport): void {
  for (const atomic of model.atomics) {
    if (!emit.carriedSources.has(atomic.geometryIndex)) {
      report.droppedFromMod.push(model.frames[atomic.frameIndex].name || `frame ${atomic.frameIndex}`);
    }
  }
}

/** Append an atomic; source geometries dedupe by index, derived copies (mirrored wheel) by identity. */
export function emitAtomic(
  emit: Emit,
  geometries: readonly OpaqueChunk[],
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
      emit.geometries.push(geometries[source.geometryIndex]);
      emit.sourceGeometryIndex.set(source.geometryIndex, geometryIndex);
    } else {
      geometryIndex = existing;
    }
    emit.carriedSources.add(source.geometryIndex);
  }
  emit.atomics.push({ extension: source.extension, flags: source.flags, frameIndex, geometryIndex });
}

/**
 * Emit an anim-targeted bone: the VANILLA local (what the anims replay), with an un-animated SHIM frame
 * absorbing the donor delta when the target placement differs. Returns the bone's frame index.
 */
export function emitBone(emit: Emit, spec: BoneSpec, report: ConvertReport): number {
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

/** The nameless top frame + the skeleton root (+ the intermediate body frame when the template has one). */
export function emptyEmit(shape: {
  intermediate?: { boneId: number; frameName: string; position: [number, number, number]; rotation: number[] };
  nextBoneId: number;
  rootName: string;
}): Emit {
  const emit: Emit = {
    atomics: [],
    bakedGeometryIndex: new Map(),
    bodyParentIndex: 1,
    carriedSources: new Set(),
    frames: [],
    geometries: [],
    nextBoneId: shape.nextBoneId,
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
    name: shape.rootName,
    parentIndex: 0,
    position: [0, 0, 0],
    rotation: [...IDENTITY_ROTATION],
  });
  if (shape.intermediate) {
    emit.bodyParentIndex = pushFrame(emit, {
      boneId: shape.intermediate.boneId,
      name: shape.intermediate.frameName,
      parentIndex: 1,
      position: [...shape.intermediate.position],
      rotation: [...shape.intermediate.rotation],
    });
  }

  return emit;
}

/** The space a frame's GEOMETRY is authored in: the dummy's for a `<part>_ok/_dam` under its own dummy
 *  (the game destroys that junk — `PreprocessHierarchy`/`CollapseFramesCB`), the frame's own full world
 *  otherwise (stock copcarla's junk-space chassis KEEPS its transform; gate-4 rounds 1+3). */
export function hingeFactory(
  model: ClumpModel,
  relativeToRoot: (frameIndex: number) => Transform,
): (frameIndex: number) => Transform {
  return (frameIndex: number): Transform => {
    const frame = model.frames[frameIndex];
    const parentIndex = frame.parentIndex;
    const parentName = parentIndex >= 0 ? model.frames[parentIndex].name.trim().toLowerCase() : '';
    const name = frame.name.trim().toLowerCase();
    const isComponent = /_(?:ok|dam)$/.test(name);
    const base = name.replace(/_(?:ok|dam)$/, '');

    return isComponent && parentName === `${base}_dummy` ? relativeToRoot(parentIndex) : relativeToRoot(frameIndex);
  };
}

/** Whether the frame (or an ancestor) carries a year-variant tag — an alternative part set. */
export function inYearVariantSubtree(model: ClumpModel, frameIndex: number): boolean {
  for (let at = frameIndex; at >= 0; at = model.frames[at].parentIndex) {
    if (YEAR_VARIANT_RE.test(model.frames[at].name)) {
      return true;
    }
  }

  return false;
}

/** The donor transform lifted onto the template's ground plane. */
export function lift(transform: Transform, shiftZ: number): Transform {
  return {
    position: [transform.position[0], transform.position[1], transform.position[2] + shiftZ],
    rotation: transform.rotation,
  };
}

/** The emitted frame of the closest carried (template-matched) ancestor of a mod frame, if any. */
export function nearestCarriedAncestor(
  model: ClumpModel,
  carriedFrames: ReadonlyMap<number, number>,
  frameIndex: number,
): number | undefined {
  for (let at = model.frames[frameIndex].parentIndex; at >= 0; at = model.frames[at].parentIndex) {
    const emitted = carriedFrames.get(at);
    if (emitted !== undefined) {
      return emitted;
    }
  }

  return undefined;
}

export function pushFrame(emit: Emit, frame: Omit<ClumpFrame, 'flags'> & { flags?: number }): number {
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
export function variantContainerOf(model: ClumpModel, frameIndex: number): number {
  for (let at = frameIndex; at >= 0; at = model.frames[at].parentIndex) {
    if (VARIANT_CONTAINER_RE.test(model.frames[at].name.trim().toLowerCase())) {
      return at;
    }
  }

  return -1;
}

/** Memoized frame transforms relative to the mod's root frame (the root's own transform excluded). */
export function worldTransforms(model: ClumpModel): (frameIndex: number) => Transform {
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
