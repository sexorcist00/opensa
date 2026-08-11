import { openArchive } from '@opensa/renderware/archive/img-archive';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadMapDefsAt, readBytes } from '../lib/game';
import { indexModAssets, resolveDff } from '../lib/mod-assets';

/**
 * scan-model-defects — rank every PLACED world model by broken-authored-vertex-data criteria
 * (map-optimizer plan 024 phase 1). Scans the SOURCE assets the build consumes (last mod wins,
 * vanilla otherwise — the same resolution `model-repack.ts` uses), so a hit names the mod that
 * shipped the defect. Criteria (extension point — add rows as new defect families appear):
 *
 *   Family A — authored normals facing DARKER than their faces (`lae2_roads17`): faces referencing
 *     a vertex normal whose up-component sits `--dz` (default 0.5) below the face normal's. See
 *     `analyzeNormals` for why the test is asymmetric (up-rotated normals are a legal authoring
 *     trick; only ground-rotated ones read as dirt/wedges).
 *   Family B — authored day-prelit black holes (`sphinx01_lvs`): vertices with day luma < 10 and
 *     whole-black triangles on models whose day median is healthy (≥ 40 — by-design dark models and
 *     `tobj` timed models are excluded; dark-at-night is design, plan 019).
 *
 *   Family C — UV mappings stretched far off square (`road_lawn34`, `sbseabed3_las20`, plan 025): faces
 *     whose UV→world map draws a texel `--aniso` (default 8) times longer than wide, up to a collapsed
 *     axis where a single texel row is smeared across the face. Ranked by the SHARE of the model's own
 *     surface the flagged faces cover, and printed with the map-wide POPULATION, because how many models
 *     carry it is what decides curated list vs general rule. Original-game data — the optimizer moves no
 *     UV (025 phase 0), so a hit here is R*'s, not ours.
 *
 * Run: npx tsx scripts/debug/scan-model-defects.ts [--game original] [--top 10] [--dz 0.5] [--aniso 8]
 *      [--json <out.json>]
 * Output per hit: metrics, source mod, instance count + a position — paste into
 *   `npx tsx scripts/debug/teleport-spot.ts <model>` for a field spot.
 */

interface ModelRow {
  // Family B
  allBlackTris: number;
  /** Summed area of flagged faces — the visibility weight (686 tiny grass cards != 22 road slabs). */
  badNormalArea: number;
  // Family A
  badNormalFaces: number;
  blackVerts: number;
  /** Faces whose UV triangle is degenerate outright (one axis maps to nothing). */
  collapsedUvFaces: number;
  dayP50: number;
  faces: number;
  from: string;
  hasAuthoredNormals: boolean;
  instances: number;
  model: string;
  nightP50: number;
  position: [number, number, number];
  // Family C
  /** Summed world area of the over-stretched faces — the visibility weight, as Family A learned to use. */
  stretchArea: number;
  stretchFaces: number;
  timed: boolean;
  /** Total drawable world area, so the flagged area can be read as a SHARE of the model. */
  totalArea: number;
  txd: string;
  verts: number;
  worstAniso: number;
  worstDz: number;
}

interface Triangleish {
  a: number;
  b: number;
  c: number;
}

/** One model's metrics over all its geometries (counts summed, medians over concatenated verts). */
function analyzeModel(
  bytes: Uint8Array,
  dz: number,
  aniso: number,
): Omit<ModelRow, 'from' | 'instances' | 'model' | 'position' | 'timed' | 'txd'> {
  const clump = parseDff(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  let badNormalFaces = 0;
  let badNormalArea = 0;
  let faces = 0;
  let hasAuthoredNormals = false;
  let worstDz = 0;
  let allBlackTris = 0;
  let blackVerts = 0;
  let verts = 0;
  let stretchFaces = 0;
  let stretchArea = 0;
  let collapsedUvFaces = 0;
  let totalArea = 0;
  let worstAniso = 0;
  const dayLumas: number[] = [];
  const nightLumas: number[] = [];
  for (const geo of clump.geometries) {
    const vertexCount = geo.positions.length / 3;
    verts += vertexCount;
    faces += geo.triangles.length;
    if (geo.uvLayers[0]) {
      const stretch = analyzeUvStretch(geo.positions, geo.uvLayers[0], geo.triangles, aniso);
      stretchFaces += stretch.faces;
      stretchArea += stretch.area;
      collapsedUvFaces += stretch.collapsed;
      totalArea += stretch.totalArea;
      worstAniso = Math.max(worstAniso, stretch.worst);
    }
    if (geo.prelitColors) {
      const prelit = analyzePrelit(geo.prelitColors, vertexCount, geo.triangles);
      dayLumas.push(...prelit.lumas);
      blackVerts += prelit.blackVerts;
      allBlackTris += prelit.allBlackTris;
    }
    if (geo.nightColors) {
      for (let i = 0; i < vertexCount; i += 1) nightLumas.push(luma(geo.nightColors, i));
    }
    if (!geo.normals) continue;
    hasAuthoredNormals = true;
    const normals = analyzeNormals(geo.positions, geo.normals, geo.triangles, dz);
    badNormalFaces += normals.badFaces;
    badNormalArea += normals.badArea;
    worstDz = Math.max(worstDz, normals.worstDz);
  }

  return {
    allBlackTris,
    badNormalArea,
    badNormalFaces,
    blackVerts,
    collapsedUvFaces,
    dayP50: p50(dayLumas),
    faces,
    hasAuthoredNormals,
    nightP50: p50(nightLumas),
    stretchArea,
    stretchFaces,
    totalArea,
    verts,
    worstAniso,
    worstDz,
  };
}

/**
 * Family A per geometry: faces referencing a vertex normal that faces the GROUND markedly more than
 * the face itself does (`nzVertex < nzFace − dz`, components normalized, GTA z = up).
 *
 * Asymmetric on purpose — field round 1 (2026-07-29) falsified the symmetric angle test:
 * `standard01_lawn` tops that ranking (1215 faces >60° off) yet renders FINE, because its grass/bush
 * cards carry deliberate straight-UP normals on vertical faces — a stock vegetation trick (light the
 * card like the lawn under it). A normal rotated toward the sky only ever BRIGHTENS; the defect class
 * that reads as dirt/wedges (`lae2_roads17`) is a normal facing darker than its face. The asymmetry
 * also makes mirror-side copies of two-sided sheets legal without special-casing.
 */
function analyzeNormals(
  p: Float32Array,
  n: Float32Array,
  triangles: readonly Triangleish[],
  dz: number,
): { badArea: number; badFaces: number; worstDz: number } {
  let badFaces = 0;
  let badArea = 0;
  let worstDz = 0;
  for (const t of triangles) {
    const ux = p[t.b * 3] - p[t.a * 3];
    const uy = p[t.b * 3 + 1] - p[t.a * 3 + 1];
    const uz = p[t.b * 3 + 2] - p[t.a * 3 + 2];
    const vx = p[t.c * 3] - p[t.a * 3];
    const vy = p[t.c * 3 + 1] - p[t.a * 3 + 1];
    const vz = p[t.c * 3 + 2] - p[t.a * 3 + 2];
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    const flen = Math.hypot(fx, fy, fz);
    if (flen < 1e-9) continue;
    const nzFace = fz / flen;
    let faceWorst = 0;
    for (const v of [t.a, t.b, t.c]) {
      const nlen = Math.hypot(n[v * 3], n[v * 3 + 1], n[v * 3 + 2]);
      if (nlen < 0.5) continue; // zero/garbage length is family C, not a direction
      faceWorst = Math.max(faceWorst, nzFace - n[v * 3 + 2] / nlen);
    }
    if (faceWorst > dz) {
      badFaces += 1;
      badArea += flen / 2;
    }
    worstDz = Math.max(worstDz, faceWorst);
  }

  return { badArea, badFaces, worstDz };
}

/** Family B per geometry: day-luma list, black vertices, whole-black triangles. */
function analyzePrelit(
  prelit: Uint8Array,
  vertexCount: number,
  triangles: readonly Triangleish[],
): { allBlackTris: number; blackVerts: number; lumas: number[] } {
  const lumas: number[] = [];
  let blackVerts = 0;
  let allBlackTris = 0;
  for (let i = 0; i < vertexCount; i += 1) {
    const l = luma(prelit, i);
    lumas.push(l);
    if (l < 10) blackVerts += 1;
  }
  for (const t of triangles) {
    if ([t.a, t.b, t.c].every((v) => luma(prelit, v) < 10)) allBlackTris += 1;
  }

  return { allBlackTris, blackVerts, lumas };
}

/**
 * Family C per geometry: how ANISOTROPIC is each face's UV→world map. Solve the linear `M` with
 * `M·(t1−t0) = p1−p0` and `M·(t2−t0) = p2−p0`; its singular values are world units per UV unit along the
 * map's principal axes, so `σmax/σmin` is how many times longer than wide a texel is drawn there. A
 * degenerate UV triangle (one axis mapping to nothing) counts as infinite — the texture is constant across
 * the face and a single texel row is smeared over it.
 *
 * Area-weighted for the same reason Family A had to be (plan 024 round 1): a count of faces ranks slivers
 * above the road slabs anyone actually looks at.
 *
 * NOT a defect on its own — a road legitimately carries 2–4× (density along it differs from across it), so
 * the threshold has to come from this scan's own distribution rather than from taste.
 */
function analyzeUvStretch(
  positions: Float32Array,
  uvs: Float32Array,
  triangles: readonly Triangleish[],
  limit: number,
): { area: number; collapsed: number; faces: number; totalArea: number; worst: number } {
  let area = 0;
  let collapsed = 0;
  let flagged = 0;
  let totalArea = 0;
  let worst = 0;
  for (const { a, b, c } of triangles) {
    const e1p = [0, 1, 2].map((k) => positions[b * 3 + k] - positions[a * 3 + k]);
    const e2p = [0, 1, 2].map((k) => positions[c * 3 + k] - positions[a * 3 + k]);
    const faceArea =
      0.5 *
      Math.hypot(
        e1p[1] * e2p[2] - e1p[2] * e2p[1],
        e1p[2] * e2p[0] - e1p[0] * e2p[2],
        e1p[0] * e2p[1] - e1p[1] * e2p[0],
      );
    if (faceArea < 1e-6) continue; // a degenerate POSITION face draws nothing
    totalArea += faceArea;
    const e1t = [uvs[b * 2] - uvs[a * 2], uvs[b * 2 + 1] - uvs[a * 2 + 1]];
    const e2t = [uvs[c * 2] - uvs[a * 2], uvs[c * 2 + 1] - uvs[a * 2 + 1]];
    const det = e1t[0] * e2t[1] - e1t[1] * e2t[0];
    if (Math.abs(det) < 1e-14) {
      collapsed += 1;
      flagged += 1;
      area += faceArea;
      worst = Number.POSITIVE_INFINITY;
      continue;
    }
    const dPdu = [0, 1, 2].map((k) => (e1p[k] * e2t[1] - e2p[k] * e1t[1]) / det);
    const dPdv = [0, 1, 2].map((k) => (e2p[k] * e1t[0] - e1p[k] * e2t[0]) / det);
    const guu = dot3(dPdu, dPdu);
    const gvv = dot3(dPdv, dPdv);
    const guv = dot3(dPdu, dPdv);
    const mean = (guu + gvv) / 2;
    const spread = Math.sqrt(Math.max(0, ((guu - gvv) / 2) ** 2 + guv * guv));
    const big = Math.sqrt(Math.max(0, mean + spread));
    const small = Math.sqrt(Math.max(0, mean - spread));
    const ratio = small > 1e-9 ? big / small : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(ratio)) collapsed += 1;
    if (ratio > worst) worst = ratio;
    if (ratio > limit) {
      flagged += 1;
      area += faceArea;
    }
  }

  return { area, collapsed, faces: flagged, totalArea, worst };
}

function dot3(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function luma(rgba: Uint8Array, i: number): number {
  return 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
}

function main(): void {
  const args = parseArgs();
  const builtDir = join('build', args.game, 'opensa');

  console.log(`· reading built tree ${builtDir} …`);
  const builtArchive = openArchive(readBytes(join(builtDir, 'models', 'gta3.img')));
  const defs = loadMapDefsAt(builtDir, builtArchive);
  const vanilla = openArchive(readBytes(join('game-src', args.game, 'models', 'gta3.img')));
  const mods = indexModAssets(join('mods-src', args.game, 'mods'));

  // Placed models only, HD level (a LOD-only model never fills the screen); timed flagged for B.
  const placed = new Map<
    string,
    { instances: number; position: [number, number, number]; timed: boolean; txd: string }
  >();
  for (const instance of defs.instances) {
    if (instance.isLod) continue;
    const def = defs.catalog.get(instance.id);
    if (!def) continue;
    const key = def.modelName.toLowerCase();
    const entry = placed.get(key);
    if (entry) entry.instances += 1;
    else {
      placed.set(key, {
        instances: 1,
        position: instance.position,
        timed: def.time !== undefined,
        txd: def.txdName.toLowerCase(),
      });
    }
  }
  console.log(`· ${placed.size} placed models — scanning sources …`);

  const rows: ModelRow[] = [];
  let scanned = 0;
  let sourceless = 0;
  for (const [model, info] of placed) {
    const source = resolveDff(model, mods, vanilla);
    if (!source) {
      sourceless += 1;
      continue;
    }
    try {
      rows.push({ from: source.from, model, ...info, ...analyzeModel(source.bytes, args.dz, args.aniso) });
      scanned += 1;
    } catch {
      // unparseable (locked/exotic) — the converter has its own lane for those
    }
  }
  console.log(`· scanned ${scanned} (${sourceless} without a DFF source — generated LODs etc.)\n`);

  const familyA = rows
    .filter((r) => r.hasAuthoredNormals && r.badNormalFaces > 0)
    .sort((a, b) => b.badNormalArea - a.badNormalArea)
    .slice(0, args.top);
  const familyB = rows
    .filter((r) => !r.timed && r.dayP50 >= 40 && r.allBlackTris > 0)
    .sort((a, b) => b.allBlackTris - a.allBlackTris)
    .slice(0, args.top);

  console.log(`═══ Family A — authored normals facing ${args.dz}+ darker than their faces (top ${args.top}) ═══`);
  for (const r of familyA) {
    console.log(
      `  ${r.model.padEnd(22)} badArea ${r.badNormalArea.toFixed(0).padStart(6)}u² ` +
        `badFaces ${String(r.badNormalFaces).padStart(5)}/${String(r.faces).padEnd(6)} ` +
        `worstDz ${r.worstDz.toFixed(2)}  ×${String(r.instances).padEnd(4)} ` +
        `@ ${r.position
          .map((v) => v.toFixed(1))
          .join(', ')
          .padEnd(26)} [${r.from}]`,
    );
  }
  console.log(`\n═══ Family B — day-prelit black holes on healthy models (top ${args.top}) ═══`);
  for (const r of familyB) {
    console.log(
      `  ${r.model.padEnd(22)} blackTris ${String(r.allBlackTris).padStart(5)}/${String(r.faces).padEnd(6)} ` +
        `blackVerts ${String(r.blackVerts).padStart(5)}/${String(r.verts).padEnd(6)} dayP50 ${String(Math.round(r.dayP50)).padStart(3)} ` +
        `nightP50 ${String(Math.round(r.nightP50)).padStart(3)}  ×${String(r.instances).padEnd(4)} ` +
        `@ ${r.position
          .map((v) => v.toFixed(1))
          .join(', ')
          .padEnd(26)} [${r.from}]`,
    );
  }
  const withUv = rows.filter((r) => r.totalArea > 0);
  const familyC = withUv
    .filter((r) => r.stretchFaces > 0)
    .sort((a, b) => b.stretchArea / b.totalArea - a.stretchArea / a.totalArea)
    .slice(0, args.top);

  console.log(`\n═══ Family C — UV stretched over ${args.aniso}× (top ${args.top} by AREA SHARE) ═══`);
  for (const r of familyC) {
    const share = ((r.stretchArea / r.totalArea) * 100).toFixed(1);
    console.log(
      `  ${r.model.padEnd(22)} ${share.padStart(5)}% of ${r.totalArea.toFixed(0).padStart(6)}u² ` +
        `faces ${String(r.stretchFaces).padStart(5)}/${String(r.faces).padEnd(6)} ` +
        `collapsed ${String(r.collapsedUvFaces).padStart(5)}  ×${String(r.instances).padEnd(4)} ` +
        `@ ${r.position
          .map((v) => v.toFixed(1))
          .join(', ')
          .padEnd(26)} [${r.from}]`,
    );
  }
  // The POPULATION is what decides curate-vs-general-rule, so print it next to the ranking (plan 025).
  const tier = (min: number): string => {
    const set = withUv.filter((r) => r.stretchArea / r.totalArea >= min);
    const instances = set.reduce((s, r) => s + r.instances, 0);

    return `${String(set.length).padStart(5)} models / ${String(instances).padStart(6)} placements`;
  };
  console.log(`\n  population over ${args.aniso}×, by the share of the model's own surface it covers:`);
  for (const min of [0.01, 0.02, 0.05, 0.1, 0.2, 0.5]) {
    console.log(`    ≥ ${String(Math.round(min * 100)).padStart(3)}% of surface: ${tier(min)}`);
  }
  console.log(
    `    any at all      : ${tier(Number.EPSILON)}  ·  with a COLLAPSED face: ` +
      `${withUv.filter((r) => r.collapsedUvFaces > 0).length} models`,
  );

  console.log('\nField spot for any row: npx tsx scripts/debug/teleport-spot.ts <model> --game ' + args.game);

  if (args.json) {
    writeFileSync(args.json, JSON.stringify({ familyA, familyB, familyC, scanned }, null, 2));
    console.log(`json → ${args.json}`);
  }
}

function p50(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted.length === 0 ? -1 : sorted[Math.floor(sorted.length / 2)];
}

function parseArgs(): { aniso: number; dz: number; game: string; json: string | undefined; top: number } {
  const argv = process.argv.slice(2);
  let game = 'original';
  let top = 10;
  let dz = 0.5;
  let aniso = 8;
  let json: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--game') game = argv[++i];
    else if (argv[i] === '--top') top = Number(argv[++i]);
    else if (argv[i] === '--dz') dz = Number(argv[++i]);
    else if (argv[i] === '--aniso') aniso = Number(argv[++i]);
    else if (argv[i] === '--json') json = argv[++i];
    else throw new Error(`unknown arg ${argv[i]}`);
  }

  return { aniso, dz, game, json, top };
}

main();
