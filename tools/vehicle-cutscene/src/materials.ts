/**
 * Carcols paint + lamp-marker bake (plan 002 step 5; plan 004 round for BCESAR4). The cutscene system
 * never applies carcols, so the Kam's/ZModeler paint MARKER colours render raw (the gate-4 green/pink).
 * Vanilla cs models ship their paint baked into the material colours; this pass does the same: every
 * paint-marker material gets the model's first carcols combo, alpha preserved. LAMP markers (the four
 * per-lamp ID colours on `vehiclelights*` materials) are engine metadata the gameplay renderer swaps out
 * per frame — the cutscene renderer swaps nothing, so they render raw too (BCESAR4's green/amber lenses).
 * Vanilla cs models bake them to WHITE with the authored alpha kept (measured across the fleet; the three
 * models that kept raw markers — csbobcat92/cslegend566/cssabre92 — are R* slips, not a rule), so this
 * pass does the same.
 *
 * The patch is surgical: material Struct colour bytes are rewritten IN PLACE on a copy of the DFF —
 * chunk sizes never change, everything else stays byte-identical.
 */
import type { VehicleColours } from '@opensa/renderware/parsers/text/carcols.parser';

import { readRw, RW_CLUMP, RW_GEOMETRY, RW_GEOMETRY_LIST, RW_STRUCT, type RwChunk } from '@opensa/rw-codec/chunk';

const RW_MATERIAL_LIST = 0x08;
const RW_MATERIAL = 0x07;

/** The model's four paint colours: primary, secondary, tertiary, quaternary. */
export type PaintColours = [Rgb, Rgb, Rgb, Rgb];

/** RGB triple (0–255). */
export type Rgb = [number, number, number];

/** Kam's/ZModeler carcols paint markers → paint slot 0..3 (mirrors `build-vehicle-model.ts`). */
const PAINT_MARKERS = new Map<string, number>([
  ['0,255,255', 2],
  ['60,255,0', 0],
  ['255,0,175', 1],
  ['255,255,0', 3],
]);

/** SA per-lamp ID colours (mirrors `build-vehicle-model.ts` LAMP_MARKERS): FL / FR / RL / RR. */
const LAMP_MARKERS = new Set<string>(['0,255,200', '185,255,0', '255,60,0', '255,175,0']);

/**
 * Replace every paint-marker material colour with the model's paint, alpha preserved. Returns the baked
 * copy + the number of materials touched. Throws when the model carries markers but `colours` is null
 * (no carcols row) — a marker the game would render raw is an error, not a silent green car.
 */
export function bakePaintMarkers(dff: Uint8Array, colours: null | PaintColours): { baked: number; bytes: Uint8Array } {
  const bytes = dff.slice();
  const clump = readRw(bytes).chunks.find((chunk) => chunk.type === RW_CLUMP);
  const geometryList = clump?.children?.find((chunk) => chunk.type === RW_GEOMETRY_LIST);
  let baked = 0;
  for (const geometry of geometryList?.children ?? []) {
    if (geometry.type === RW_GEOMETRY) {
      baked += bakeGeometry(geometry, colours);
    }
  }

  return { baked, bytes };
}

/**
 * The model's first carcols combo as four RGBs. `car` rows carry two colours; slots 3/4 fall back to
 * palette 0 (black) — the game zero-initialises the extra colours the same way. Returns null when the
 * model has no row at all.
 */
export function paintColoursFor(carcols: VehicleColours, model: string): null | PaintColours {
  const name = model.toLowerCase();
  const four = carcols.cars4.get(name)?.[0];
  const two = carcols.cars.get(name)?.[0];
  const combo = four ?? (two ? [two[0], two[1], 0, 0] : null);
  if (!combo) {
    return null;
  }
  const rgb = (index: number): Rgb => carcols.palette[index] ?? [0, 0, 0];

  return [rgb(combo[0]), rgb(combo[1]), rgb(combo[2]), rgb(combo[3])];
}

function bakeGeometry(geometry: RwChunk, colours: null | PaintColours): number {
  const materialList = geometry.children?.find((chunk) => chunk.type === RW_MATERIAL_LIST);
  if (!materialList?.data) {
    return 0;
  }
  let baked = 0;
  for (const material of readRw(materialList.data).chunks) {
    if (material.type !== RW_MATERIAL || !material.data) {
      continue;
    }
    const struct = readRw(material.data).chunks.find((chunk) => chunk.type === RW_STRUCT);
    if (!struct?.data || struct.data.length < 8) {
      continue;
    }
    const key = `${struct.data[4]},${struct.data[5]},${struct.data[6]}`;
    // In-place: `struct.data` is a view into the copied buffer; the alpha byte survives.
    if (LAMP_MARKERS.has(key)) {
      [struct.data[4], struct.data[5], struct.data[6]] = [255, 255, 255];
      baked += 1;
      continue;
    }
    const slot = PAINT_MARKERS.get(key);
    if (slot === undefined) {
      continue;
    }
    if (!colours) {
      throw new Error('model carries carcols paint markers but has no carcols row');
    }
    [struct.data[4], struct.data[5], struct.data[6]] = colours[slot];
    baked += 1;
  }

  return baked;
}
