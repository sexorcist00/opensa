/**
 * ONE-SHOT fixture capture — run while `three` is still installed (plan 074/13 phase 1.3):
 *
 *   npx tsx packages/math/src/capture-three-fixtures.ts
 *
 * It records what three ACTUALLY returns for the operations we reimplemented, so `@opensa/math` is
 * verified against the library it replaces instead of against our own understanding of it. After the
 * dependency is dropped this file stops running — the generated `three-fixtures.json` is the artefact
 * that survives, and it is committed on purpose.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Box3 as ThreeBox3,
  MathUtils as ThreeMathUtils,
  Matrix4 as ThreeMatrix4,
  Quaternion as ThreeQuaternion,
  Sphere as ThreeSphere,
  Vector3 as ThreeVector3,
} from 'three';

const round = (value: number): number => Number(value.toFixed(10));
const vec = (v: { x: number; y: number; z: number }): number[] => [v.x, v.y, v.z].map(round);
const quat = (q: { w: number; x: number; y: number; z: number }): number[] => [q.x, q.y, q.z, q.w].map(round);
const mat = (m: { elements: number[] }): number[] => m.elements.map(round);

// Deliberately awkward inputs: non-unit scale, a mirrored axis, and rotations that are not multiples
// of 90° — the cases where a hand-rolled implementation silently disagrees with three.
const AXIS = new ThreeVector3(0.26726124, 0.53452248, 0.80178373);
const ANGLE = 0.9773843811168246;
const POSITION = new ThreeVector3(12.5, -3.25, 7.125);
const SCALE = new ThreeVector3(2, 0.5, -1.5);
// Deliberately NOT parallel to AXIS: a sample collinear with the rotation axis comes back unchanged
// and would make applyQuaternion/applyAxisAngle look correct no matter how they are implemented.
const SAMPLE = new ThreeVector3(1, -2, 0.5);

const rotation = new ThreeQuaternion().setFromAxisAngle(AXIS, ANGLE);
const composed = new ThreeMatrix4().compose(POSITION, rotation, SCALE);

const decomposedPosition = new ThreeVector3();
const decomposedRotation = new ThreeQuaternion();
const decomposedScale = new ThreeVector3();
composed.clone().decompose(decomposedPosition, decomposedRotation, decomposedScale);

const box = new ThreeBox3(new ThreeVector3(-1, -2, -3), new ThreeVector3(4, 5, 6));
const sphere = new ThreeSphere(new ThreeVector3(1, 2, 3), 2.5);

const fixtures = {
  _generator: 'packages/math/src/capture-three-fixtures.ts',
  _source: 'three@0.185.1',
  box3: {
    appliedMatrix4: ((): Record<string, unknown> => {
      const applied = box.clone().applyMatrix4(composed);

      return { max: vec(applied.max), min: vec(applied.min) };
    })(),
    center: vec(box.getCenter(new ThreeVector3())),
    distanceToPoint: round(box.distanceToPoint(new ThreeVector3(10, 10, 10))),
    intersectsSphere: box.intersectsSphere(sphere),
    size: vec(box.getSize(new ThreeVector3())),
  },
  mathUtils: {
    clamp: round(ThreeMathUtils.clamp(5.5, -1, 3)),
    degToRad: round(ThreeMathUtils.degToRad(137.5)),
    euclideanModulo: round(ThreeMathUtils.euclideanModulo(-7.25, 3)),
    lerp: round(ThreeMathUtils.lerp(-4, 10, 0.3)),
    radToDeg: round(ThreeMathUtils.radToDeg(2.4)),
  },
  matrix4: {
    composed: mat(composed),
    decomposed: {
      position: vec(decomposedPosition),
      quaternion: quat(decomposedRotation),
      scale: vec(decomposedScale),
    },
    determinant: round(composed.determinant()),
    extractRotation: mat(new ThreeMatrix4().extractRotation(composed)),
    inverted: mat(composed.clone().invert()),
    lookAt: mat(
      new ThreeMatrix4().lookAt(new ThreeVector3(3, 4, 5), new ThreeVector3(0, 0, 0), new ThreeVector3(0, 1, 0)),
    ),
    multiplied: mat(composed.clone().multiply(new ThreeMatrix4().makeTranslation(1, 2, 3))),
    transposed: mat(composed.clone().transpose()),
  },
  quaternion: {
    angleTo: round(rotation.angleTo(new ThreeQuaternion())),
    fromAxisAngle: quat(rotation),
    fromRotationMatrix: quat(new ThreeQuaternion().setFromRotationMatrix(composed)),
    fromUnitVectors: quat(
      new ThreeQuaternion().setFromUnitVectors(new ThreeVector3(0, 1, 0), new ThreeVector3(1, 0, 0).normalize()),
    ),
    fromUnitVectorsOpposite: quat(
      new ThreeQuaternion().setFromUnitVectors(new ThreeVector3(0, 1, 0), new ThreeVector3(0, -1, 0)),
    ),
    multiplied: quat(rotation.clone().multiply(new ThreeQuaternion().setFromAxisAngle(new ThreeVector3(1, 0, 0), 0.5))),
    slerpHalf: quat(rotation.clone().slerp(new ThreeQuaternion(), 0.5)),
  },
  sphere: {
    appliedMatrix4: ((): Record<string, unknown> => {
      const applied = sphere.clone().applyMatrix4(composed);

      return { center: vec(applied.center), radius: round(applied.radius) };
    })(),
    distanceToPoint: round(sphere.distanceToPoint(new ThreeVector3(10, 0, 0))),
  },
  vector3: {
    angleTo: round(new ThreeVector3(1, 2, 3).angleTo(new ThreeVector3(-4, 5, 6))),
    appliedAxisAngle: vec(SAMPLE.clone().applyAxisAngle(AXIS, ANGLE)),
    appliedMatrix4: vec(SAMPLE.clone().applyMatrix4(composed)),
    appliedQuaternion: vec(SAMPLE.clone().applyQuaternion(rotation)),
    cross: vec(new ThreeVector3(1, 2, 3).cross(new ThreeVector3(-4, 5, 6))),
    fromMatrixScale: vec(new ThreeVector3().setFromMatrixScale(composed)),
    normalized: vec(new ThreeVector3(1, 2, 3).normalize()),
    transformDirection: vec(new ThreeVector3(1, 2, 3).transformDirection(composed)),
  },
};

const target = join(import.meta.dirname, 'three-fixtures.json');
writeFileSync(target, `${JSON.stringify(fixtures, null, 2)}\n`);
// eslint-disable-next-line no-console -- one-shot CLI: the written path is the whole output
console.log(`wrote ${target}`);
