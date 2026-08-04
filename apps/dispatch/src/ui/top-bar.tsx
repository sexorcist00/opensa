/** Shift header: identity, the clock that drives the world's lighting, and the desk's dispatch mode. */
import type { ReactElement } from 'react';

import { COLORS, styles } from './styles';

export function TopBar({
  autoDispatch,
  compact = false,
  hour,
  latest,
  onAutoDispatch,
  onHour,
}: {
  autoDispatch: boolean;
  /** Phone layout: shorten the title, drop the region badge and the log ticker, narrow the time slider. */
  compact?: boolean;
  hour: number;
  latest: string | undefined;
  onAutoDispatch: (enabled: boolean) => void;
  onHour: (hour: number) => void;
}): ReactElement {
  return (
    <div style={styles.topBar}>
      <strong style={{ letterSpacing: 1.5 }}>{compact ? 'DISPATCH' : 'OPENSA · DISPATCH'}</strong>
      {!compact && <span style={{ ...styles.badge, background: '#0e3a52', color: COLORS.accent }}>SAN ANDREAS</span>}

      <label style={{ alignItems: 'center', display: 'flex', gap: 6, marginLeft: compact ? 0 : 12 }}>
        {!compact && <span style={{ color: COLORS.muted }}>Time</span>}
        <input
          max={24}
          min={0}
          onChange={(event) => onHour(Number(event.target.value))}
          step={0.25}
          style={{ width: compact ? 84 : 150 }}
          type="range"
          value={hour}
        />
        <span style={{ ...styles.mono, width: 42 }}>{clock(hour)}</span>
      </label>

      <label style={{ alignItems: 'center', display: 'flex', gap: 6, marginLeft: compact ? 'auto' : 0 }}>
        <input checked={autoDispatch} onChange={(event) => onAutoDispatch(event.target.checked)} type="checkbox" />
        <span>{compact ? 'Auto' : 'Auto-dispatch'}</span>
      </label>

      {!compact && (
        <span style={{ color: COLORS.muted, marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {latest ?? ''}
        </span>
      )}
    </div>
  );
}

function clock(hour: number): string {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60);

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
