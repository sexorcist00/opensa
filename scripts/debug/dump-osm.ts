import { decodeOsm, decodeOsmTextures, osmSection, OsmSectionTag } from '@opensa/engine-formats';
import { openArchive } from '@opensa/renderware/archive/img-archive';
/**
 * Dump one converted model's `.osm` from a built pak: sections, DESC fixture (parts, submeshes with their
 * texture-array refs), and — for world-sourced models — whether the manifest still has those arrays.
 * Run: `npx tsx scripts/debug/dump-osm.ts <modelName> [--pak build/original/opensa]`.
 */
import { existsSync, readFileSync } from 'node:fs';

interface Fixture {
  parts: { name: string }[];
  submeshes: { array?: number; indexCount: number; part: number; translucent?: boolean }[];
  textureSource?: 'world';
  vertexCount: number;
}

function main(): void {
  const args = process.argv.slice(2);
  const pakFlag = args.indexOf('--pak');
  const pak = pakFlag === -1 ? 'build/original/opensa' : args[pakFlag + 1];
  const model = args
    .find((arg, index) => !arg.startsWith('--') && (pakFlag === -1 || index !== pakFlag + 1))
    ?.toLowerCase();
  if (!model) {
    console.error('usage: npx tsx scripts/debug/dump-osm.ts <modelName> [--pak build/original/opensa]');
    process.exit(1);
  }

  const archive = openArchive(new Uint8Array(readFileSync(`${pak}/models/gta3.img`)));
  const osm = archive.get(`${model}.osm`);
  if (!osm) {
    console.error(`${model}.osm is not in ${pak}/models/gta3.img`);
    process.exit(1);
  }

  const sections = decodeOsm(new Uint8Array(osm));
  const names = new Map(Object.entries(OsmSectionTag).map(([name, tag]) => [tag, name]));
  for (const [tag, bytes] of sections.sections) {
    console.log(`section ${names.get(tag) ?? tag}: ${bytes.byteLength} bytes`);
  }

  const desc = osmSection(sections, OsmSectionTag.DESC);
  if (!desc) {
    console.error('no DESC section');
    process.exit(1);
  }
  const fixture = JSON.parse(new TextDecoder().decode(desc)) as Fixture;
  console.log(`\ntextureSource: ${fixture.textureSource ?? '(own TEXS)'} · ${fixture.vertexCount} vertices`);
  console.log(`parts: ${fixture.parts.map((part) => part.name).join(', ')}`);
  for (const submesh of fixture.submeshes) {
    console.log(
      `submesh part=${fixture.parts[submesh.part]?.name ?? submesh.part} array=${submesh.array ?? 0} ` +
        `indices=${submesh.indexCount} translucent=${submesh.translucent ?? false}`,
    );
  }

  const texs = osmSection(sections, OsmSectionTag.TEXS);
  if (texs) {
    console.log(`\nown TEXS: ${decodeOsmTextures(texs).arrays.length} arrays`);
  }
  if (fixture.textureSource === 'world') {
    // Plan 086 phase 7: the pak manifest lives in the `<gameDir>-pack` sibling; legacy builds nest it.
    const manifestPath = existsSync(`${pak}-pack/manifest.json`)
      ? `${pak}-pack/manifest.json`
      : `${pak}/opensa/manifest.json`;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      textures: { format?: string; layers?: number; size?: number }[];
    };
    console.log(`\nmanifest has ${manifest.textures.length} world arrays; the model's refs:`);
    for (const array of new Set(fixture.submeshes.map((submesh) => submesh.array ?? 0))) {
      const info = manifest.textures[array];
      console.log(`array ${array}: ${info ? JSON.stringify(info) : 'MISSING FROM MANIFEST'}`);
    }
  }
}

main();
