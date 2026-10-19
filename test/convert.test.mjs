// Regression tests against the real LDraw library ($LDRAW_LIB, or the default locations).
// Without a library they are skipped; CI downloads complete.zip first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { openLibrary } from '../src/node/library.mjs';
import { convert, toStl, toStlPerColour, to3mfEntries } from '../src/core/convert.mjs';
import { createZip, readZipDirectory } from '../src/core/zip.mjs';
import { decodeStl } from '../src/core/stl.mjs';
import { stlToDat } from '../src/core/dat.mjs';
import { LICENSE_URLS } from '../src/core/credits.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let library = null;
try { library = openLibrary(); } catch { /* skipped below */ }
const skip = library ? false : 'no LDraw library (set LDRAW_LIB to complete.zip)';
const example = (name) => ({ text: fs.readFileSync(path.join(root, 'examples', name), 'utf8'), name });

test('minifigures come out 1:1, closed and outward facing', { skip }, async () => {
  const expected = {
    'minifig-office.ldr': [[24.93, 15.98, 41.21], 10],
    'minifig-train.ldr': [[24.93, 16.11, 41.89], 10],
    'minifig-plain.ldr': [[24.93, 14.82, 40], 9],
  };
  for (const [file, [size, shells]] of Object.entries(expected)) {
    const r = await convert(library, example(file));
    assert.deepEqual(r.summary.sizeMm, size, file);
    assert.equal(r.summary.shells, shells, file);
    assert.equal(r.summary.closedShells, shells, `${file}: every part closed`);
    for (const s of r.shells) assert.ok(s.report.volume > 0, `${file}: ${s.name} faces outward`);
    assert.deepEqual(r.missing, []);
  }
});

test('nominal LDraw dimensions in millimetres', { skip }, async () => {
  // 1 LDU = 0.4 mm: a 2 x 4 brick is 80 x 40 x 28 LDU (body 24 + stud 4)
  const cases = { '3001.dat': [32, 16, 11.2], '3005.dat': [8, 8, 11.2], '3024.dat': [8, 8, 4.8], '3626cp01.dat': [10.4, 10.4, 11.2] };
  for (const [part, size] of Object.entries(cases)) {
    const r = await convert(library, { part });
    assert.deepEqual(r.summary.sizeMm, size, part);
    assert.equal(r.summary.closedShells, r.summary.shells, part);
  }
  const doubled = await convert(library, { part: '3001.dat' }, { scale: 2 });
  assert.deepEqual(doubled.summary.sizeMm, [64, 32, 22.4]);
});

test('STL, LDraw, STL round trip keeps every triangle', { skip }, async () => {
  for (const part of ['3001.dat', '3626cp01.dat', '76382p07.dat', '2780.dat']) {
    const first = await convert(library, { part });
    const stl = toStl(first);
    const { text } = stlToDat(decodeStl(stl), { name: 'rt.dat', title: 'round trip' });
    const second = await convert(library, { text, name: 'rt.dat' }, { repair: false, weldMm: 1e-6 });
    assert.equal(second.summary.triangles, first.summary.triangles, part);
    assert.deepEqual(second.summary.sizeMm, first.summary.sizeMm, part);
    assert.ok(Math.abs(second.summary.volumeMm3 - first.summary.volumeMm3) < 0.2, part);
  }
});

test('credits name every library file with author, licence and source', { skip }, async () => {
  const r = await convert(library, example('minifig-train.ldr'));
  const files = r.resolverFiles ?? r.credits.library;
  assert.ok(files.length > 50);
  for (const f of files) {
    assert.ok(f.author && f.author !== 'unknown', f.rel);
    assert.ok(f.licenses.length > 0 && f.licenses.every((l) => l in LICENSE_URLS), `${f.rel}: ${f.license}`);
    assert.match(f.url, /^https:\/\/library\.ldraw\.org\/library\/official\/(parts|p)\//);
    assert.ok(r.creditsText.includes(f.rel), f.rel);
  }
  assert.match(r.creditsText, /Changes: /);
  assert.match(r.creditsText, /creativecommons\.org\/licenses\/by\/4\.0/);
});

test('3MF: colours per triangle, filament painting, embedded credits', { skip }, async () => {
  const r = await convert(library, example('minifig-train.ldr'));
  const { entries, filaments } = to3mfEntries(r);
  const zip = await createZip(entries, (d) => zlib.deflateRawSync(d));
  const dir = readZipDirectory(zip);
  const read = (name) => {
    const e = dir.get(name);
    return zlib.inflateRawSync(zip.subarray(e.dataStart, e.dataStart + e.csize)).toString();
  };
  const model = read('3D/3dmodel.model');
  assert.equal(filaments[0].name, 'Black');
  assert.ok(filaments.some((f) => f.name === 'Metallic_Gold'), 'torso print colours survive');
  assert.match(model, /paint_color="8" slic3rpe:mmu_segmentation="8"/);
  assert.match(model, /<metadata name="LicenseTerms">/);
  assert.equal(read('Metadata/credits.txt'), r.creditsText);
  assert.equal((model.match(/<triangle /g) || []).length, r.summary.triangles);
});

test('STL per colour keeps whole parts', { skip }, async () => {
  const r = await convert(library, example('minifig-office.ldr'));
  const parts = toStlPerColour(r);
  assert.equal(parts.reduce((n, p) => n + p.summary.shells, 0), r.summary.shells);
  for (const p of parts) assert.equal(p.summary.closedShells, p.summary.shells, p.name);
});

test('unknown parts are reported, not invented', { skip }, async () => {
  const r = await convert(library, { text: '1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 nosuchpart.dat\n', name: 'x.ldr' });
  assert.deepEqual(r.missing, ['nosuchpart.dat']);
  await assert.rejects(convert(library, { part: 'nosuchpart.dat' }), /not found in the library/);
});
