import { DoubleSide, FrontSide } from 'three';
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import type { DynamicMaterialParams } from './build-clump';

import { applyNightFillTsl, buildDynamicMaterialTsl } from './night-fill-tsl';

const PARAMS: DynamicMaterialParams = {
  alphaTest: 0.5,
  color: 0xffffff,
  map: null,
  metalness: 0,
  roughness: 1,
  side: DoubleSide,
  transparent: true,
  vertexColors: true,
};

describe('buildDynamicMaterialTsl', () => {
  describe('negative cases', () => {
    it('does not use the physical (clearcoat) tier for non-reflective materials', () => {
      const material = buildDynamicMaterialTsl(PARAMS, false);

      expect(material).not.toBeInstanceOf(MeshPhysicalNodeMaterial);
      expect(material).toBeInstanceOf(MeshStandardNodeMaterial);
    });
  });

  describe('positive cases', () => {
    it('builds a node material carrying the resolved params', () => {
      const material = buildDynamicMaterialTsl({ ...PARAMS, side: FrontSide, transparent: false }, false);

      expect(material.side).toBe(FrontSide);
      expect(material.transparent).toBe(false);
      expect(material.vertexColors).toBe(true);
      expect(material.roughness).toBe(1);
      expect(material.metalness).toBe(0);
    });

    it('keeps reflective materials on the physical tier (the deferred env-map work lands there)', () => {
      const material = buildDynamicMaterialTsl(PARAMS, true);

      expect(material).toBeInstanceOf(MeshPhysicalNodeMaterial);
      expect((material as unknown as MeshPhysicalNodeMaterial).clearcoat).toBe(0);
    });
  });
});

describe('applyNightFillTsl', () => {
  describe('positive cases', () => {
    it('sets the shared night-fill emissive node (one graph for every dynamics material)', () => {
      const first = buildDynamicMaterialTsl(PARAMS, false) as unknown as MeshStandardNodeMaterial;
      const second = buildDynamicMaterialTsl(PARAMS, true) as unknown as MeshStandardNodeMaterial;

      applyNightFillTsl(first as unknown as Parameters<typeof applyNightFillTsl>[0]);
      applyNightFillTsl(second as unknown as Parameters<typeof applyNightFillTsl>[0]);

      expect(first.emissiveNode).not.toBeNull();
      expect(second.emissiveNode).toBe(first.emissiveNode);
    });
  });
});
