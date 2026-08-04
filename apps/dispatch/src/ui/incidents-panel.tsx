/** The call queue: open calls first, worst priority at the top — the order a dispatcher works them in. */
import type { ReactElement } from 'react';

import { SET_COLORS } from '../map/beacons';
import { css } from '../map/overlay-2d';
import { type Incident, type Selection } from '../ops/types';
import { COLORS, styles } from './styles';

const STATUS_LABEL: Readonly<Record<Incident['status'], string>> = {
  assigned: 'ASSIGNED',
  closed: 'CLEARED',
  onScene: 'ON SCENE',
  pending: 'PENDING',
};

export function IncidentsPanel({
  incidents,
  now,
  onLocate,
  onSelect,
  selection,
}: {
  incidents: readonly Incident[];
  now: number;
  onLocate: (incident: Incident) => void;
  onSelect: (selection: Selection) => void;
  selection: Selection;
}): ReactElement {
  const sorted = [...incidents].sort(byUrgency);

  return (
    <div style={styles.panel}>
      <div style={styles.panelTitle}>Calls · {incidents.filter((call) => call.status !== 'closed').length} open</div>
      <div style={styles.scroll}>
        {sorted.length === 0 && <div style={styles.empty}>No active calls</div>}
        {sorted.map((incident) => {
          const selected = selection?.kind === 'incident' && selection.id === incident.id;

          return (
            <div
              key={incident.id}
              onClick={() => onSelect({ id: incident.id, kind: 'incident' })}
              onDoubleClick={() => onLocate(incident)}
              style={{ ...styles.row, ...(selected ? styles.rowSelected : {}) }}
              title="Click to select · double-click to centre the map on it"
            >
              <div style={{ alignItems: 'center', display: 'flex', gap: 6 }}>
                <span
                  style={{
                    ...styles.badge,
                    background: css(SET_COLORS[`call${incident.priority}`], 0.18),
                    color: css(SET_COLORS[`call${incident.priority}`]),
                  }}
                >
                  P{incident.priority}
                </span>
                <strong style={styles.mono}>{incident.code}</strong>
                <span style={{ color: COLORS.muted, marginLeft: 'auto' }}>{age(now - incident.opened)}</span>
              </div>
              <div>{incident.title}</div>
              <div style={{ color: COLORS.muted, display: 'flex', gap: 8 }}>
                <span>{incident.place}</span>
                <span style={{ marginLeft: 'auto' }}>{STATUS_LABEL[incident.status]}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function age(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));

  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}`;
}

/** Open before closed, then by priority, then oldest first. */
function byUrgency(a: Incident, b: Incident): number {
  const closed = Number(a.status === 'closed') - Number(b.status === 'closed');

  return closed !== 0 ? closed : a.priority - b.priority || a.opened - b.opened;
}
