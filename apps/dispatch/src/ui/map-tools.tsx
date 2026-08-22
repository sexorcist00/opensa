/**
 * The operator's way around the map (201/7-03): search a place, fit the whole board, ride a unit, and keep
 * the views they come back to all shift.
 *
 * Everything here is a thin skin over the map handle — the camera owns the movement, this owns the words.
 * It never re-renders the map: the handle is called imperatively, exactly like the locate buttons in the
 * panels, and what comes back the other way (`following`) arrives through the readout the loop already
 * pushes four times a second.
 */
import { type ReactElement, useState } from 'react';

import type { Selection } from '../ops/types';
import type { DispatchHandle } from '../world/boot';
import type { SearchedPlace } from '../world/zones';

import { type Bookmark, readBookmarks, removeBookmark, saveBookmark } from '../map/bookmarks';
import { styles } from './styles';

export function MapTools({
  compact = false,
  following,
  handle,
  selection,
}: {
  /** Phone layout: the cluster keeps search and the two buttons, and drops the saved-view row. */
  compact?: boolean;
  /** Whether the camera is currently riding a unit — read from the readout, never held here. */
  following: boolean;
  /** Null until the engine has booted; the cluster renders disabled rather than absent, so it does not
   *  appear under the operator's cursor a second after they started reaching for it. */
  handle: DispatchHandle | null;
  selection: Selection;
}): ReactElement {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<readonly SearchedPlace[]>([]);
  const [views, setViews] = useState<readonly Bookmark[]>(() => readBookmarks());
  /** The name being typed for a view about to be saved, or null when nothing is being saved. */
  const [naming, setNaming] = useState<null | string>(null);

  const unitSelected = selection?.kind === 'unit' ? selection.id : null;

  const search = (next: string): void => {
    setQuery(next);
    setHits(next.trim() === '' ? [] : (handle?.searchPlaces(next) ?? []));
  };
  const goTo = (place: SearchedPlace): void => {
    handle?.goToPlace(place);
    setQuery('');
    setHits([]);
  };
  // The pose is read when SAVE is pressed, not when the name box opened: an operator who nudges the map
  // while typing a name means the view they are looking at.
  const save = (): void => {
    const pose = handle?.pose();
    const name = naming?.trim() ?? '';
    if (pose && name !== '') {
      setViews(saveBookmark(name, pose));
    }
    setNaming(null);
  };

  return (
    <div style={styles.mapTools}>
      <input
        aria-label="Search places"
        onChange={(event) => search(event.target.value)}
        placeholder="Search a place"
        style={styles.mapToolsInput}
        value={query}
      />

      {hits.map((place) => (
        <button key={place.name} onClick={() => goTo(place)} style={styles.mapToolsHit} type="button">
          {place.name}
        </button>
      ))}

      <div style={{ display: 'flex', gap: 5 }}>
        <button
          disabled={handle === null}
          onClick={() => handle?.fitBoard()}
          style={styles.button}
          title="Put every active unit and call in frame"
          type="button"
        >
          Fit
        </button>
        <button
          disabled={handle === null || (unitSelected === null && !following)}
          onClick={() => handle?.follow(following ? null : unitSelected)}
          style={following ? styles.buttonPrimary : styles.button}
          title={following ? 'Stop riding the selected unit' : 'Ride the selected unit'}
          type="button"
        >
          {following ? 'Following' : 'Follow'}
        </button>
        {!compact && (
          <button
            disabled={handle === null}
            onClick={() => setNaming(naming === null ? `View ${views.length + 1}` : null)}
            style={naming === null ? styles.button : styles.buttonPrimary}
            type="button"
          >
            Save view
          </button>
        )}
      </div>

      {naming !== null && (
        <input
          aria-label="Name this view"
          autoFocus
          onBlur={save}
          onChange={(event) => setNaming(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              save();
            } else if (event.key === 'Escape') {
              setNaming(null);
            }
          }}
          style={styles.mapToolsInput}
          value={naming}
        />
      )}

      {!compact &&
        views.map((view) => (
          <div key={view.name} style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={() => handle?.recallView(view.pose)}
              style={styles.mapToolsHit}
              title="Fly back to this view"
              type="button"
            >
              {view.name}
            </button>
            <button
              onClick={() => setViews(removeBookmark(view.name))}
              style={{ ...styles.mapToolsHit, width: 'auto' }}
              title={`Forget "${view.name}"`}
              type="button"
            >
              ×
            </button>
          </div>
        ))}
    </div>
  );
}
