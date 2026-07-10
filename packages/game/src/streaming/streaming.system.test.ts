import { Object3D } from 'three';
import { describe, expect, it, type Mock, vi } from 'vitest';

import type { Config } from '../interfaces/config.interface';
import type { CellRequest, Vec3 } from '../interfaces/world-adapter.interface';

import { StreamingSystem } from './streaming.system';

function config(overrides: Partial<Config> = {}): Config {
  return {
    camera: {
      followDistance: 12,
      followHeight: 1.5,
      followLerp: 3,
      followMaxPolar: 1.5,
      followMinPolar: 0.25,
      followPolar: 1.15,
      followZoom: true,
      followZoomMax: 40,
      followZoomMin: 6,
    },
    controls: { back: 'KeyS', forward: 'KeyW', jump: 'Space', left: 'KeyA', right: 'KeyD' },
    fog: { distance: 800 },
    fonts: { hud: { clock: 'SixCaps-Regular', zone: 'SixCaps-Regular' } },
    gameState: 'play',
    graphics: {
      bloom: { enabled: true, intensity: 0.7, threshold: 0.7 },
      clouds: { coverage: 0.5, opacity: 0.85 },
      effects: { drawDistance: 150, enabled: true },
      headlights: {
        coronaIntensity: 0.8,
        coronaSize: 0.28,
        intensity: 1,
      },
      lights: { enabled: true, nightEndHour: 6, nightStartHour: 20 },
      moon: { brightness: 1, elevationDeg: 35, size: 150 },
      night: {
        coronaDrawDistance: 120,
        dynamicObjectsFill: { rim: 0.5, strength: 0.35 },
        litFade: { dawnEnd: 7, dawnStart: 6, duskEnd: 21, duskStart: 20 },
        skylight: 0.6,
        windowGlow: 1,
      },
      pipeline: 'classic',
      procobj: {
        bushes: { density: 1, drawDistance: 80, enabled: true },
        cacti: { density: 1, drawDistance: 100, enabled: true },
        flowers: { density: 1, drawDistance: 50, enabled: true },
        grass: { density: 1, drawDistance: 50, enabled: true },
        rocks: { density: 1, drawDistance: 80, enabled: true },
        trees: { density: 1, drawDistance: 150, enabled: true },
        underwater: { density: 1, drawDistance: 60, enabled: true },
      },
      shadows: { distance: 800, enabled: true },
      sky: { density: 0.96, exposure: 0.5, weight: 0.4 },
      ssao: { enabled: true, intensity: 1.5, radius: 0.2 },
      stars: { enabled: true },
      sun: { godrays: true, godraysSize: 30, sunSize: 15 },
      toneMapping: false,
      toneMappingMode: 'aces',
      vehicleReflection: { intensity: 1, preset: 'enhanced' },
      water: { darkness: 0.55, glint: 1.5, reflection: 0.6 },
      worldLight: {
        dayBrightness: 0.85,
        duskBrightness: 0.45,
        lodNightAmbScale: 1.6,
        nightPrelitBrightness: 0.7,
        shadowStrength: 0.55,
        sunDirect: 1,
        sunIndirect: 0.7,
      },
    },
    hud: {
      clock: { borderColor: '#000', borderWidth: 1, color: '#fff', fontSize: 52 },
      zone: { borderColor: '#000', borderWidth: 1, color: '#fff', fontSize: 40 },
    },
    mapViewer: false,
    movement: { accel: 20, airControl: 0.3, deceleration: 25, jumpSpeed: 6, runSpeed: 26, walkSpeed: 10 },
    showCollision: false,
    showLogs: false,
    staticUrl: '',
    streaming: { cellSize: 250, collisionDrawDistance: 150, hdDrawDistance: 100, lodDrawDistance: 300 },
    time: { secondsPerGameMinute: 3 },
    vehicle: { hdDistance: 80, lodDistance: 250, unloadDistance: 500 },
    weatherTransitionSeconds: 0,
    ...overrides,
  };
}

/** Adapter whose loaded objects are named by their full stream key, so a specific cell+level is
 *  findable in the root (`0,0,hd` / `0,0,lod`). */
function keyedAdapter(): { cellSize: number; loadCell: Mock<(request: CellRequest) => Promise<Object3D[]>> } {
  return {
    cellSize: 250,
    loadCell: vi.fn((request: CellRequest): Promise<Object3D[]> => {
      const object = new Object3D();
      object.name = `${request.cx},${request.cy},${request.lod ? 'lod' : 'hd'}`;

      return Promise.resolve([object]);
    }),
  };
}

function stubAdapter(): { cellSize: number; loadCell: Mock<(request: CellRequest) => Promise<Object3D[]>> } {
  return {
    cellSize: 250,
    loadCell: vi.fn((request: CellRequest): Promise<Object3D[]> => {
      const object = new Object3D();
      object.name = request.lod ? 'lod' : 'hd';

      return Promise.resolve([object]);
    }),
  };
}

const has = (root: Object3D, key: string): boolean => root.children.some((c) => c.name === key);

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** One streaming round under the budgeted ingest (plan 060 Phase 2): request → resolve → ingest frame. */
const settle = async (system: StreamingSystem): Promise<void> => {
  system.update();
  await flush();
  system.update(); // the built cells enter the scene on the NEXT frame, under the ingest budget
};

describe('StreamingSystem', () => {
  describe('negative cases', () => {
    it('is not settled before the first update or while cells are still in flight (plan 061)', () => {
      const adapter = stubAdapter();
      const system = new StreamingSystem(adapter, new Object3D(), () => [125, 125, 0] as Vec3, config());
      expect(system.settled()).toBe(false); // no update ran — the world cannot be ready

      system.update(); // requests fired, nothing resolved yet
      expect(system.settled()).toBe(false);
      const progress = system.progress();
      expect(progress.total).toBeGreaterThan(0);
      expect(progress.loaded).toBe(0);
    });

    it('ignores a manual selection while not in debug mode (keeps streaming)', async () => {
      const adapter = stubAdapter();
      const root = new Object3D();
      const system = new StreamingSystem(adapter, root, () => [125, 125, 0] as Vec3, config());
      system.setManualCells([[5, 5]], true);

      await settle(system);

      expect(root.children).toHaveLength(9); // the stream rings, not the 1 manual cell
      expect(adapter.loadCell.mock.calls.some(([req]) => req.cx === 5)).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('streams HD in the near ring and LOD in the outer ring', async () => {
      const adapter = stubAdapter();
      const root = new Object3D();
      const system = new StreamingSystem(adapter, root, () => [125, 125, 0] as Vec3, config());

      await settle(system);

      // hd 100 → cell (0,0); lod 300 → 3×3 block minus (0,0) = 8 LOD cells
      expect(root.children.filter((c) => c.name === 'hd')).toHaveLength(1);
      expect(root.children.filter((c) => c.name === 'lod')).toHaveLength(8);
    });

    it('unloads cells that leave the view and loads the new ones', async () => {
      const adapter = stubAdapter();
      const root = new Object3D();
      let view: Vec3 = [125, 125, 0];
      const system = new StreamingSystem(adapter, root, () => view, config());

      await settle(system);
      const firstChildren = [...root.children];

      view = [100125, 100125, 0]; // centre of a far cell (same ring shape elsewhere)
      await settle(system);
      system.update(); // old cells drop once nothing for their cell is loading/ingesting

      expect(root.children.some((c) => firstChildren.includes(c))).toBe(false); // old gone
      expect(root.children).toHaveLength(firstChildren.length); // same ring size elsewhere
    });

    it('keeps the LOD cell until its HD replacement loads, then swaps (no empty frame)', async () => {
      const adapter = keyedAdapter();
      const root = new Object3D();
      let view: Vec3 = [125, 400, 0]; // cell (0,0) is ~150 away → LOD
      const system = new StreamingSystem(adapter, root, () => view, config());

      await settle(system);
      expect(has(root, '0,0,lod')).toBe(true);
      expect(has(root, '0,0,hd')).toBe(false);

      view = [125, 125, 0]; // now inside cell (0,0) → HD desired
      system.update(); // HD load STARTED but not resolved yet
      expect(has(root, '0,0,lod')).toBe(true); // LOD held → no hole while HD loads
      expect(has(root, '0,0,hd')).toBe(false);

      await flush(); // HD resolves → queued for ingest; LOD still held
      expect(has(root, '0,0,lod')).toBe(true);
      system.update(); // ingest frame: HD added, LOD removed in the same step
      expect(has(root, '0,0,hd')).toBe(true);
      expect(has(root, '0,0,lod')).toBe(false);
    });

    it('holds the current level across the hysteresis dead-band (no flip-flop at the boundary)', async () => {
      const adapter = keyedAdapter();
      const root = new Object3D();
      let view: Vec3 = [125, 125, 0]; // inside cell (0,0) → HD
      const system = new StreamingSystem(adapter, root, () => view, config());

      await settle(system);
      expect(has(root, '0,0,hd')).toBe(true);

      // Move to ~130 from cell (0,0): past hdDrawDistance (100) but within the dead-band
      // (hd 100 + 250×0.25 = 162.5), so an already-HD cell stays HD instead of downgrading to LOD.
      view = [125, 380, 0];
      await settle(system);
      expect(has(root, '0,0,hd')).toBe(true);
      expect(has(root, '0,0,lod')).toBe(false);
      expect(adapter.loadCell.mock.calls.some(([r]) => r.cx === 0 && r.cy === 0 && r.lod)).toBe(false);
    });

    it('settles once the view ring is loaded, drops on a teleport, settles again (plan 061)', async () => {
      const adapter = keyedAdapter();
      const root = new Object3D();
      let view: Vec3 = [125, 125, 0];
      const system = new StreamingSystem(adapter, root, () => view, config());

      await settle(system);
      system.update();
      expect(system.settled()).toBe(true);
      const progress = system.progress();
      expect(progress.loaded).toBe(progress.total);

      // Teleport far away: the whole view ring is new → not settled until it streams back in.
      view = [100125, 100125, 0];
      system.update();
      expect(system.settled()).toBe(false);
      await settle(system);
      system.update();
      expect(system.settled()).toBe(true); // the freeze can lift
    });

    it('prefetches the cell ahead of the motion vector before the boundary (plan 060 Phase 1)', async () => {
      const adapter = keyedAdapter();
      const root = new Object3D();
      let view: Vec3 = [125, 125, 0];
      const system = new StreamingSystem(adapter, root, () => view, config());

      await settle(system);
      const before = adapter.loadCell.mock.calls.length;

      // Two frames moving +y at 100 u/s: lookahead = min(100×3, 250) = 250 → the ring shifts one cell up.
      view = [125, 225, 0];
      system.update(0.1); // establishes velocity ~[0, 1000, 0]… clamped by reach to one cell
      view = [125, 235, 0];
      system.update(0.1);
      await flush();

      const requested = adapter.loadCell.mock.calls.slice(before).map(([r]) => `${r.cx},${r.cy},${r.lod}`);
      expect(requested.some((key) => key.includes(',2,'))).toBe(true); // a cy=2 cell — beyond the stationary ring
    });

    it('warms a big cell in slices and holds the old level until it appears atomically', async () => {
      const adapter = {
        cellSize: 250,
        loadCell: vi.fn((request: CellRequest): Promise<Object3D[]> => {
          if (!request.lod && request.cx === 0 && request.cy === 0) {
            return Promise.resolve(
              Array.from({ length: 60 }, (_, i) => {
                const part = new Object3D();
                part.name = `hd_part_${i}`;

                return part;
              }),
            );
          }
          const object = new Object3D();
          object.name = request.lod ? `lod_${request.cx},${request.cy}` : 'hd_other';

          return Promise.resolve([object]);
        }),
      };
      const root = new Object3D();
      let view: Vec3 = [125, 400, 0]; // cell (0,0) starts as LOD
      const warmSlices: number[] = [];
      const system = new StreamingSystem(adapter, root, () => view, config(), {
        warmUp: (objects): void => {
          warmSlices.push(objects.length);
        },
      });

      await settle(system);
      system.update();
      expect(has(root, 'lod_0,0')).toBe(true);

      view = [125, 125, 0]; // HD desired for (0,0)
      system.update();
      await flush(); // HD (60 objects) resolves → queued for warming
      system.update(); // warm frame 1 (≤24 objects) — nothing visible yet, LOD held
      expect(root.children.filter((c) => c.name.startsWith('hd_part'))).toHaveLength(0);
      expect(has(root, 'lod_0,0')).toBe(true);
      for (let i = 0; i < 6; i += 1) {
        system.update(); // warm frames 2..N, then the ATOMIC appearance + swap
      }
      expect(warmSlices.every((size) => size <= 24)).toBe(true);
      expect(warmSlices.reduce((sum, size) => sum + size, 0)).toBeGreaterThanOrEqual(60);
      expect(root.children.filter((c) => c.name.startsWith('hd_part'))).toHaveLength(60); // all at once
      expect(has(root, 'lod_0,0')).toBe(false);
    });

    it('renders only the manual cells while in debug mode', async () => {
      const adapter = stubAdapter();
      const root = new Object3D();
      const system = new StreamingSystem(adapter, root, () => [0, 0, 0] as Vec3, config({ mapViewer: true }));
      system.setManualCells(
        [
          [5, 5],
          [6, 5],
        ],
        true,
      );

      await settle(system);

      expect(root.children).toHaveLength(2);
      expect(adapter.loadCell.mock.calls.map(([req]) => req)).toContainEqual({
        cx: 5,
        cy: 5,
        lod: true,
      });
    });
  });
});
