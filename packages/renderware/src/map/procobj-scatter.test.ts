import { Matrix4 } from '@opensa/math';
import { describe, expect, it } from 'vitest';

import type { RegionColliders } from '../collision';
import type { ColModel } from '../parsers/binary/col-types';
import type { ProcObjRule } from '../parsers/text';

import { procObjCategory } from './procobj-categories';
import { groupRulesBySurface, PROC_OBJ_MAX_DENSITY, procObjLotteryCap, scatterProcObjects } from './procobj-scatter';

function rule(partial: Partial<ProcObjRule> = {}): ProcObjRule {
  return {
    align: true,
    maxRotation: 360,
    maxScale: 1.5,
    maxScaleZ: 1.2,
    minDistance: 60,
    minRotation: 0,
    minScale: 0.5,
    minScaleZ: 0.4,
    model: 'sand_combush02',
    spacing: 10,
    surface: 'p_sand',
    useGrid: false,
    zOffsetMax: -0.3,
    zOffsetMin: -0.3,
    ...partial,
  };
}

/** Right triangle (0,0)-(100,0)-(0,40) at z=0 — area exactly 2000 m², i.e. 20 objects at spacing 10. */
function triangleCollider(material: number, transform = new Matrix4()): RegionColliders {
  const col: ColModel = {
    bounds: { center: [0, 0, 0], max: [100, 40, 0], min: [0, 0, 0], radius: 110 },
    boxes: [],
    faces: [{ a: 0, b: 1, c: 2, light: 0, material }],
    modelId: 0,
    name: 'ground',
    spheres: [],
    version: 1,
    vertices: new Float32Array([0, 0, 0, 100, 0, 0, 0, 40, 0]),
  };

  return { col, name: 'ground', transforms: [transform] };
}

// surfinfo table: index = COL material id.
const SURFACES = ['default', 'p_sand', 'p_underwaterbarren'];

describe('scatterProcObjects', () => {
  describe('negative cases', () => {
    it('skips faces whose material is outside the surface table', () => {
      const batches = scatterProcObjects([triangleCollider(99)], groupRulesBySurface([rule()]), SURFACES, 0, 0);
      expect(batches).toEqual([]);
    });

    it('skips faces whose surface has no rules', () => {
      const batches = scatterProcObjects([triangleCollider(0)], groupRulesBySurface([rule()]), SURFACES, 0, 0);
      expect(batches).toEqual([]);
    });

    it('skips degenerate (zero-area) faces', () => {
      const collider = triangleCollider(1);
      collider.col.vertices = new Float32Array(9); // all three vertices at the origin
      const batches = scatterProcObjects([collider], groupRulesBySurface([rule()]), SURFACES, 0, 0);
      expect(batches).toEqual([]);
    });

    it('does not let the first surface walked decide the category for a model that scatters on several', () => {
      // 19 of the 56 models in stock procobj.dat do this; `p_rubble05col` is rocks on land and underwater
      // below the waterline. Keyed by model alone, one batch took whichever surface came first.
      const rules = groupRulesBySurface([
        rule({ model: 'p_rubble05col', surface: 'p_sand' }),
        rule({ model: 'p_rubble05col', surface: 'p_underwaterbarren' }),
      ]);

      const batches = scatterProcObjects([triangleCollider(1), triangleCollider(2)], rules, SURFACES, 0, 0);

      expect(batches.map((batch) => [batch.surface, batch.category]).sort()).toEqual([
        ['p_sand', 'rocks'],
        ['p_underwaterbarren', 'underwater'],
      ]);
      expect(batches.every((batch) => batch.placements.length > 0)).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('is deterministic — same cell gives byte-identical placements, other cells differ', () => {
      const rules = groupRulesBySurface([rule()]);
      const first = scatterProcObjects([triangleCollider(1)], rules, SURFACES, 3, -7);
      const second = scatterProcObjects([triangleCollider(1)], rules, SURFACES, 3, -7);
      expect(second).toEqual(first);
      const other = scatterProcObjects([triangleCollider(1)], rules, SURFACES, 4, -7);
      expect(other).not.toEqual(first);
    });

    it('generates against a RAISED candidate ceiling, so cutoffs above the default become reachable', () => {
      const rules = groupRulesBySurface([rule()]);

      const wide = scatterProcObjects([triangleCollider(1)], rules, SURFACES, 0, 0, 6);

      expect(wide[0].placements).toHaveLength((2000 / (10 * 10)) * 6); // 120, against 60 at the default
      expect(Math.max(...wide[0].placements.map((p) => p.lottery))).toBeGreaterThan(PROC_OBJ_MAX_DENSITY);
    });

    it('keeps the MEANING of a cutoff at any ceiling — `< 1` is the authored density either way', () => {
      const rules = groupRulesBySurface([rule()]);
      const vanillaCount = (batches: ReturnType<typeof scatterProcObjects>): number =>
        batches[0].placements.filter((p) => p.lottery < 1).length;

      // Area 2000 / spacing² 100 = 20 objects at the authored density, whatever headroom generated them.
      expect(vanillaCount(scatterProcObjects([triangleCollider(1)], rules, SURFACES, 0, 0))).toBeGreaterThan(12);
      expect(vanillaCount(scatterProcObjects([triangleCollider(1)], rules, SURFACES, 0, 0))).toBeLessThan(29);
      expect(vanillaCount(scatterProcObjects([triangleCollider(1)], rules, SURFACES, 0, 0, 6))).toBeGreaterThan(12);
      expect(vanillaCount(scatterProcObjects([triangleCollider(1)], rules, SURFACES, 0, 0, 6))).toBeLessThan(29);
    });

    it('RE-ROLLS the scatter from the SECOND face on when the ceiling changes', () => {
      const rules = groupRulesBySurface([rule()]);
      const positions = (batches: ReturnType<typeof scatterProcObjects>): Set<string> =>
        new Set(batches[0].placements.map((p) => JSON.stringify(p.position)));
      const two = [triangleCollider(1), triangleCollider(1)];

      const base = positions(scatterProcObjects(two, rules, SURFACES, 0, 0));
      const wide = positions(scatterProcObjects(two, rules, SURFACES, 0, 0, 6));

      // A face consumes draws in proportion to its candidate COUNT, so raising the ceiling shifts where every
      // later face starts in the sequence. The first face's placements survive; nothing after it does.
      expect([...base].every((p) => wide.has(p))).toBe(false);
    });

    it('generates MAX_DENSITY × the vanilla count, lottery-sorted for the density cutoff', () => {
      const batches = scatterProcObjects([triangleCollider(1)], groupRulesBySurface([rule()]), SURFACES, 0, 0);
      expect(batches).toHaveLength(1);
      const { placements } = batches[0];
      // SPACING is a LENGTH: one object per spacing² m², so area 2000 / 10² = 20 at vanilla density.
      expect(placements).toHaveLength((2000 / (10 * 10)) * PROC_OBJ_MAX_DENSITY);
      for (let i = 1; i < placements.length; i += 1) {
        expect(placements[i].lottery).toBeGreaterThanOrEqual(placements[i - 1].lottery);
      }
      // Vanilla density 1 ⇒ the cutoff keeps roughly the authored 20 objects.
      const vanilla = placements.filter((placement) => placement.lottery < 1).length;
      expect(vanilla).toBeGreaterThan(10);
      expect(vanilla).toBeLessThan(30);
    });

    it('spends SPACING as a LENGTH — doubling it QUARTERS the count, it does not halve it', () => {
      // The property the 2026-08-09 fix is about, and the one a constant cannot pin: `area / spacing²`.
      // Under the old `area / spacing` reading this ratio would be 2, and every count below would be right
      // for the wrong reason. Same seed and same face, so only the column's meaning differs.
      const at = (spacing: number): number =>
        scatterProcObjects([triangleCollider(1)], groupRulesBySurface([rule({ spacing })]), SURFACES, 0, 0)[0]
          .placements.length;

      expect(at(10)).toBe(60); // area 2000 / 10² × 3
      expect(at(20)).toBe(15); // ×4 the spacing-squared ⇒ ÷4 the count
      expect(at(10) / at(20)).toBe(4);
    });

    it('leaves a sparse species absent from most faces (a 163 m rule is one tree per 26 569 m²)', () => {
      // `p_woodland DEAD_TREE_2`'s real spacing. On a 2000 m² face it expects 0.23 candidates, so the
      // fractional lottery must resolve to a handful of cells with one and the rest with none — the
      // "isolated dead trees" the data authors. Under `area / spacing` it would expect 36 on every face.
      const rules = groupRulesBySurface([rule({ model: 'dead_tree_2', spacing: 163 })]);
      const counts = Array.from(
        { length: 40 },
        (_, i) => scatterProcObjects([triangleCollider(1)], rules, SURFACES, i, 0)[0]?.placements.length ?? 0,
      );

      expect(Math.max(...counts)).toBeLessThanOrEqual(1); // never a clump of dead trees
      expect(counts.filter((n) => n === 0).length).toBeGreaterThan(20); // absent from most cells
      expect(counts.some((n) => n === 1)).toBe(true); // but it does fire — a zero here would be no evidence
    });

    it('never spaces placements by the MINDIST column — that column is a camera radius', () => {
      // Fails the day someone adds an exclusion radius to the SCATTER (an "anti-clumping" pass is the
      // plausible shape). It does NOT re-catch the deleted `cullByMinDistance`, which lived downstream in
      // `map-placement/procobj/convert.ts` and cannot be unit-tested without a fixture game dir — that seam
      // is named as uncovered in lod-procobj-generator/009. The rule fixture's minDistance is 60.
      const batches = scatterProcObjects([triangleCollider(1)], groupRulesBySurface([rule()]), SURFACES, 0, 0);
      const { placements } = batches[0];
      let nearest = Infinity;
      for (let i = 0; i < placements.length; i += 1) {
        for (let j = i + 1; j < placements.length; j += 1) {
          const dx = placements[i].position[0] - placements[j].position[0];
          const dy = placements[i].position[1] - placements[j].position[1];
          nearest = Math.min(nearest, Math.hypot(dx, dy));
        }
      }

      expect(nearest).toBeLessThan(rule().minDistance); // same species, metres apart — the authored look
    });

    it('places inside the face with the rule ranges applied (scale/rotation/z-offset/normal)', () => {
      const batches = scatterProcObjects([triangleCollider(1)], groupRulesBySurface([rule()]), SURFACES, 1, 2);
      for (const placement of batches[0].placements) {
        const [x, y, z] = placement.position;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x / 100 + y / 40).toBeLessThanOrEqual(1.0001); // inside the triangle
        expect(z).toBeCloseTo(-0.3, 5); // zOffMin == zOffMax == −0.3
        expect(placement.normal).toEqual([0, 0, 1]);
        expect(placement.align).toBe(true);
        expect(placement.scale).toBeGreaterThanOrEqual(0.5);
        expect(placement.scale).toBeLessThanOrEqual(1.5);
        expect(placement.scaleZ).toBeGreaterThanOrEqual(0.4);
        expect(placement.scaleZ).toBeLessThanOrEqual(1.2);
        expect(placement.rotation).toBeGreaterThanOrEqual(0);
        expect(placement.rotation).toBeLessThanOrEqual(Math.PI * 2);
      }
    });

    it('flips downward face normals up — clutter grows OUT of the ground (winding-proof)', () => {
      // Same triangle with reversed winding: raw (b−a)×(c−a) points (0,0,−1).
      const collider = triangleCollider(1);
      collider.col.faces = [{ a: 0, b: 2, c: 1, light: 0, material: 1 }];
      const batches = scatterProcObjects([collider], groupRulesBySurface([rule()]), SURFACES, 0, 0);
      expect(batches[0].placements.length).toBeGreaterThan(0);
      for (const placement of batches[0].placements) {
        // (toBeCloseTo: negate() leaves −0 components, which toEqual would distinguish from 0)
        expect(placement.normal[0]).toBeCloseTo(0, 9);
        expect(placement.normal[1]).toBeCloseTo(0, 9);
        expect(placement.normal[2]).toBeCloseTo(1, 9); // align rules must not plant bushes upside-down
      }
    });

    it('applies the placement world transform', () => {
      const moved = triangleCollider(1, new Matrix4().makeTranslation(100, 50, 7));
      const batches = scatterProcObjects([moved], groupRulesBySurface([rule()]), SURFACES, 0, 0);
      for (const placement of batches[0].placements) {
        expect(placement.position[0]).toBeGreaterThanOrEqual(100);
        expect(placement.position[1]).toBeGreaterThanOrEqual(50);
        expect(placement.position[2]).toBeCloseTo(7 - 0.3, 5);
      }
    });

    it('batches per model with the semantic category resolved', () => {
      const rules = groupRulesBySurface([
        rule(),
        rule({ model: 'searock01', spacing: 20, surface: 'p_underwaterbarren' }),
      ]);
      const colliders = [triangleCollider(1), triangleCollider(2)];
      const batches = scatterProcObjects(colliders, rules, SURFACES, 0, 0);
      const byModel = new Map(batches.map((batch) => [batch.model, batch]));
      expect(byModel.get('sand_combush02')?.category).toBe('bushes');
      expect(byModel.get('searock01')?.category).toBe('underwater');
    });
  });
});

describe('procObjLotteryCap', () => {
  describe('negative cases', () => {
    it('is unlimited without a limit or when under it', () => {
      const batches = scatterProcObjects([triangleCollider(1)], groupRulesBySurface([rule()]), SURFACES, 0, 0);
      expect(procObjLotteryCap(batches)).toBe(Number.POSITIVE_INFINITY);
      expect(procObjLotteryCap(batches, 10_000)).toBe(Number.POSITIVE_INFINITY);
    });
  });

  describe('positive cases', () => {
    it('returns the threshold below which exactly `limit` placements fall, cell-wide', () => {
      const batches = scatterProcObjects([triangleCollider(1)], groupRulesBySurface([rule()]), SURFACES, 0, 0);
      const cap = procObjLotteryCap(batches, 25);
      const kept = batches.flatMap((batch) => batch.placements).filter((placement) => placement.lottery < cap);
      expect(kept).toHaveLength(25);
    });
  });
});

describe('procObjCategory', () => {
  describe('negative cases', () => {
    it('falls back to bushes for unknown models', () => {
      expect(procObjCategory('future_model', 'p_sand')).toBe('bushes');
    });
  });

  describe('positive cases', () => {
    it('maps the procobj.dat models to their groups', () => {
      expect(procObjCategory('sjmcacti2', 'p_sand')).toBe('cacti');
      expect(procObjCategory('veg_procgrasspatch', 'p_grass_dry')).toBe('grass');
      expect(procObjCategory('veg_Pflowers03', 'p_flowerbed')).toBe('flowers');
      expect(procObjCategory('Cedar1_PO', 'p_bushydry')).toBe('trees');
      expect(procObjCategory('p_rubble', 'p_mountain')).toBe('rocks');
    });

    it('forces underwater for anything on the sea floor (rubble rules reused there)', () => {
      expect(procObjCategory('p_rubble', 'p_underwaterbarren')).toBe('underwater');
    });
  });
});
