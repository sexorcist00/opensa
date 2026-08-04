/**
 * The status bar reports the RENDERER, not the board: frame cost, what is resident, where the view is and
 * which pak build is being read. A field report that does not name its build is a field report nobody can
 * reproduce, so the build stamp is on screen rather than in a console line.
 */
import type { ReactElement } from 'react';

import type { DispatchReadout } from '../world/boot';

import { COLORS, styles } from './styles';

export function StatusBar({
  compact = false,
  readout,
}: {
  /** Phone layout: drop the gesture hint and the pak stamp — there is no room, and neither is actionable. */
  compact?: boolean;
  readout: DispatchReadout | null;
}): ReactElement {
  if (!readout) {
    return (
      <div style={styles.statusBar}>
        <span>booting engine · streaming world…</span>
      </div>
    );
  }
  const [x, y] = readout.pose.at;

  return (
    <div style={styles.statusBar}>
      <span style={{ color: readout.fps < 45 ? COLORS.danger : COLORS.accent }}>{readout.fps} fps</span>
      <span>
        cells {readout.cellsVisible}/{readout.cellsTotal}
      </span>
      <span>draws {readout.draws}</span>
      <span>resident {readout.residencyMb.toFixed(0)} MB</span>
      {readout.pending > 0 && <span>streaming {readout.pending}…</span>}
      {!compact && (
        <span>
          view {x.toFixed(0)}, {y.toFixed(0)} · {readout.pose.height.toFixed(0)} m
        </span>
      )}
      {!compact && <span style={{ marginLeft: 'auto' }}>pak {readout.buildTime}</span>}
      {!compact && <span>left-drag pan · right-drag orbit · wheel zoom · click select · right-click new call</span>}
    </div>
  );
}
