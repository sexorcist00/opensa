import { buildVer2Buffer, type ImgArchive, openArchive } from '@opensa/renderware/archive/img-archive';
import { convertTo24h, parseTimecyc, stringifyTimecyc } from '@opensa/renderware/parsers/text/timecyc.parser';
/**
 * Reconstruct the real-asset test fixtures (`tests/original/`) from a clean, UNMODIFIED GTA San Andreas
 * install under `game-src/original` (default). These are Rockstar assets, so they are NOT committed
 * (`tests/original/` is gitignored) — every contributor regenerates them locally on setup, or after
 * changing the manifest:
 *
 *   npm run test:fixtures
 *
 * Custom, non-Rockstar fixtures live in `tests/custom/` and ARE committed — this script never touches them.
 *
 * Each fixture declares how it is produced:
 *   - copy:    copied verbatim from `game-src/<game>/<from>`
 *   - extract: extracted by name from a `models/*.img` archive
 *   - archive: a one-file stock VER2 `.img` built around an extracted entry
 *   - mod:     copied from `mods-src/original/mods/<from>` — opensa-pack's production input is a MODDED game, and
 *              the mods carry things the stock game barely has (95 % of their textures ship a mip chain)
 *
 * Extend MANIFEST when a test needs a new real-asset fixture, or MOD_MANIFEST when it needs a modded one.
 *
 * `data/timecyc_24h.dat` is generated here (the stock 24h expansion of timecyc.dat, no mod overlay).
 * Curated / version-pinned test models that can't be reproduced from a stock copy live committed under
 * `tests/custom/proper-fixes-models/` instead.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

type Fixture =
  | { readonly dest: string; readonly entry: string; readonly type: 'archive' }
  | { readonly dest: string; readonly entry: string; readonly type: 'extract' }
  | { readonly dest: string; readonly from: string; readonly type: 'copy' }
  /** Copied from `mods-src/`, not from the game dir — see {@link MOD_MANIFEST}. */
  | { readonly dest: string; readonly from: string; readonly type: 'mod' };

const gameIndex = process.argv.indexOf('--game');
const GAME = gameIndex >= 0 ? process.argv[gameIndex + 1] : 'original';
const ROOT = join('game-src', GAME);
const ARCHIVES = ['models/gta3.img', 'models/gta_int.img'];
const OUT = 'tests/original';

const copy = (from: string, dest: string): Fixture => ({ dest: `${OUT}/${dest}`, from, type: 'copy' });
const modFile = (from: string, dest: string): Fixture => ({ dest: `${OUT}/${dest}`, from, type: 'mod' });
const extract = (entry: string, dest: string): Fixture => ({ dest: `${OUT}/${dest}`, entry, type: 'extract' });

/**
 * Assets copied from `mods-src/original/mods` rather than the game dir.
 *
 * opensa-pack's PRODUCTION input is not a stock game: mod-installer bakes these mods into the archives
 * before it runs. They also carry things the stock game barely has — 95 % of their textures ship a mip
 * chain (up to 12 levels, 2048 px) — so "the converted dictionary preserves the chain" can only be tested
 * against one of them.
 */
const MOD_MANIFEST: readonly Fixture[] = [
  // A Chinatown building + its dictionary: 19 material textures, several 512² DXT1 with 10 mip levels.
  modFile('17. Chinatown Project v2 + Chinese Lamps/gta3_img/chinatown_sfe1.dff', 'mods/chinatown_sfe1.dff'),
  modFile('17. Chinatown Project v2 + Chinese Lamps/gta3_img/chinatownsfe.txd', 'mods/chinatownsfe.txd'),
];

const MANIFEST: readonly Fixture[] = [
  // --- Loose data / config / text files (copied verbatim) ---
  copy('data/gta.dat', 'data/gta.dat'),
  copy('data/object.dat', 'data/object.dat'),
  copy('data/procobj.dat', 'data/procobj.dat'),
  copy('data/surfinfo.dat', 'data/surfinfo.dat'),
  copy('data/surface.dat', 'data/surface.dat'), // the 6×6 adhesion matrix surfinfo's groups index (081/10)
  copy('data/timecyc.dat', 'data/timecyc.dat'),
  copy('data/carcols.dat', 'data/carcols.dat'),
  copy('data/carmods.dat', 'data/carmods.dat'),
  copy('data/cargrp.dat', 'data/cargrp.dat'),
  copy('data/popcycle.dat', 'data/popcycle.dat'),
  copy('parked.json', 'parked.json'),
  copy('data/water.dat', 'data/water.dat'),
  copy('data/vehicles.ide', 'data/vehicles.ide'),
  copy('data/peds.ide', 'data/peds.ide'),
  copy('data/handling.cfg', 'data/handling.cfg'),
  copy('data/info.zon', 'data/info.zon'),
  copy('data/maps/generic/barriers.ide', 'data/barriers.ide'),
  copy('data/maps/interior/int_cont.ipl', 'data/int_cont.ipl'),
  copy('models/effects.fxp', 'models/effects.fxp'),
  copy('models/effectsPC.txd', 'models/effectsPC.txd'),
  copy('text/american.gxt', 'text/american.gxt'),
  // Player character + a second ped, both stock SA peds regenerated from gta3.img (no custom character model
  // is committed): bmypol1 (a cop — the player model the character tests use) + its txd, and army (skeleton
  // frames in a different order than the HAnim hierarchy — the plan 052 ordering guard).
  extract('bmypol1.dff', 'character/bmypol1.dff'),
  extract('bmypol1.txd', 'character/bmypol1.txd'),
  extract('army.dff', 'character/army.dff'),

  // --- Entries extracted from the IMG archives ---
  extract('barriers.col', 'col/barriers.col'),
  extract('countn2_17.col', 'col/countn2_17.col'),
  extract('lae_stream0.ipl', 'ipl_binary/lae_stream0.ipl'),
  // Map-strip fixtures (lod-trees-generator): a text IPL + its companion binary stream share one LOD-index space
  // — a stream's `lod` indexes into its area's text IPL. `lae` is a coupled urban pair (the text has its own
  // internal HD→LOD links AND `lae_stream0` HDs point into it); `countrye` is the canonical countryside case
  // where the text holds tree LOD bigbuildings (`lod_vbg_fir_co`, all `lod -1`) referenced from `countrye_stream1`.
  copy('data/maps/la/lae.ipl', 'ipl_text/lae.ipl'),
  copy('data/maps/country/countrye.ipl', 'ipl_text/countrye.ipl'),
  extract('countrye_stream1.ipl', 'ipl_binary/countrye_stream1.ipl'),
  extract('counxref.ifp', 'dff/anim-clump/counxref.ifp'),
  extract('nt_noddonkbase.dff', 'dff/anim-clump/nt_noddonkbase.dff'),
  // The opensa-pack `.osm` conversion tests (plan 003 phase 5) run on REAL models, one per asset class, each
  // with the TXD its IDE row names — a converted model must lose nothing against the DFF/TXD build, and a
  // hand-built clump cannot prove that.
  extract('des_xoilfield.txd', 'dff/anim-clump/des_xoilfield.txd'), // nt_noddonkbase's dictionary
  extract('lamppost1.dff', 'dff/topple/lamppost1.dff'), // object.dat uprootLimit 240 — the topple prop
  extract('dynsigns.txd', 'dff/topple/dynsigns.txd'),
  extract('labins01_la.txd', 'dff/breakable/labins01_la.txd'), // binnt08_la's dictionary
  extract('sjmcacti2.dff', 'dff/clutter/sjmcacti2.dff'), // a procobj.dat species (and a topple prop)
  extract('gta_cactus.txd', 'dff/clutter/gta_cactus.txd'),
  extract('binnt08_la.dff', 'dff/breakable/binnt08_la.dff'),
  extract('washer.dff', 'dff/building/washer.dff'),
  // Stock SA ships 11 EMPTY TXDs — a valid dictionary chunk in one 2 048-byte sector with nothing inside.
  // `mine` is the awkward one: its material NAMES a texture the empty dictionary cannot supply.
  extract('mine.dff', 'dff/empty-txd/mine.dff'),
  extract('mine.txd', 'dff/empty-txd/mine.txd'),
  // A stock vegetation LOD DFF — the template the lod-trees-generator rebuilds card geometry over. Carries the
  // tristrip flag + an extra-vertex-colour (0x253f2f9) extension, both of which the encoder must scrub (else SA
  // renders the impostor as nothing).
  extract('lodroadscoast02.dff', 'dff/lod-template/lodroadscoast02.dff'),
  extract('esc_step.dff', 'dff/escalator/esc_step.dff'),
  extract('escl_la.dff', 'dff/escalator/escl_la.dff'),
  // The SF fountain (IDE 9833, txd fountain_sfw): a stock model carrying THREE 2dfx type-1 particle anchors
  // (`water_fountain`) — the converter's only real-asset case for welding emitters into a cell (074/06 row 13).
  extract('fountain_sfw.dff', 'dff/particles/fountain_sfw.dff'),
  extract('fountain_sfw.txd', 'dff/particles/fountain_sfw.txd'),
  extract('ws_floodbeams.dff', 'dff/floodbeams/ws_floodbeams.dff'),
  extract('ce_grndpalcst05.dff', 'dff/frame-offset-ignored/ce_grndpalcst05.dff'),
  extract('skullpillar01_lvs.dff', 'dff/particle/skullpillar01_lvs.dff'),
  // A refinery chimney carrying BOTH a 2dfx particle emitter (smoke) AND light coronas — the `stripParticleEffects`
  // fixture (drops the smoke, keeps the coronas). Also has day + night vertex colours.
  extract('refchimny01.dff', 'dff/particle/refchimny01.dff'),
  // A stock HD tree with day + night vertex colours — the night-tint fixtures (lod-trees `computeNightTint` and the
  // lod-procobj mesh night-colour carry).
  extract('cedar1_hi.dff', 'dff/night-colours/cedar1_hi.dff'),
  // The LV strip's neon-rope palm (vegaxref 3509): the rope's night set is saturated red (255/49/49) over a
  // flat grey day (81/81/81) — Rec709 luma reads it DARKER than day, the case that broke the luma-delta
  // emissive rule (the rope never glowed; map-object round 2026-07-22).
  extract('vgsn_nitree_r01.dff', 'dff/night-colours/vgsn_nitree_r01.dff'),
  extract('vgsn_nitree.txd', 'dff/night-colours/vgsn_nitree.txd'),
  extract('dyntraffic.txd', 'dff/trafficlight-backface-culling/dyntraffic.txd'),
  extract('admiral.dff', 'dff/vehicle/admiral.dff'),
  extract('squalo.dff', 'dff/vehicle/squalo.dff'),
  // infernus: the vehicle-optimizer scale test fixture — a hierarchical rig (dummies) + embedded COL3 collision.
  extract('infernus.dff', 'dff/vehicle/infernus.dff'),
  extract('admiral.dff', 'vehicles/admiral.dff'),
  // zr350: the ONE stock car with a pop-up headlight pod (`misc_a` holding head-lamp faces) — the
  // real-asset guard for the retractable-headlight derivation.
  extract('zr350.dff', 'vehicles/zr350.dff'),
  extract('zr350.txd', 'vehicles/zr350.txd'),
  // A SECOND car, so a modloader test can prove the mod's GEOMETRY won rather than just its texture kind.
  extract('cheetah.dff', 'vehicles/cheetah.dff'),
  extract('cheetah.txd', 'vehicles/cheetah.txd'),
  // the world-adapter integration test's vehicle pair + the loose generic vehicle dictionary
  extract('admiral.txd', 'vehicles/admiral.txd'),
  copy('models/generic/vehicle.txd', 'models/generic/vehicle.txd'),
  extract('junk.txd', 'txd/junk.txd'),
  extract('compfukhouse3.dff', 'world/compfukhouse3.dff'),
  extract('mcstraps_LAe2.dff', 'world/mcstraps_LAe2.dff'),
  // Two co-located San Fierro crack-factory shells that share boundary geometry — the map-optimizer seam-weld
  // (plan 016) real-asset pair: a genuine cross-model prelit seam (~455 boundary groups, differing prelit).
  extract('cf_ext_dem_sfs.dff', 'world/cf_ext_dem_sfs.dff'),
  extract('crackfact_sfs.dff', 'world/crackfact_sfs.dff'),
  // A Vegas road ramp meeting a junction slab — the map-optimizer gap-stitch (plan 017, retired) real-asset
  // pair: their boundaries meet at a few points (variant A) then diverge, a genuine cross-model geometry seam.
  extract('vegassroad0522a.dff', 'world/vegassroad0522a.dff'),
  extract('vgssspagjun08.dff', 'world/vgssspagjun08.dff'),
  // SF Chinatown victorian whose night set is dark at the median (~19) with the window glow in the p95 tail —
  // the map-optimizer prelight (plan 019) "tail glow" class that motivated only-mode `nightMax` (capNightSet).
  extract('newvic1_sfw.dff', 'world/newvic1_sfw.dff'),

  // --- Scoped texture resolution (lod-common plan 004): a bush whose texture NAME (`newtreeleaves128`)
  // exists in many TXDs with different pixels — its def TXD (badlands, vegepart.ide) vs the flat-index
  // first-wins winner (gta_proc_bush). ---
  extract('sm_bush_large_1.dff', 'world/sm_bush_large_1.dff'),
  extract('badlands.txd', 'txd/badlands.txd'),
  extract('gta_proc_bush.txd', 'txd/gta_proc_bush.txd'),

  // --- Derived: a stock VER2 archive holding a single extracted vehicle ---
  { dest: `${OUT}/img/admiral.img`, entry: 'admiral.dff', type: 'archive' },
];

let archives: ImgArchive[] | null = null;

function extractEntry(name: string): null | Uint8Array {
  for (const archive of openArchives()) {
    const data = archive.get(name);
    if (data) {
      return new Uint8Array(data);
    }
  }

  return null;
}

function openArchives(): ImgArchive[] {
  archives ??= ARCHIVES.map((rel) => openArchive(new Uint8Array(readFileSync(join(ROOT, rel)))));

  return archives;
}

function produce(fixture: Fixture): null | Uint8Array {
  switch (fixture.type) {
    case 'archive': {
      const data = extractEntry(fixture.entry);

      return data ? buildVer2Buffer([{ data, name: fixture.entry }]) : null;
    }
    case 'copy': {
      return new Uint8Array(readFileSync(join(ROOT, fixture.from)));
    }
    case 'extract': {
      return extractEntry(fixture.entry);
    }
    case 'mod': {
      return new Uint8Array(readFileSync(join('mods-src', 'mods', fixture.from)));
    }
  }
}

let written = 0;
const missing: string[] = [];

for (const fixture of [...MANIFEST, ...MOD_MANIFEST]) {
  let data: null | Uint8Array = null;
  try {
    data = produce(fixture);
  } catch {
    data = null;
  }
  if (!data) {
    missing.push(fixture.dest);
    continue;
  }
  mkdirSync(dirname(fixture.dest), { recursive: true });
  writeFileSync(fixture.dest, data);
  written += 1;
}

// Generated: the stock 24-hour timecyc (convertTo24h of timecyc.dat), no RealVision/mod overlay — the
// game build's `npm run timecyc` keeps its own enhanced merge; this fixture stays a plain stock expansion.
try {
  const timecyc = readFileSync(join(ROOT, 'data', 'timecyc.dat'), 'utf8');
  const dest = `${OUT}/data/timecyc_24h.dat`;
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, stringifyTimecyc(convertTo24h(parseTimecyc(timecyc))));
  written += 1;
} catch {
  missing.push(`${OUT}/data/timecyc_24h.dat`);
}

console.log(`test:fixtures (${GAME}): wrote ${written}/${MANIFEST.length + MOD_MANIFEST.length + 1} into ${OUT}/`);
if (missing.length > 0) {
  console.error(`\n  MISSING ${missing.length} — source not found in ${ROOT}:`);
  for (const dest of missing) {
    console.error(`    - ${dest}`);
  }
  console.error(`\n  Ensure game-src/${GAME} is a complete, unmodified GTA San Andreas install.`);
  process.exitCode = 1;
}
