/**
 * Vehicle fixture CLI (plan 074/08 B2a → B5 step 2).
 *
 *   npx tsx tools/opensa-pack/src/vehicle-probe.ts --game game-src/non-modified --out apps/engine-lab/public/vehicle
 *     [--model landstal] [--wheel-scale 0.7]
 *
 * A THIN wrapper now: every piece of vehicle lore (wheel conventions, `_ok`/`_dam` twins, `_vlo` LOD,
 * `extraN` alternatives, door hinges, paint slots, lamp tags, the texture array) lives in the shared,
 * browser-callable builder `@opensa/renderware/vehicle/build-vehicle-model` — the game builds cars at SPAWN
 * time with the same code. This CLI only bakes the result into the lab's `vehicle.json` + `vehicle.bin`,
 * which spares the lab a DFF parser and a game VFS.
 *
 * Paint is NOT baked: vertices carry a paint SLOT and the engine resolves the colours per instance.
 */
import type { VehicleFixture } from '@opensa/renderware/vehicle/types';

import { parseDff } from '@opensa/renderware';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { openGameDir } from './game-fs';

function main(): void {
  const argValue = (flag: string): null | string => {
    const index = process.argv.indexOf(`--${flag}`);

    return index >= 0 ? (process.argv[index + 1] ?? null) : null;
  };
  const game = argValue('game') ?? 'game-src/non-modified';
  const out = argValue('out') ?? 'apps/engine-lab/public/vehicle';
  const model = (argValue('model') ?? 'landstal').toLowerCase();
  const scale = Number(argValue('wheel-scale') ?? 1) || 1;
  const wheelScale: [number, number] = [scale, scale];

  const fs = openGameDir(game);
  const dff = fs.get(`${model}.dff`);
  if (!dff) {
    throw new Error(`${model}.dff not found in ${game}`);
  }
  // `vehicle.txd` (the shared generic set) is a LOOSE file — game-fs keys loose entries by relative path.
  const txds = [`${model}.txd`, 'vehicle.txd', 'models/generic/vehicle.txd']
    .map((name) => fs.get(name))
    .filter((bytes): bytes is ArrayBuffer => bytes !== null && bytes !== undefined);

  const built = buildVehicleModel(parseDff(dff), new VehicleTextures(txds), { wheelScale });
  const { bin, fixture } = packFixture(model, built);

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'vehicle.json'), JSON.stringify(fixture));
  writeFileSync(join(out, 'vehicle.bin'), bin);
  const damaged = built.submeshes.filter((submesh) => submesh.kind === 'dam').length;
  const lod = built.submeshes.filter((submesh) => submesh.kind === 'lod').length;
  console.log(
    `[vehicle-probe] ${model}: ${fixture.vertexCount} verts, ${fixture.indexCount / 3} tris, ` +
      `${built.parts.length} parts (${built.wheels.length} wheels, ${built.doors.length} doors), ` +
      `${built.dummies.length} dummies, ${built.submeshes.length} submeshes (${damaged} dam, ${lod} lod), ` +
      `${built.texture.layers} texture layers @${built.texture.width}², ` +
      `bin ${(bin.byteLength / 1024).toFixed(0)} KB → ${out}`,
  );
}

/** Pack the built model into the lab's fixture pair (JSON header + one binary blob of typed sections). */
function packFixture(
  name: string,
  built: ReturnType<typeof buildVehicleModel>,
): { bin: Uint8Array; fixture: VehicleFixture } {
  const vertexCount = built.positions.length / 3;
  const align4 = (value: number): number => Math.ceil(value / 4) * 4;
  let at = 0;
  const reserve = (bytes: number): number => {
    const offset = at;
    at = align4(at + bytes);

    return offset;
  };
  const layout = { colors: 0, indices: 0, meta: 0, normals: 0, positions: 0, uvs: 0 };
  layout.positions = reserve(built.positions.byteLength);
  layout.normals = reserve(built.normals.byteLength);
  layout.uvs = reserve(built.uvs.byteLength);
  layout.colors = reserve(built.colors.byteLength);
  layout.meta = reserve(built.meta.byteLength);
  layout.indices = reserve(built.indices.byteLength);
  const textureOffset = reserve(built.texture.rgba.byteLength);

  const bin = new Uint8Array(at);
  bin.set(
    new Uint8Array(built.positions.buffer, built.positions.byteOffset, built.positions.byteLength),
    layout.positions,
  );
  bin.set(new Uint8Array(built.normals.buffer, built.normals.byteOffset, built.normals.byteLength), layout.normals);
  bin.set(new Uint8Array(built.uvs.buffer, built.uvs.byteOffset, built.uvs.byteLength), layout.uvs);
  bin.set(built.colors, layout.colors);
  bin.set(built.meta, layout.meta);
  bin.set(new Uint8Array(built.indices.buffer, built.indices.byteOffset, built.indices.byteLength), layout.indices);
  bin.set(built.texture.rgba, textureOffset);

  return {
    bin,
    fixture: {
      doors: [...built.doors],
      dummies: [...built.dummies],
      indexCount: built.indices.length,
      layout,
      name,
      parts: [...built.parts],
      submeshes: [...built.submeshes],
      textures: {
        height: built.texture.height,
        names: built.texture.names,
        offset: textureOffset,
        width: built.texture.width,
      },
      vertexCount,
      wheels: [...built.wheels],
    },
  };
}

main();
