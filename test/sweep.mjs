#!/usr/bin/env node
// Convert a deterministic sample of library parts and report how many come out closed.
//
//   LDRAW_LIB=complete.zip node test/sweep.mjs [every-nth=10] [--json out.json]

import fs from 'node:fs';
import { openLibrary } from '../src/node/library.mjs';
import { convert } from '../src/core/convert.mjs';

const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
const nth = Number(args[0] ?? 10);
const library = openLibrary();
const parts = [...library.list()].filter((r) => /^parts\/[^/]+\.dat$/.test(r)).sort();
const sample = parts.filter((_, i) => i % nth === 0);
const rows = [];
const t0 = Date.now();
for (const rel of sample) {
  const part = rel.slice(6);
  const title = library.read(rel).split(/\r?\n/, 1)[0].replace(/^0\s*/, '');
  if (/^~Moved to/.test(title)) continue;
  const t = Date.now();
  try {
    const r = await convert(library, { part });
    rows.push({ part, title, ms: Date.now() - t, shells: r.summary.shells, closed: r.summary.closedShells, triangles: r.summary.triangles, missing: r.missing });
  } catch (err) {
    rows.push({ part, title, ms: Date.now() - t, error: err.message });
  }
}
const ok = rows.filter((r) => !r.error);
const allClosed = ok.filter((r) => r.closed === r.shells);
const shells = ok.reduce((n, r) => n + r.shells, 0);
const closed = ok.reduce((n, r) => n + r.closed, 0);
const slow = [...ok].sort((a, b) => b.ms - a.ms).slice(0, 5);
console.log(`${rows.length} parts (every ${nth}th) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(`errors: ${rows.length - ok.length}${rows.length - ok.length ? ' ' + rows.filter((r) => r.error).slice(0, 5).map((r) => `${r.part}: ${r.error}`).join('; ') : ''}`);
console.log(`parts fully closed: ${allClosed.length}/${ok.length} (${(100 * allClosed.length / ok.length).toFixed(1)}%)`);
console.log(`part shells closed: ${closed}/${shells} (${(100 * closed / shells).toFixed(1)}%)`);
console.log(`missing subfiles: ${ok.filter((r) => r.missing.length).length} parts`);
console.log(`slowest: ${slow.map((r) => `${r.part} ${r.ms} ms`).join(', ')}`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
