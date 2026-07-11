/**
 * Minimal column-major mat4 + frustum math (plan 074/01) — the handful the M0 renderer needs, zero deps.
 * Conventions match WebGPU clip space: right-handed view, depth 0..1 (`perspectiveZO`).
 */

export type Mat4 = Float32Array; // 16, column-major
export type Vec3 = readonly [number, number, number];

/** Six frustum planes [nx, ny, nz, d] extracted from a viewProjection (Gribb–Hartmann; 0..1 depth). */
export function frustumFromViewProj(out: Float32Array, m: Mat4): Float32Array {
  const rows = [
    [m[0], m[4], m[8], m[12]],
    [m[1], m[5], m[9], m[13]],
    [m[2], m[6], m[10], m[14]],
    [m[3], m[7], m[11], m[15]],
  ];
  const planes = [
    [rows[3][0] + rows[0][0], rows[3][1] + rows[0][1], rows[3][2] + rows[0][2], rows[3][3] + rows[0][3]], // left
    [rows[3][0] - rows[0][0], rows[3][1] - rows[0][1], rows[3][2] - rows[0][2], rows[3][3] - rows[0][3]], // right
    [rows[3][0] + rows[1][0], rows[3][1] + rows[1][1], rows[3][2] + rows[1][2], rows[3][3] + rows[1][3]], // bottom
    [rows[3][0] - rows[1][0], rows[3][1] - rows[1][1], rows[3][2] - rows[1][2], rows[3][3] - rows[1][3]], // top
    [rows[2][0], rows[2][1], rows[2][2], rows[2][3]], // near (z ≥ 0 in ZO clip)
    [rows[3][0] - rows[2][0], rows[3][1] - rows[2][1], rows[3][2] - rows[2][2], rows[3][3] - rows[2][3]], // far
  ];
  for (let plane = 0; plane < 6; plane += 1) {
    const [nx, ny, nz, d] = planes[plane];
    const invLen = 1 / (Math.hypot(nx, ny, nz) || 1);
    out[plane * 4] = nx * invLen;
    out[plane * 4 + 1] = ny * invLen;
    out[plane * 4 + 2] = nz * invLen;
    out[plane * 4 + 3] = d * invLen;
  }

  return out;
}

/** Sphere-vs-frustum: true when (partially) inside. `planes` = 24 floats from {@link frustumFromViewProj}. */
export function frustumIntersectsSphere(
  planes: Float32Array,
  x: number,
  y: number,
  z: number,
  radius: number,
): boolean {
  for (let plane = 0; plane < 6; plane += 1) {
    const distance =
      planes[plane * 4] * x + planes[plane * 4 + 1] * y + planes[plane * 4 + 2] * z + planes[plane * 4 + 3];
    if (distance < -radius) {
      return false;
    }
  }

  return true;
}

export function mat4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;

  return m;
}

/** Right-handed lookAt view matrix. */
export function mat4LookAt(out: Mat4, eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const zx = eye[0] - target[0];
  const zy = eye[1] - target[1];
  const zz = eye[2] - target[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  const z = [zx / len, zy / len, zz / len];
  const xx = up[1] * z[2] - up[2] * z[1];
  const xy = up[2] * z[0] - up[0] * z[2];
  const xz = up[0] * z[1] - up[1] * z[0];
  len = Math.hypot(xx, xy, xz) || 1;
  const x = [xx / len, xy / len, xz / len];
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  out[0] = x[0];
  out[1] = y[0];
  out[2] = z[0];
  out[3] = 0;
  out[4] = x[1];
  out[5] = y[1];
  out[6] = z[1];
  out[7] = 0;
  out[8] = x[2];
  out[9] = y[2];
  out[10] = z[2];
  out[11] = 0;
  out[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  out[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  out[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  out[15] = 1;

  return out;
}

/** out = a × b (column-major). */
export function mat4Multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  for (let column = 0; column < 4; column += 1) {
    const b0 = b[column * 4];
    const b1 = b[column * 4 + 1];
    const b2 = b[column * 4 + 2];
    const b3 = b[column * 4 + 3];
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] = a[row] * b0 + a[4 + row] * b1 + a[8 + row] * b2 + a[12 + row] * b3;
    }
  }

  return out;
}

/** Perspective with WebGPU 0..1 depth. `fovY` radians. */
export function mat4PerspectiveZO(out: Mat4, fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = far / (near - far);
  out[11] = -1;
  out[14] = (far * near) / (near - far);

  return out;
}
