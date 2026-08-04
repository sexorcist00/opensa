/** Shift header: identity, the clock that drives the world's lighting, and the desk's dispatch mode. */
import type { ReactElement } from 'react';

import { COLORS, styles } from './styles';

export function TopBar({
  autoDispatch,
  hour,
  latest,
  onAutoDispatch,
  onHour,
}: {
  autoDispatch: boolean;
  hour: number;
  latest: string | undefined;
  onAutoDispatch: (enabled: boolean) => void;
  onHour: (hour: number) => void;
}): ReactElement {
  return (
    <div style={styles.topBar}>
      <strong style={{ letterSpacing: 1.5 }}>OPENSA · DISPATCH</strong>
      <span style={{ ...styles.badge, background: '#0e3a52', color: COLORS.accent }}>SAN ANDREAS</span>

      <label style={{ alignItems: 'center', display: 'flex', gap: 6, marginLeft: 12 }}>
        <span style={{ color: COLORS.muted }}>Time</span>
        <input
          max={24}
          min={0}
          onChange={(event) => onHour(Number(event.target.value))}
          step={0.25}
          style={{ width: 150 }}
          type="range"
          value={hour}
        />
        <span style={{ ...styles.mono, width: 42 }}>{clock(hour)}</span>
      </label>

      <label style={{ alignItems: 'center', display: 'flex', gap: 6 }}>
        <input checked={autoDispatch} onChange={(event) => onAutoDispatch(event.target.checked)} type="checkbox" />
        <span>Auto-dispatch</span>
      </label>

      <span style={{ color: COLORS.muted, marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {latest ?? ''}
      </span>
    </div>
  );
}

function clock(hour: number): string {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60);

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
