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
      {/* 201/4-01: at rest the console draws nothing, and says so rather than showing a frame rate it is
          not paying for. The numbers beside it are the last drawn frame's, which is what it still has. */}
      {readout.idle ? (
        <span style={{ color: COLORS.muted }} title="Nothing has changed — no frames are being drawn">
          idle
        </span>
      ) : (
        <span style={{ color: readout.fps < 45 ? COLORS.danger : COLORS.accent }}>{readout.fps} fps</span>
      )}
      <span>
        cells {readout.cellsVisible}/{readout.cellsTotal}
      </span>
      <span>draws {readout.draws}</span>
      <span>resident {readout.residencyMb.toFixed(0)} MB</span>
      {readout.pending > 0 && <span>streaming {readout.pending}…</span>}
      {/* 201/6-02: the flat map says which pyramid level it is drawing, or why it is drawing none — an empty
          2D map that is silent about it is indistinguishable from one that is still loading. */}
      {readout.tiles !== undefined && (
        // The pyramid's state can be a whole sentence when it is an error, and this bar is 22 px of a phone:
        // it ellipsizes rather than running off the end of a row that cannot scroll.
        <span style={styles.statusEllipsis} title={readout.tiles}>
          {readout.tiles}
        </span>
      )}
      {/* 201/3-03: what the decluttering dropped. Every symbol is on screen — these are the NAMES that
          did not fit, and an operator who cannot see the count would read a crowded map as a complete one. */}
      {readout.namesHidden > 0 && <span title="Labels the map could not fit">{readout.namesHidden} names hidden</span>}
      {!compact && (
        <span>
          view {x.toFixed(0)}, {y.toFixed(0)} · {readout.pose.height.toFixed(0)} m
        </span>
      )}
      {!compact && <span style={{ marginLeft: 'auto' }}>pak {readout.buildTime}</span>}
      {!compact && (
        <span style={styles.statusEllipsis}>
          left-drag pan · right-drag orbit · wheel zoom · click select · right-click new call
        </span>
      )}
    </div>
  );
}
