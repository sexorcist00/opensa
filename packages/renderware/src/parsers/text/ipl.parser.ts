import type { IplAudioZone, IplInstance } from './types';

import { cleanLines, sectionedParse } from './text-lines';

/**
 * Parse an IPL (item placement) file into its placed instances.
 *
 * Reads the `inst` section: `id, model, interior, posX, posY, posZ, rotX, rotY,
 * rotZ, rotW, lod` (11 columns). Other sections (`cull`, `path`, `grge`, `enex`,
 * `pick`, `jump`, `tcyc`, `mult`) are out of scope and ignored — except `auzo`,
 * which {@link parseIplAudioZones} reads for the audio chain (203/1-03).
 */
export function parseIpl(text: string): IplInstance[] {
  const instances: IplInstance[] = [];

  sectionedParse(cleanLines(text), {
    inst: (row) => {
      const instance = parseInstRow(row);
      if (instance) {
        instances.push(instance);
      }
    },
  });

  return instances;
}

/**
 * Parse an IPL's `auzo` section — the AUDIO ZONES SA picks its ambience by (203/1-03).
 *
 * A separate pass rather than a second return value from {@link parseIpl}: every caller of that function
 * wants placed objects, and audio is a different consumer of the same file. Reading it twice costs a walk
 * over text already in memory and keeps a callers' signature that nothing needs to change.
 *
 * **Two row shapes, told apart by their WIDTH**, exactly as the game does — it tries the nine-field form
 * first and falls back to the seven-field one (`CFileLoader::LoadAudioZone`):
 *
 * ```text
 * box     name id flags x1 y1 z1 x2 y2 z2
 * sphere  name id flags x  y  z  radius
 * ```
 *
 * A row of any other width, or one whose numbers do not parse, is DROPPED rather than guessed at: a zone
 * placed at `NaN` is a zone the listener can never be inside, which is a silence nobody could explain.
 */
export function parseIplAudioZones(text: string): IplAudioZone[] {
  const zones: IplAudioZone[] = [];

  sectionedParse(cleanLines(text), {
    auzo: (row) => {
      const zone = parseAudioZoneRow(row);
      if (zone) {
        zones.push(zone);
      }
    },
  });

  return zones;
}

function parseAudioZoneRow(cells: string[]): IplAudioZone | null {
  if (cells.length !== 7 && cells.length !== 9) {
    return null;
  }
  const [name, rawId, rawFlags, ...rest] = cells;
  const id = Number(rawId);
  const numbers = rest.map(Number);
  if (!name || Number.isNaN(id) || numbers.some(Number.isNaN)) {
    return null;
  }
  // `flags == 1` is what the game passes as `isActive`; anything else starts the zone switched off.
  const active = Number(rawFlags) === 1;

  if (cells.length === 9) {
    return {
      active,
      id,
      max: [numbers[3], numbers[4], numbers[5]],
      min: [numbers[0], numbers[1], numbers[2]],
      name,
      shape: 'box',
    };
  }

  return { active, centre: [numbers[0], numbers[1], numbers[2]], id, name, radius: numbers[3], shape: 'sphere' };
}

function parseInstRow(cells: string[]): IplInstance | null {
  if (cells.length < 11) {
    return null;
  }
  const id = Number(cells[0]);
  if (Number.isNaN(id)) {
    return null;
  }

  return {
    id,
    interior: Number(cells[2]),
    lod: Number(cells[10]),
    modelName: cells[1],
    position: [Number(cells[3]), Number(cells[4]), Number(cells[5])],
    rotation: [Number(cells[6]), Number(cells[7]), Number(cells[8]), Number(cells[9])],
  };
}
