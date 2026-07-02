import { BoxGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { HiddenInstances } from './hidden-instances';

function meshWithInstance(position: Vector3): InstancedMesh {
  const mesh = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 2);
  mesh.setMatrixAt(0, new Matrix4().setPosition(position));
  mesh.setMatrixAt(1, new Matrix4().setPosition(new Vector3(9, 9, 9)));

  return mesh;
}

const scaleOf = (mesh: InstancedMesh, id: number): number => {
  const matrix = new Matrix4();
  mesh.getMatrixAt(id, matrix);

  return new Vector3().setFromMatrixColumn(matrix, 0).length();
};

describe('HiddenInstances', () => {
  describe('negative cases', () => {
    it('re-hiding the same instance does not capture the collapsed matrix', () => {
      const hidden = new HiddenInstances();
      const mesh = meshWithInstance(new Vector3(1, 2, 3));

      expect(hidden.hide(mesh, 0)).toBe(1);
      expect(hidden.hide(mesh, 0)).toBe(1); // idempotent — still one entry
      hidden.restoreAll();

      expect(scaleOf(mesh, 0)).toBeCloseTo(1); // the ORIGINAL matrix came back, not the zero-scale one
    });
  });

  describe('positive cases', () => {
    it('collapses the instance to zero scale and restores the original matrix', () => {
      const hidden = new HiddenInstances();
      const mesh = meshWithInstance(new Vector3(1, 2, 3));

      hidden.hide(mesh, 0);
      expect(scaleOf(mesh, 0)).toBe(0); // invisible
      expect(scaleOf(mesh, 1)).toBeCloseTo(1); // neighbours untouched

      hidden.restoreAll();
      expect(scaleOf(mesh, 0)).toBeCloseTo(1);
      expect(hidden.count).toBe(0);
    });

    it('tracks multiple hides across meshes and restores them all', () => {
      const hidden = new HiddenInstances();
      const a = meshWithInstance(new Vector3(1, 0, 0));
      const b = meshWithInstance(new Vector3(0, 1, 0));

      expect(hidden.hide(a, 0)).toBe(1);
      expect(hidden.hide(b, 1)).toBe(2);
      hidden.restoreAll();

      expect(scaleOf(a, 0)).toBeCloseTo(1);
      expect(scaleOf(b, 1)).toBeCloseTo(1);
    });
  });
});
