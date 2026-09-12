/**
 * The AGPL §13 offer.
 *
 * This console is a MODIFIED version of OpenSA and it is served over a network, which is the exact case §13
 * names: the people who use it over that network are owed its Corresponding Source, and the repository being
 * public is not the same thing as the offer being made to them. So the offer is part of the running surface.
 *
 * It lives in the key sheet because that is where the console already answers *what is this* — a notice on a
 * surface nobody opens is a notice that was not made.
 */
import type { ReactElement } from 'react';

import { styles } from './styles';
import { useCoarsePointer } from './use-compact';

/**
 * Where this console's Corresponding Source lives.
 *
 * One place on purpose: §13 is about the source of THIS running version, so a second copy of this string is a
 * second thing that can drift out of date without anything failing.
 */
export const SOURCE_URL = 'https://github.com/sexorcist00/opensa';

export function SourceOffer(): ReactElement {
  const touch = useCoarsePointer();

  return (
    <div style={styles.sourceOffer}>
      A modified OpenSA, served under the AGPL-3.0.{' '}
      <a href={SOURCE_URL} rel="noreferrer" style={touch ? styles.sourceLinkTouch : styles.sourceLink} target="_blank">
        Source code
      </a>
    </div>
  );
}
