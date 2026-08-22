import { describe, expect, it } from 'vitest';

import type { MapPose } from './map-camera';

import { MAP_YAW, MapCamera } from './map-camera';

/**
 * Straight down. The camera's own bound sits just SHORT of this (`TOP_DOWN_PITCH` keeps a hundredth of a
 * radian, or the view direction goes parallel to `up` and the basis degenerates), so asking for it is asking
 * past the bound on purpose — which is exactly what a caller wanting "as far down as this camera goes" does.
 */
const STRAIGHT_DOWN = -Math.PI / 2;

const OPENING: MapPose = { at: [1700, -1500], height: 900, pitch: -1.15, projection: 'perspective', yaw: MAP_YAW };

describe('MapCamera.applyPose', () => {
  describe('negative cases', () => {
    it('clamps a pitch that would look at the horizon, so a map view can never show sky', () => {
      const camera = new MapCamera(OPENING);
      camera.applyPose({ ...OPENING, pitch: 0 });

      expect(camera.pose().pitch).toBeLessThan(0);
    });

    it('clamps a pitch past straight down rather than flipping the view through the vertical', () => {
      const camera = new MapCamera(OPENING);
      camera.applyPose({ ...OPENING, pitch: -Math.PI });

      expect(camera.pose().pitch).toBeGreaterThanOrEqual(STRAIGHT_DOWN);
      expect(camera.height()).toBeGreaterThan(0);
    });

    it('does not let a zero height collapse the view distance to nothing', () => {
      const camera = new MapCamera(OPENING);
      camera.applyPose({ ...OPENING, height: 0 });

      expect(camera.height()).toBeGreaterThan(0);
    });
  });

  describe('positive cases', () => {
    it('is what the constructor does, so a fresh camera and an applied pose agree', () => {
      const applied = new MapCamera({ ...OPENING, at: [0, 0] });
      applied.applyPose(OPENING);

      expect(applied.pose()).toEqual(new MapCamera(OPENING).pose());
    });

    it('sets a tilt outright, which no relative step can do without knowing the step scale', () => {
      const camera = new MapCamera(OPENING);
      camera.applyPose({ ...OPENING, pitch: -0.8 });

      expect(camera.pose().pitch).toBeCloseTo(-0.8);
    });

    it('answers its own bound to anything past it, so a caller need not know where the bound is', () => {
      const asked = new MapCamera(OPENING);
      const overshot = new MapCamera(OPENING);
      asked.applyPose({ ...OPENING, pitch: STRAIGHT_DOWN });
      overshot.applyPose({ ...OPENING, pitch: -Math.PI });

      expect(asked.pose().pitch).toBe(overshot.pose().pitch);
      // And that bound really is a top-down view, not some shallow default.
      expect(asked.pose().pitch).toBeLessThan(STRAIGHT_DOWN + 0.05);
    });

    it('holds the ground point and the eye height it was given', () => {
      const camera = new MapCamera(OPENING);
      camera.applyPose({ at: [500, 600], height: 420, pitch: -1, projection: 'perspective', yaw: 0.25 });

      expect(camera.positionGta()[0]).toBeCloseTo(500);
      expect(camera.positionGta()[1]).toBeCloseTo(600);
      expect(camera.height()).toBeCloseTo(420);
      expect(camera.pose().yaw).toBeCloseTo(0.25);
    });

    it('round-trips a pose, so a host can save one and restore it', () => {
      const camera = new MapCamera(OPENING);
      camera.orbit(120, -40);
      camera.dolly(-1);
      const saved = camera.pose();

      camera.applyPose({ at: [0, 0], height: 100, pitch: STRAIGHT_DOWN, projection: 'perspective', yaw: 0 });
      camera.applyPose(saved);

      expect(camera.pose().at[0]).toBeCloseTo(saved.at[0]);
      expect(camera.pose().at[1]).toBeCloseTo(saved.at[1]);
      expect(camera.pose().height).toBeCloseTo(saved.height);
      expect(camera.pose().pitch).toBeCloseTo(saved.pitch);
      expect(camera.pose().yaw).toBeCloseTo(saved.yaw);
    });
  });
});

describe('MapCamera projection', () => {
  describe('negative cases', () => {
    it('does not fan the picking rays out when the view is orthographic', () => {
      const camera = new MapCamera({ ...OPENING, projection: 'ortho' });
      const left = camera.rayAt([-0.9, 0], 16 / 9);
      const right = camera.rayAt([0.9, 0], 16 / 9);

      // Parallel rays: the DIRECTION is the same everywhere and the ORIGIN is what moves. Reading it the
      // perspective way puts every pick under the middle of the screen, and nothing says so.
      expect(right.direction).toEqual(left.direction);
      expect(right.origin[0]).not.toBeCloseTo(left.origin[0]);
    });

    it('does not leave a perspective near plane in front of a plan view, which would slice the towers off', () => {
      const camera = new MapCamera({ ...OPENING, projection: 'ortho' });

      // Behind the eye: an orthographic box has no apex, so the front plane may sit above the camera.
      expect(camera.state(1).near).toBeLessThan(0);
    });
  });

  describe('positive cases', () => {
    it('carries the projection through a pose round trip, so a shared view opens as it was left', () => {
      const camera = new MapCamera({ ...OPENING, projection: 'ortho' });

      expect(camera.pose().projection).toBe('ortho');
      expect(new MapCamera(camera.pose()).pose().projection).toBe('ortho');
    });

    it('leaves perspective unchanged: no ortho box, and the game camera fov', () => {
      const camera = new MapCamera(OPENING);
      const state = camera.state(16 / 9);

      expect(state.orthoHalfHeight).toBeUndefined();
      expect(state.near).toBeGreaterThan(0);
    });

    it('frames the same ground extent it framed in perspective, so switching is not a jump', () => {
      const perspective = new MapCamera(OPENING);
      const ortho = new MapCamera({ ...OPENING, projection: 'ortho' });
      const state = ortho.state(16 / 9);
      const distance = Math.hypot(
        ...(perspective.state(1).eye.map((value, axis) => value - perspective.state(1).target[axis]) as [
          number,
          number,
          number,
        ]),
      );

      // The half-height of a perspective frustum at the focus plane, which is what the box has to match.
      expect(state.orthoHalfHeight).toBeCloseTo(distance * Math.tan(Math.PI / 3 / 2), 3);
    });

    it('switches in place: the pose is the same view, only projected differently', () => {
      const camera = new MapCamera(OPENING);
      const before = camera.pose();
      camera.setProjection('ortho');
      const after = camera.pose();

      expect(after).toEqual({ ...before, projection: 'ortho' });
      expect(camera.state(1).orthoHalfHeight).toBeGreaterThan(0);
    });

    it('keeps the ray under the cursor pointing where the view points', () => {
      const camera = new MapCamera({ ...OPENING, projection: 'ortho' });
      const centre = camera.rayAt([0, 0], 16 / 9);
      const eye = camera.state(16 / 9).eye;

      // The centre ray is the view axis itself: same origin as the eye, aimed at the focus.
      expect(centre.origin[0]).toBeCloseTo(eye[0]);
      expect(centre.origin[1]).toBeCloseTo(eye[1]);
      expect(centre.origin[2]).toBeCloseTo(eye[2]);
      expect(centre.direction[1]).toBeLessThan(0);
    });
  });
});
