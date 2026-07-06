import { openArchive } from '@opensa/renderware/archive/img-archive';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** An area's boot cost: text inst rows + all its binary-stream rows pass one 4096-slot buffer at boot. */
const AREA_ROW_CAP = 4000;

/**
 * Free `IplEntityIndexArrays` slots held by STOCK text IPLs that have no binary streams: move their inst
 * rows into the least-loaded stream-backed stock host (appends never shift the host's indexes) and empty
 * their own inst block in place — the file keeps its other sections (enex/cull/grge…) and its gta.dat line,
 * but an inst-less IPL takes NO slot. Stock SA has exactly two such files (`int_cont`, `gen_int1`); the two
 * freed slots are the build's headroom for the user's own modloader IPL mods.
 */
export function compactStockInstIpls(gamePath: string, outPath: string): { compacted: number; rows: number } {
  const stockDatPath = join(gamePath, 'data', 'gta.dat');
  const datPath = join(outPath, 'data', 'gta.dat');
  if (!existsSync(stockDatPath) || !existsSync(datPath)) {
    return { compacted: 0, rows: 0 };
  }
  const stock = new Set(iplLines(readFileSync(stockDatPath, 'utf8')).map(([, base]) => base));
  const streamRows = allStreamRows(outPath);

  const donors: { file: string; rows: string[] }[] = [];
  const hosts: { file: string; total: number }[] = [];
  for (const [path, base] of iplLines(readFileSync(datPath, 'utf8'))) {
    if (!stock.has(base)) {
      continue; // generated/mod files are handled by mergeModInstIpls / the generators' own budgets
    }
    const file = join(outPath, path.replace(/\\/g, '/'));
    if (!existsSync(file)) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    const count = countInstRows(text);
    if (count === 0) {
      continue;
    }
    if (streamRows.has(base.replace(/\.ipl$/, ''))) {
      hosts.push({ file, total: count + (streamRows.get(base.replace(/\.ipl$/, '')) ?? 0) });
    } else {
      donors.push({ file, rows: instBlockRows(text) });
    }
  }

  const donorRows = donors.reduce((n, d) => n + d.rows.length, 0);
  const host = hosts.sort((a, b) => a.total - b.total)[0];
  if (donors.length === 0 || !host || host.total + donorRows > AREA_ROW_CAP) {
    return { compacted: 0, rows: 0 };
  }

  const hostText = readFileSync(host.file, 'utf8');
  const hostCount = countInstRows(hostText);
  const moved: string[] = [];
  for (const donor of donors) {
    const offset = hostCount + moved.length;
    for (const row of donor.rows) {
      moved.push(rebaseLod(row, offset));
    }
    writeFileSync(donor.file, emptyInstSection(readFileSync(donor.file, 'utf8')));
  }
  writeFileSync(host.file, appendToInstSection(hostText, moved));

  return { compacted: donors.length, rows: moved.length };
}

/**
 * Fold mod-added text IPLs into a **stock host IPL** to save `IplEntityIndexArrays` slots: every gta.dat text
 * IPL with inst rows takes one slot of SA's **40-entry static array (no bounds check)** — stock uses 30 and
 * the LOD generators add ~9 more, so a handful of mod IPLs (each usually a few dozen rows) overflows it and
 * corrupts the CIplStore statics right behind the array (`gbIplsNeededAtPosn`/`ms_pQuadTree`/`ms_pPool` —
 * Junior_Djjr's CrashList: "Try mixing the IPL files"). Rows are APPENDED to the least-loaded stock area's
 * inst section — appends never shift existing indexes, so the host's binary-stream `lod` links stay valid —
 * and the mods' internal `lod` links are rebased by their offset in the host.
 *
 * Skipped (kept as their own file): stock IPLs, files with companion `_stream` entries in gta3.img (binary
 * lod fields index THAT text file), and files with sections beyond `inst` (nothing observed ships them).
 */
export function mergeModInstIpls(gamePath: string, outPath: string): { merged: number; rows: number } {
  const stockDatPath = join(gamePath, 'data', 'gta.dat');
  const datPath = join(outPath, 'data', 'gta.dat');
  if (!existsSync(stockDatPath) || !existsSync(datPath)) {
    return { merged: 0, rows: 0 }; // no gta.dat — nothing registered, nothing to fold
  }
  const stock = new Set(iplLines(readFileSync(stockDatPath, 'utf8')).map(([, base]) => base));
  const dat = readFileSync(datPath, 'utf8');
  const streamRows = allStreamRows(outPath);

  const candidates: { base: string; file: string; inst: string[] }[] = [];
  const hosts: { file: string; total: number }[] = [];
  for (const [path, base] of iplLines(dat)) {
    const file = join(outPath, path.replace(/\\/g, '/'));
    if (!existsSync(file)) {
      continue;
    }
    if (stock.has(base)) {
      const rows = countInstRows(readFileSync(file, 'utf8'));
      if (rows > 0) {
        hosts.push({ file, total: rows + (streamRows.get(base.replace(/\.ipl$/, '')) ?? 0) });
      }
      continue;
    }
    if (streamRows.has(base.replace(/\.ipl$/, ''))) {
      continue; // binary streams index this text file — it must keep its own identity
    }
    const inst = instRows(readFileSync(file, 'utf8'));
    if (inst === null || inst.length === 0) {
      continue; // no inst rows (no slot taken), or non-inst sections present (don't split such a file)
    }
    candidates.push({ base, file, inst });
  }

  const modRows = candidates.reduce((n, c) => n + c.inst.length, 0);
  const host = hosts.sort((a, b) => a.total - b.total)[0];
  if (candidates.length === 0 || !host || host.total + modRows > AREA_ROW_CAP) {
    return { merged: 0, rows: 0 }; // nothing to fold, or no stock area has the row budget — leave as-is
  }

  const hostText = readFileSync(host.file, 'utf8');
  const hostCount = countInstRows(hostText);
  const rows: string[] = [];
  const mergedBases = new Set<string>();
  for (const { base, file, inst } of candidates) {
    const offset = hostCount + rows.length;
    for (const row of inst) {
      rows.push(rebaseLod(row, offset));
    }
    mergedBases.add(base);
    rmSync(file);
  }
  writeFileSync(host.file, appendToInstSection(hostText, rows));

  const eol = dat.includes('\r\n') ? '\r\n' : '\n';
  const kept = dat
    .split(/\r?\n/)
    .filter((line) => {
      const ref = parseIplLine(line);

      return ref === null || !mergedBases.has(ref[1]);
    })
    .join(eol)
    .replace(/\s*$/, '');
  writeFileSync(datPath, `${kept}${eol}`);

  return { merged: mergedBases.size, rows: rows.length };
}

/** Stream rows per area across both map IMGs (exterior gta3.img + interior gta_int.img). */
function allStreamRows(outPath: string): Map<string, number> {
  const rows = imgStreamRows(join(outPath, 'models', 'gta3.img'));
  for (const [area, count] of imgStreamRows(join(outPath, 'models', 'gta_int.img'))) {
    rows.set(area, (rows.get(area) ?? 0) + count);
  }

  return rows;
}

/** Insert rows at the end of the first `inst … end` block, preserving the file's line endings. */
function appendToInstSection(text: string, rows: readonly string[]): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  let inInst = false;
  for (let i = 0; i < lines.length; i += 1) {
    const token = lines[i].trim().toLowerCase();
    if (!inInst && token === 'inst') {
      inInst = true;
    } else if (inInst && token === 'end') {
      return [...lines.slice(0, i), ...rows, ...lines.slice(i)].join(eol);
    }
  }
  throw new Error('host IPL has no inst section');
}

/** Data rows of the first `inst … end` block — the index space the appended rows continue. */
function countInstRows(text: string): number {
  let n = 0;
  let inInst = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('//')) {
      continue;
    }
    const token = line.toLowerCase();
    if (!inInst && token === 'inst') {
      inInst = true;
    } else if (inInst && token === 'end') {
      break;
    } else if (inInst) {
      n += 1;
    }
  }

  return n;
}

/** Remove the data rows of the first `inst … end` block, keeping the (now empty) section and all others. */
function emptyInstSection(text: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let inInst = false;
  let done = false;
  for (const line of lines) {
    const token = line.trim().toLowerCase();
    if (!done && !inInst && token === 'inst') {
      inInst = true;
      out.push(line);
      continue;
    }
    if (inInst && token === 'end') {
      inInst = false;
      done = true;
      out.push(line);
      continue;
    }
    if (!inInst) {
      out.push(line);
    }
  }

  return out.join(eol);
}

/** Per area key (`<base>` of `<base>_streamN.ipl`): total binary INST rows across its streams in the IMG. */
function imgStreamRows(imgPath: string): Map<string, number> {
  const rows = new Map<string, number>();
  if (!existsSync(imgPath)) {
    return rows;
  }
  const buffer = readFileSync(imgPath);
  const archive = openArchive(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
  for (const name of archive.names) {
    const match = /^(.+)_stream\d+\.ipl$/i.exec(name);
    if (!match) {
      continue;
    }
    const area = match[1].toLowerCase();
    const data = archive.get(name);
    const count = data && data.byteLength >= 8 ? new DataView(data.slice(0, 8)).getUint32(4, true) : 0;
    rows.set(area, (rows.get(area) ?? 0) + count);
  }

  return rows;
}

/** Data rows of the first `inst … end` block. */
function instBlockRows(text: string): string[] {
  const rows: string[] = [];
  let inInst = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('//')) {
      continue;
    }
    const token = line.toLowerCase();
    if (!inInst && token === 'inst') {
      inInst = true;
    } else if (inInst && token === 'end') {
      break;
    } else if (inInst) {
      rows.push(line);
    }
  }

  return rows;
}

/** The file's inst data rows — or null when the file carries any OTHER section (we won't split those). */
function instRows(text: string): null | string[] {
  const rows: string[] = [];
  let section: null | string = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('//')) {
      continue;
    }
    if (section === null) {
      section = line.toLowerCase();
      if (section !== 'inst') {
        return null;
      }
      continue;
    }
    if (line.toLowerCase() === 'end') {
      section = null;
      continue;
    }
    rows.push(line);
  }

  return rows;
}

/** The gta.dat `IPL` lines (skipping `.zon`), as `[declared path, lowercased basename]`. */
function iplLines(dat: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of dat.split(/\r?\n/)) {
    const ref = parseIplLine(line);
    if (ref !== null) {
      out.push(ref);
    }
  }

  return out;
}

function parseIplLine(line: string): [string, string] | null {
  const match = /^IPL\s+(\S.*)$/i.exec(line.trim());
  if (!match || match[1].toLowerCase().endsWith('.zon')) {
    return null;
  }
  const path = match[1];
  const base = (path.split(/[\\/]/).pop() ?? path).toLowerCase();

  return [path, base];
}

/** Shift a row's `lod` column (last field) by `offset` — internal links keep pointing at their own rows. */
function rebaseLod(row: string, offset: number): string {
  const cells = row.split(',');
  const lod = Number(cells[cells.length - 1]);
  if (!Number.isInteger(lod) || lod < 0) {
    return row;
  }
  cells[cells.length - 1] = ` ${lod + offset}`;

  return cells.join(',');
}
