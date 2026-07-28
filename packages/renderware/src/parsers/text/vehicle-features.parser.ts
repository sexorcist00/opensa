/**
 * `data/vehicle-features.txt` — an OpenSA data file, not one of SA's.
 *
 * Vehicle mods ship a `features.txt` declaring what their model can do beyond geometry (the Modloader/IVF
 * convention). `vehicle-installer` copies each mod's declaration into this table as `<model> <FEATURE>…`,
 * and the CONVERTER reads it while baking that car — which is why the file exists at all: the mod folder is
 * long gone by the time a `.osm` is built. It is a BUILD-time input; nothing reads it at runtime, and a
 * declaration a car misses here can never be recovered later, which is why an unconverted car is refused
 * at spawn rather than parsed from its DFF.
 */

/** Retractable ("pop-up") headlights, spelled the way IVF and mod authors spell it. */
export const UP_DOWN_LIGHTS = 'UP/DOWN_LIGHTS';

/** Parse the table: model (lowercased) → its declared features (uppercased). `#` starts a comment. */
export function parseVehicleFeatures(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const line of text.split(/\r?\n/)) {
    const body = line.split('#')[0].trim();
    if (body === '') {
      continue;
    }
    const [model, ...tokens] = body.split(/[\s,;]+/);
    if (model && tokens.length > 0) {
      out.set(
        model.toLowerCase(),
        tokens.map((token) => token.toUpperCase()),
      );
    }
  }

  return out;
}
