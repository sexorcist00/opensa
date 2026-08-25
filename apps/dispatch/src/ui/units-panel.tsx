/** The roster: every unit on duty, its status and what it is committed to. */
import type { ReactElement } from 'react';

import { SET_COLORS } from '../map/beacons';
import { css } from '../map/overlay-2d';
import { type Incident, type Selection, type Unit } from '../ops/types';
import { COLORS, RAMP, styles } from './styles';

const KIND_LABEL: Readonly<Record<Unit['kind'], string>> = {
  ambulance: 'EMS',
  fire: 'FIRE',
  patrol: 'PD',
};

const STATUS_LABEL: Readonly<Record<Unit['status'], string>> = {
  available: 'AVAILABLE',
  busy: 'OUT OF SERVICE',
  enRoute: 'EN ROUTE',
  onScene: 'ON SCENE',
};

export function UnitsPanel({
  incidents,
  onLocate,
  onSelect,
  selection,
  units,
}: {
  incidents: readonly Incident[];
  onLocate: (unit: Unit) => void;
  onSelect: (selection: Selection) => void;
  selection: Selection;
  units: readonly Unit[];
}): ReactElement {
  const available = units.filter((unit) => unit.status === 'available').length;

  return (
    <div style={styles.panelRight}>
      <div style={styles.panelTitle}>
        Units · {available}/{units.length} free
      </div>
      <div style={styles.scroll}>
        {units.map((unit) => {
          const selected = selection?.kind === 'unit' && selection.id === unit.id;
          const incident = incidents.find((entry) => entry.id === unit.incident);

          return (
            <div
              key={unit.id}
              onClick={() => onSelect({ id: unit.id, kind: 'unit' })}
              onDoubleClick={() => onLocate(unit)}
              // A unit's rail carries its STATUS for the same reason a call's carries its priority: the
              // roster is scanned down the left edge, not read row by row.
              style={{
                ...styles.row,
                borderLeftColor: css(SET_COLORS[unit.status]),
                ...(selected ? styles.rowSelected : {}),
              }}
              title="Click to select · double-click to centre the map on it"
            >
              <div style={{ alignItems: 'center', display: 'flex', gap: 6 }}>
                <span style={{ background: css(SET_COLORS[unit.status]), borderRadius: 6, height: 8, width: 8 }} />
                <strong style={styles.mono}>{unit.callsign}</strong>
                <span
                  style={{ ...styles.badge, background: RAMP.surfaceHover, color: COLORS.muted, marginLeft: 'auto' }}
                >
                  {KIND_LABEL[unit.kind]}
                </span>
              </div>
              <div style={{ color: css(SET_COLORS[unit.status]), fontSize: 10 }}>{STATUS_LABEL[unit.status]}</div>
              {incident && (
                <div style={{ color: COLORS.muted, fontSize: 10 }}>
                  {incident.code} · {incident.place}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
