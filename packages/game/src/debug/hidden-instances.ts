import { type InstancedMesh, Matrix4, type Mesh, Vector3 } from 'three';

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

  private readonly hidden: { instanceId: number; matrix: Matrix4 | null; mesh: Mesh }[] = [];

  /** Collapse one instance (idempotent per mesh+id — re-hiding must not capture the collapsed matrix).
   *  Single-placement plain-Mesh world parts (073/08 WebGPU) have no instance slots — they just hide. */
  hide(mesh: Mesh, instanceId: number): number {
    if (!this.hidden.some((entry) => entry.mesh === mesh && entry.instanceId === instanceId)) {
      if ((mesh as InstancedMesh).isInstancedMesh) {
        const instanced = mesh as InstancedMesh;
        const matrix = new Matrix4();
        instanced.getMatrixAt(instanceId, matrix);
        this.hidden.push({ instanceId, matrix, mesh });
        instanced.setMatrixAt(instanceId, matrix.clone().scale(ZERO_SCALE));
        instanced.instanceMatrix.needsUpdate = true;
      } else {
        this.hidden.push({ instanceId, matrix: null, mesh });
        mesh.visible = false;
      }
    }

    return this.hidden.length;
  }

  /** Put every hidden instance's original matrix back and forget them. */
  restoreAll(): void {
    for (const { instanceId, matrix, mesh } of this.hidden) {
      if (matrix) {
        (mesh as InstancedMesh).setMatrixAt(instanceId, matrix);
        (mesh as InstancedMesh).instanceMatrix.needsUpdate = true;
      } else {
        mesh.visible = true;
      }
    }
    this.hidden.length = 0;
  }
}
