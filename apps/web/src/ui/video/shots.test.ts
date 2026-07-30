import { describe, expect, it } from 'vitest';

import {
  aimShot,
  anchorFor,
  forwardFromHeading,
  type PosedShot,
  projectToScreen,
  shotEye,
  SHOTS,
  type Subject,
} from './shots';

const ASPECT = 16 / 9;
/** A saloon's own numbers (`admiral`-sized): half width, half length, half height. */
const HALF_EXTENTS = [0.9, 2.3, 0.7] as const;

const WING: PosedShot = {
  anchor: { x: 0.38, y: 0.58 },
  eyeSmooth: 0.18,
  fovYRad: Math.PI / 4,
  kind: 'tracking',
  maxDist: 40,
  maxSeconds: 7,
  minSeconds: 5,
  name: 'wing-l',
  offset: { forward: 0.4, height: 1.6, lateral: -5 },
  targetSmooth: 0.14,
  weight: 2,
};

/** A car at the origin, driving along its own heading at `speed`. */
const subjectAt = (
  heading: number,
  speed: number,
  position: readonly [number, number, number] = [0, 0, 0],
): Subject => ({
  forward: forwardFromHeading(heading),
  halfExtents: HALF_EXTENTS,
  position,
  speed,
});

describe('forwardFromHeading', () => {
  describe('positive cases', () => {
    it('faces engine −Z at heading 0 (GTA +Y) and engine +X at heading −pi/2', () => {
      const [ax, ay, az] = forwardFromHeading(0);
      expect(ax).toBeCloseTo(0, 6);
      expect(ay).toBe(0);
      expect(az).toBeCloseTo(-1, 6);

      const [bx, , bz] = forwardFromHeading(-Math.PI / 2);
      expect(bx).toBeCloseTo(1, 6);
      expect(bz).toBeCloseTo(0, 6);
    });
  });
});

describe('shotEye', () => {
  describe('negative cases', () => {
    it('writes no metre of its own — a car twice the size is filmed twice as far out', () => {
      const small = shotEye(WING, subjectAt(0, 12));
      const large = shotEye(WING, { ...subjectAt(0, 12), halfExtents: [1.8, 4.6, 1.4] });

      expect(Math.hypot(large[0], large[2])).toBeCloseTo(2 * Math.hypot(small[0], small[2]), 6);
      expect(large[1]).toBeCloseTo(2 * small[1], 6);
    });
  });

  describe('positive cases', () => {
    it('puts a lateral offset on the side of the car it belongs to, whatever way the car faces', () => {
      // Heading 0 faces engine −Z, so the car's right is engine +X and a −5 lateral sits at −X.
      const north = shotEye(WING, subjectAt(0, 12));
      expect(north[0]).toBeCloseTo(-5 * HALF_EXTENTS[0], 6);
      expect(north[2]).toBeCloseTo(-0.4 * HALF_EXTENTS[1], 6);

      // Turn the car a quarter turn and the SAME offset follows it round.
      const east = shotEye(WING, subjectAt(-Math.PI / 2, 12));
      expect(east[2]).toBeCloseTo(-5 * HALF_EXTENTS[0], 6);
      expect(east[0]).toBeCloseTo(0.4 * HALF_EXTENTS[1], 6);
    });

    it('lifts by the height the car itself has', () => {
      expect(shotEye(WING, subjectAt(0, 12))[1]).toBeCloseTo(1.6 * HALF_EXTENTS[2], 6);
    });
  });
});

describe('aimShot', () => {
  const CASES = [
    { anchor: { x: 0.38, y: 0.58 }, distance: 6, fovYRad: Math.PI / 4 },
    { anchor: { x: 0.5, y: 0.5 }, distance: 6, fovYRad: Math.PI / 3 },
    { anchor: { x: 0.62, y: 0.35 }, distance: 25, fovYRad: (40 * Math.PI) / 180 },
    { anchor: { x: 0.3, y: 0.7 }, distance: 60, fovYRad: (55 * Math.PI) / 180 },
  ];

  describe('negative cases', () => {
    it('does not drag the car to the centre — an off-centre anchor stays off-centre', () => {
      const eye: [number, number, number] = [0, 2, 12];
      const target = aimShot(eye, [0, 1, 0], { x: 0.38, y: 0.58 }, Math.PI / 4, ASPECT);
      const screen = projectToScreen(eye, target, Math.PI / 4, ASPECT, [0, 1, 0]);

      expect(Math.abs(screen.x - 0.5)).toBeGreaterThan(0.05);
    });
  });

  describe('positive cases', () => {
    it('lands the car on its anchor at every distance and lens the presets use', () => {
      for (const { anchor, distance, fovYRad } of CASES) {
        const eye: [number, number, number] = [0, 2, distance];
        const target = aimShot(eye, [0, 1, 0], anchor, fovYRad, ASPECT);
        const screen = projectToScreen(eye, target, fovYRad, ASPECT, [0, 1, 0]);

        expect(screen.x).toBeCloseTo(anchor.x, 2);
        expect(screen.y).toBeCloseTo(anchor.y, 2);
      }
    });

    it('holds the anchor when the camera stands off to one side, not just behind', () => {
      const eye: [number, number, number] = [14, 3, 4];
      const anchor = { x: 0.4, y: 0.6 };
      const target = aimShot(eye, [0, 1, 0], anchor, Math.PI / 4, ASPECT);
      const screen = projectToScreen(eye, target, Math.PI / 4, ASPECT, [0, 1, 0]);

      expect(screen.x).toBeCloseTo(anchor.x, 2);
      expect(screen.y).toBeCloseTo(anchor.y, 2);
    });
  });
});

describe('anchorFor (lead room)', () => {
  describe('negative cases', () => {
    it('keeps the authored side for a car that is barely moving — no coin flip at a standstill', () => {
      const eye: [number, number, number] = [0, 2, 12];

      expect(anchorFor(WING, eye, subjectAt(-Math.PI / 2, 0.5))).toEqual(WING.anchor);
    });
  });

  describe('positive cases', () => {
    it('frames the car on the side OPPOSITE its screen travel, and flips when it reverses', () => {
      // Camera on +Z looking at the origin: its screen right is world +X (mat4LookAt's basis).
      const eye: [number, number, number] = [0, 2, 12];
      const crossingLeft = anchorFor(WING, eye, subjectAt(Math.PI / 2, 12)); // heading +pi/2 → engine −X
      const crossingRight = anchorFor(WING, eye, subjectAt(-Math.PI / 2, 12));

      expect(crossingRight.x).toBeLessThan(0.5); // driving screen-right → framed left, road ahead open
      expect(crossingLeft.x).toBeGreaterThan(0.5);
      expect(crossingLeft.x + crossingRight.x).toBeCloseTo(1, 9); // mirrored about centre
      expect(crossingLeft.y).toBe(WING.anchor.y); // the vertical anchor is authored, never mirrored
    });
  });
});

describe('projectToScreen', () => {
  describe('negative cases', () => {
    it('reports a point BEHIND the camera instead of a plausible pair of numbers', () => {
      const screen = projectToScreen([0, 2, 0], [0, 2, -10], Math.PI / 3, ASPECT, [0, 2, 8]);

      expect(screen.behind).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('puts the look point dead centre', () => {
      const screen = projectToScreen([0, 2, 12], [0, 1, 0], Math.PI / 3, ASPECT, [0, 1, 0]);

      expect(screen.x).toBeCloseTo(0.5, 9);
      expect(screen.y).toBeCloseTo(0.5, 9);
    });
  });
});

describe('SHOTS (the preset table)', () => {
  describe('negative cases', () => {
    it('holds no shot under the five-second floor of D4, and none that ends before it starts', () => {
      const bad = SHOTS.filter((shot) => shot.minSeconds < 5 || shot.maxSeconds < shot.minSeconds);

      expect(bad.map((shot) => shot.name)).toEqual([]);
    });

    it('places no camera inside the car it films', () => {
      // A tripod's eye comes from 04's survey, not from the car — only the car-anchored rows are asked here.
      const placed = SHOTS.filter((shot): shot is PosedShot => shot.kind === 'static' || shot.kind === 'tracking');
      const inside = placed.filter((shot) => {
        const eye = shotEye(shot, subjectAt(0, 12));

        return Math.abs(eye[0]) < HALF_EXTENTS[0] && Math.abs(eye[2]) < HALF_EXTENTS[1] && eye[1] < HALF_EXTENTS[2];
      });

      expect(inside.map((shot) => shot.name)).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('offers exactly one chase shot — the one that yields the frame to the shipped rig', () => {
      expect(SHOTS.filter((shot) => shot.kind === 'chase').map((shot) => shot.name)).toEqual(['chase']);
    });

    it('names every shot once', () => {
      expect(new Set(SHOTS.map((shot) => shot.name)).size).toBe(SHOTS.length);
    });
  });
});
