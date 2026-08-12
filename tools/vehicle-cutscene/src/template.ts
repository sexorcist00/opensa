import type { RWClump, RWGeometry } from '@opensa/renderware/parsers/binary/types';

/**
 * The per-slot conversion TEMPLATE, read from the vanilla cutscene model at run time — never generated.
 * Bone ids, the root frame name, part frame names (`door_lf_hi_ok` vs `door_lf_ok`), wheel-node names
 * (`Box01` / `wheel_lf_node` / `axis_lf` / `wheelLFNode`) and the vertical convention are all
 * hand-authored and inconsistent across the 23 vanilla models (001's research record); the cutscene
 * animations target exactly those bone ids, so the vanilla file is the only honest source.
 */
import { parseDff } from '@opensa/renderware/parsers/binary/dff';

export interface CsPartTemplate {
  boneId: number;
  /** The template's exact frame name (keeps the `_hi` spelling where vanilla uses it). */
  frameName: string;
}

export interface CsTemplate {
  chassisBoneId: number;
  /** The template's chassis frame name (`chassis` on every vanilla style — kept for fidelity). */
  chassisName: string;
  /** Canonical part name → template info, in the template's frame order (= vanilla bone-id order). */
  parts: Map<string, CsPartTemplate>;
  /** Skeleton root frame name (`bobcat_dummy` / `taxi` / `zr350` / `remingtn` — per-car, hand-made). */
  rootName: string;
  /** Vanilla wheel radius: the wheel mesh geometry's z half-extent (bobcat: 0.349, byte-equal to gta3). */
  wheelRadius: number;
  wheels: Map<WheelCorner, CsWheelTemplate>;
}

export interface CsWheelTemplate {
  meshBoneId: number;
  meshName: string;
  /** The wheel MESH frame rotation — identity on the right side, 180° about z on the left (measured). */
  meshRotation: number[];
  nodeBoneId: number;
  nodeName: string;
  /** The node's z in cs space — one side of the ground-plane formula (plan 002 step 2a). */
  nodeZ: number;
}

/** Wheel corner key: `r`/`l` side + `f`/`b` end, matching the game rig's `wheel_<corner>_dummy` names. */
export type WheelCorner = 'lb' | 'lf' | 'rb' | 'rf';

/** Canonical part name: vanilla taxi spells its parts `<part>_hi_ok`; everyone else `<part>_ok`. */
export function canonicalPartName(name: string): string {
  return name.trim().toLowerCase().replace('_hi_', '_');
}

/**
 * Extract the car template from a vanilla cutscene DFF. Throws when the model is not a cutscene car rig
 * (no HAnim skeleton root, no chassis child, or anything but four one-mesh wheel nodes).
 */
export function extractCarTemplate(csDff: Uint8Array): CsTemplate {
  const clump = parseDff(toArrayBuffer(csDff));
  const children = childrenByFrame(clump);
  const rootIndex = clump.frames.findIndex((frame) => frame.boneId === 0);
  if (rootIndex < 0) {
    throw new Error('cutscene template has no HAnim skeleton root (bone 0)');
  }

  const rootChildren = children[rootIndex];
  const chassisIndex = rootChildren.find((index) => canonicalPartName(clump.frames[index].name) === 'chassis');
  if (chassisIndex === undefined) {
    throw new Error('cutscene template has no chassis under the skeleton root');
  }

  const wheels = extractWheels(clump, children, rootChildren, chassisIndex);

  return {
    chassisBoneId: requireBoneId(clump, chassisIndex),
    chassisName: clump.frames[chassisIndex].name.trim(),
    parts: extractParts(clump, children[chassisIndex]),
    rootName: clump.frames[rootIndex].name.trim(),
    wheelRadius: wheelRadius(clump, wheels),
    wheels,
  };
}

/** A geometry's z half-extent — the wheel-radius measure both template and mod sides use. */
export function geometryZHalfExtent(geometry: RWGeometry): number {
  let min = Infinity;
  let max = -Infinity;
  for (let at = 2; at < geometry.positions.length; at += 3) {
    min = Math.min(min, geometry.positions[at]);
    max = Math.max(max, geometry.positions[at]);
  }

  return (max - min) / 2;
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function childrenByFrame(clump: RWClump): number[][] {
  const children: number[][] = clump.frames.map(() => []);
  clump.frames.forEach((frame, index) => {
    if (frame.parentIndex >= 0) {
      children[frame.parentIndex].push(index);
    }
  });

  return children;
}

function cornerOf(position: readonly number[]): WheelCorner {
  return `${position[0] >= 0 ? 'r' : 'l'}${position[1] >= 0 ? 'f' : 'b'}`;
}

function extractParts(clump: RWClump, chassisChildren: readonly number[]): Map<string, CsPartTemplate> {
  const parts = new Map<string, CsPartTemplate>();
  for (const index of chassisChildren) {
    const frameName = clump.frames[index].name.trim();
    parts.set(canonicalPartName(frameName), { boneId: requireBoneId(clump, index), frameName });
  }

  return parts;
}

function extractWheels(
  clump: RWClump,
  children: readonly number[][],
  rootChildren: readonly number[],
  chassisIndex: number,
): Map<WheelCorner, CsWheelTemplate> {
  const wheels = new Map<WheelCorner, CsWheelTemplate>();
  for (const nodeIndex of rootChildren) {
    if (nodeIndex === chassisIndex) {
      continue;
    }
    const node = clump.frames[nodeIndex];
    const meshIndex = children[nodeIndex].find((index) => clump.atomics.some((atomic) => atomic.frameIndex === index));
    if (meshIndex === undefined) {
      throw new Error(`cutscene template wheel node '${node.name.trim()}' has no mesh child`);
    }
    const mesh = clump.frames[meshIndex];
    wheels.set(cornerOf(node.position), {
      meshBoneId: requireBoneId(clump, meshIndex),
      meshName: mesh.name.trim(),
      meshRotation: [...mesh.rotation],
      nodeBoneId: requireBoneId(clump, nodeIndex),
      nodeName: node.name.trim(),
      nodeZ: node.position[2],
    });
  }
  if (wheels.size !== 4) {
    throw new Error(`cutscene template has ${wheels.size} wheel corner(s), expected 4`);
  }

  return wheels;
}

function requireBoneId(clump: RWClump, frameIndex: number): number {
  const boneId = clump.frames[frameIndex].boneId;
  if (boneId === undefined) {
    throw new Error(`cutscene template frame '${clump.frames[frameIndex].name.trim()}' has no HAnim bone id`);
  }

  return boneId;
}

function wheelRadius(clump: RWClump, wheels: Map<WheelCorner, CsWheelTemplate>): number {
  const meshNames = new Set([...wheels.values()].map((wheel) => wheel.meshName));
  const meshIndex = clump.frames.findIndex((frame) => meshNames.has(frame.name.trim()));
  const atomic = clump.atomics.find((entry) => entry.frameIndex === meshIndex);
  if (!atomic) {
    throw new Error('cutscene template wheel mesh has no geometry');
  }

  return geometryZHalfExtent(clump.geometries[atomic.geometryIndex]);
}
