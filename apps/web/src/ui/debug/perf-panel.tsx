import type { ToneMappingModeName } from '@opensa/game/interfaces/config.interface';
import type { PerfStats } from '@opensa/game/perf/perf-monitor';

import { type ReactElement, useEffect, useState } from 'react';

import { styles } from './debug-styles';

/** The slice of DebugActions the perf panel reads (kept narrow so the panel is reusable/testable). */
export interface PerfPanelActions {
  gpuTimings: () => readonly (readonly [string, number])[];
  perfStats: () => null | PerfStats;
  setPerfEnabled: (enabled: boolean) => void;
}

/** The Graphics-screen master-switch row (plan 063) — extracted so DebugOverlay stays under its complexity cap. */
export function PipelineToggle({
  onChange,
  pipeline,
  setPipeline,
}: {
  onChange: (pipeline: 'classic' | 'modern') => void;
  pipeline: 'classic' | 'modern';
  setPipeline: (pipeline: 'classic' | 'modern') => void;
}): ReactElement {
  const modern = pipeline === 'modern';

  return (
    <label style={styles.label}>
      <input
        checked={modern}
        onChange={() => {
          const next = modern ? 'classic' : 'modern';
          setPipeline(next);
          onChange(next);
        }}
        style={styles.radio}
        type="checkbox"
      />
      <span style={modern ? styles.optionActive : styles.option}>
        Modern pipeline (plan 063 — no visual change yet)
      </span>
    </label>
  );
}

/** The plan-067 sky-model switch (Graphics screen) — extracted to keep DebugOverlay under its complexity cap. */
export function SkyModelToggle({
  model,
  onChange,
  setModel,
}: {
  model: 'classic' | 'pbr';
  onChange: (model: 'classic' | 'pbr') => void;
  setModel: (model: 'classic' | 'pbr') => void;
}): ReactElement {
  const pbr = model === 'pbr';

  return (
    <label style={styles.label}>
      <input
        checked={pbr}
        onChange={() => {
          const next = pbr ? 'classic' : 'pbr';
          setModel(next);
          onChange(next);
        }}
        style={styles.radio}
        type="checkbox"
      />
      <span style={pbr ? styles.optionActive : styles.option}>PBR sky (plan 067 — Preetham)</span>
    </label>
  );
}

/** The plan-063 colour-spike selector (Graphics screen): where tone mapping runs, live-switchable for A/B. */
export function ToneMappingModeSelector({
  mode,
  onChange,
  setMode,
}: {
  mode: ToneMappingModeName;
  onChange: (mode: ToneMappingModeName) => void;
  setMode: (mode: ToneMappingModeName) => void;
}): ReactElement {
  const options: readonly { label: string; value: ToneMappingModeName }[] = [
    { label: 'ACES (current)', value: 'aces' },
    { label: 'AgX', value: 'agx' },
    { label: 'Neutral (Khronos)', value: 'neutral' },
    { label: 'None (raw)', value: 'none' },
  ];

  return (
    <div style={styles.group}>
      <div style={styles.groupLabel}>TONE MAPPING (063 colour spike)</div>
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => {
            setMode(option.value);
            onChange(option.value);
          }}
          style={styles.actionButton}
          type="button"
        >
          {mode === option.value ? '● ' : ''}
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** HUD refresh cadence — 4 Hz is readable without spamming React renders. */
const POLL_MS = 250;

/**
 * Perf HUD (plan 063): rolling frame stats + `renderer.info` + GPU pass timings. Sampling is enabled only
 * while this panel is mounted — the monitor costs nothing when the HUD is closed.
 */
export function PerfPanel({ actions }: { actions: PerfPanelActions }): ReactElement {
  const [stats, setStats] = useState<null | PerfStats>(null);
  const [gpu, setGpu] = useState<readonly (readonly [string, number])[]>([]);

  useEffect(() => {
    actions.setPerfEnabled(true);
    const timer = window.setInterval(() => {
      setStats(actions.perfStats());
      setGpu(actions.gpuTimings());
    }, POLL_MS);

    return (): void => {
      window.clearInterval(timer);
      actions.setPerfEnabled(false);
    };
  }, [actions]);

  if (!stats) {
    return <div style={styles.group}>collecting…</div>;
  }

  const rows: [string, string][] = [
    ['FPS', stats.fps.toFixed(0)],
    ['frame avg', `${stats.avgMs.toFixed(2)} ms`],
    ['frame p95', `${stats.p95Ms.toFixed(2)} ms`],
    ['draw calls', String(stats.drawCalls)],
    ['triangles', stats.triangles.toLocaleString('en-US')],
    ['programs', String(stats.programs)],
    ['geometries', String(stats.geometries)],
    ['textures', String(stats.textures)],
    ...gpu.map(([label, ms]): [string, string] => [`gpu ${label}`, `${ms.toFixed(2)} ms`]),
  ];

  return (
    <div style={styles.group}>
      <div style={styles.groupLabel}>PERF</div>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{label}</span>
          <span>{value}</span>
        </div>
      ))}
    </div>
  );
}
