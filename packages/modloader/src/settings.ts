import { parseCarcols } from '@opensa/renderware/parsers/text/carcols.parser';
import { parseHandling } from '@opensa/renderware/parsers/text/handling.parser';
import { parseVehicleDefs } from '@opensa/renderware/parsers/text/vehicle-defs.parser';

/** The lines a vehicle's `*.settings.txt` may contribute, one per stock data file (any may be absent). */
export interface VehicleSettings {
  /** A `carcols.dat` `car`-section line (`model, p,s …`). */
  carcolsLine?: string;
  /** A `handling.cfg` car-table line (`ID  mass …`). */
  handlingLine?: string;
  /** A `vehicles.ide` `cars`-section line (`id, model, txd, type, handling, …`). */
  ideLine?: string;
}

/**
 * Parse a `*.settings.txt` (blank-line-separated blocks) into the three stock-file lines it carries. Each block is
 * classified by **structure** (comma vs space; numeric leading id) and **validated** with the real engine parser,
 * so an unrecognised block is silently dropped. Any of the three may be absent (→ the vehicle keeps stock data).
 */
export function parseVehicleSettings(text: string): VehicleSettings {
  const out: VehicleSettings = {};
  for (const block of text.split(/\r?\n\s*\n/)) {
    const line = block
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l !== '');
    if (!line) {
      continue;
    }
    const kind = classify(line);
    if (kind === 'ide') {
      out.ideLine = line;
    } else if (kind === 'handling') {
      out.handlingLine = line;
    } else if (kind === 'carcols') {
      out.carcolsLine = line;
    }
  }

  return out;
}

/** A handling car line is the id + ~33 columns — require many fields so prose isn't taken for handling. */
const MIN_HANDLING_FIELDS = 20;

/** Structural guess (comma + leading numeric id ⇒ ide; comma + name ⇒ carcols; else handling), then validate. */
function classify(line: string): 'carcols' | 'handling' | 'ide' | null {
  if (line.includes(',')) {
    const first = line.split(',')[0].trim();
    if (/^\d+$/.test(first)) {
      return parseVehicleDefs(`cars\n${line}\nend`).size > 0 ? 'ide' : null;
    }

    // A real carcols line has NUMERIC palette-index pairs. A comma line whose values are part NAMES — the
    // modloader tuning/extras list (`model, nto_b_l, nto_b_s, …`) — parses to NaN combos; it must NOT be taken
    // as carcols (else it overrides the real paint line and every spawn goes white).
    const combos = parseCarcols(`car\n${line}\nend`).cars.get(first.toLowerCase()) ?? [];

    return combos.some((combo) => combo.every(Number.isFinite)) ? 'carcols' : null;
  }
  if (line.split(/\s+/).length < MIN_HANDLING_FIELDS) {
    return null; // too few columns to be a handling line (e.g. stray prose)
  }

  return parseHandling(line).size > 0 ? 'handling' : null;
}
