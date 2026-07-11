import { DirectionalLight, Matrix4, Scene, Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import type { PluginContext } from './plugin';

import { CsmPlugin, type CsmUniformSink } from './csm.plugin';

function installPlugin(): { cascades: DirectionalLight[]; scene: Scene } {
  const scene = new Scene();
  const sun = new DirectionalLight();
  const plugin = new CsmPlugin(
    () => new Vector3(0, 1, 0),
    () => sun.shadow,
    makeSink(),
    () => -1,
  );
  plugin.install({ scene } as unknown as PluginContext);
  const cascades = scene.children.filter(
    (child): child is DirectionalLight => (child as DirectionalLight).isDirectionalLight,
  );

  return { cascades, scene };
}

function makeSink(): CsmUniformSink {
  return {
    uCsmMaps: { value: [null, null, null] },
    uCsmMapSize: { value: new Vector2() },
    uCsmMatrices: { value: [new Matrix4(), new Matrix4(), new Matrix4()] },
    uCsmMix: { value: 0 },
    uCsmSplits: { value: new Vector3() },
  };
}

describe('CsmPlugin', () => {
  describe('negative cases', () => {
    it('does not auto-update the cascade maps (they render on the refresh schedule only)', () => {
      const { cascades } = installPlugin();

      expect(cascades).toHaveLength(2);
      for (const light of cascades) {
        expect(light.shadow.autoUpdate).toBe(false);
      }
    });

    it('does not let the cascade lights contribute light (shadow-only, intensity 0)', () => {
      const { cascades } = installPlugin();

      for (const light of cascades) {
        expect(light.intensity).toBe(0);
      }
    });
  });

  describe('positive cases', () => {
    it('schedules each cascade map to render once at install (r185: a never-rendered castShadow map binds a non-depth fallback into the shadow sampler and drops every lit receiveShadow draw)', () => {
      const { cascades } = installPlugin();

      expect(cascades).toHaveLength(2);
      for (const light of cascades) {
        expect(light.castShadow).toBe(true);
        expect(light.shadow.needsUpdate).toBe(true); // the render-once guard
      }
    });
  });
});
