import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      // Project-wide logic coverage (.ts). The .tsx UI is R3F/DOM glue, integration-tested in-browser, not here.
      exclude: [
        // --- Not logic (never counted anywhere) ---
        'apps/web/**/*.test.ts',
        'apps/web/**/index.ts',
        'apps/web/**/*.interface.ts',
        'packages/**/*.test.ts',
        'packages/**/index.ts',
        'packages/**/*.interface.ts',
        'packages/renderware/src/test-utils.ts',
        'packages/engine/src/test/**', // the fake GPUDevice — test infrastructure, not product code (plan 077)
        'apps/web/src/standalone/**', // dev-only viewer entry scripts

        // === COVERED BY THE PLAYWRIGHT E2E LANE (not by headless node units) ===
        // GL / DOM / app-loop glue: WebGL + browser only, so it's verified in `e2e/` (docs/development/e2e.md),
        // not here. RULE: anything excluded below MUST have e2e coverage on the Playwright lane — if you add a
        // file here, add/extend a spec in `e2e/` to exercise it. (See memory: gl-dom-coverage-exclusion.)
        'packages/game/src/input/keyboard/keyboard.ts', // DOM keyboard listeners
        'apps/web/src/ui/**', // DOM/style helpers (locations, debug-styles, hud font loading)
        'apps/web/src/asset-loader/asset-loader.ts', // fetch streaming + Cache Storage orchestration (e2e: asset-loader.spec.ts)
        'apps/web/src/asset-loader/cache-store.ts', // Cache Storage API wrapper (e2e: asset-loader.spec.ts)
      ],
      include: ['apps/web/**/*.ts', 'packages/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      // Floors (a small buffer below the achieved 88.8% stmt / 78.4% branch / 87.2% func / 88.8% lines) so an
      // unrelated change can't silently erode coverage. Branches sit lower by nature (error/edge paths).
      thresholds: { branches: 77, functions: 85, lines: 85, statements: 85 },
    },
    environment: 'node',
    globals: false,
    include: [
      'apps/web/**/*.test.ts',
      'packages/**/*.test.ts',
      'tools/opensa-pack/**/*.test.ts',
      'tools/timecyc-builder/**/*.test.ts',
      'scripts/**/*.test.ts',
      'tools/map-optimizer/**/*.test.ts',
      'tools/opensa-lod-generator/**/*.test.ts',
      'tools/vehicle-optimizer/**/*.test.ts',
      'tools/tool-kit/**/*.test.ts',
      'tools/rw-codec/**/*.test.ts',
      'tools/lod-trees-generator/**/*.test.ts',
      'tools/map-placement/**/*.test.ts',
      'tools/lod-common/**/*.test.ts',
      'tools/sa-lod-generator/**/*.test.ts',
      'tools/lod-procobj-generator/**/*.test.ts',
      'tools/mod-installer/**/*.test.ts',
      'tools/vehicle-installer/**/*.test.ts',
      'tools/ped-installer/**/*.test.ts',
      'tools/perfect-map-builder/**/*.test.ts',
      'tools-debug/sa-int16-repro/**/*.test.ts',
      'asi/perfect-map/**/*.test.ts',
    ],
  },
});
