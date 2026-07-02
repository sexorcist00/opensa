import { type InstancedMesh, Matrix4, Vector3 } from 'three';

const ZERO_SCALE = new Vector3(0, 0, 0);

/**
 * Debug-only per-instance hiding for the map inspector (hide the picked object without touching the cell
 * meshes): collapsing an `InstancedMesh` instance's matrix to zero scale renders nothing, and the original
 * matrix is kept so {@link restoreAll} puts everything back — the map-viewer exit calls it, so hides never
 * leak into gameplay. Hiding is transient by design: a re-streamed/rebuilt cell recreates its meshes and the
 * instance simply reappears.
 */
export class HiddenInstances {
  get count(): number {
    return this.hidden.length;
  }

  private readonly hidden: { instanceId: number; matrix: Matrix4; mesh: InstancedMesh }[] = [];

  /** Collapse one instance (idempotent per mesh+id — re-hiding must not capture the collapsed matrix). */
  hide(mesh: InstancedMesh, instanceId: number): number {
    if (!this.hidden.some((entry) => entry.mesh === mesh && entry.instanceId === instanceId)) {
      const matrix = new Matrix4();
      mesh.getMatrixAt(instanceId, matrix);
      this.hidden.push({ instanceId, matrix, mesh });
      mesh.setMatrixAt(instanceId, matrix.clone().scale(ZERO_SCALE));
      mesh.instanceMatrix.needsUpdate = true;
    }

    return this.hidden.length;
  }

  /** Put every hidden instance's original matrix back and forget them. */
  restoreAll(): void {
    for (const { instanceId, matrix, mesh } of this.hidden) {
      mesh.setMatrixAt(instanceId, matrix);
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.hidden.length = 0;
  }
}
