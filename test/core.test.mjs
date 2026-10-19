// Library-independent unit tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { paintCode } from '../src/core/threemf.mjs';
import { createZip, readZipDirectory, crc32 } from '../src/core/zip.mjs';
import { encodeStl, decodeStl } from '../src/core/stl.mjs';
import { stlToDat } from '../src/core/dat.mjs';
import { parseHeader, splitMpd, Resolver, flatten } from '../src/core/ldraw.mjs';
import { weld, meshReport, repairTJunctions, capPlanarLoops } from '../src/core/mesh.mjs';

test('filament paint codes match the PrusaSlicer/Bambu encoding', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 18].map(paintCode), ['', '4', '8', '0C', '1C', '2C', 'FC']);
});

test('zip round trip, stored and deflated', async () => {
  const entries = [['a.txt', 'hello'], ['dir/b.bin', new Uint8Array([0, 1, 2, 255])]];
  for (const deflate of [null, (d) => zlib.deflateRawSync(d)]) {
    const zip = await createZip(entries, deflate);
    const dir = readZipDirectory(zip);
    assert.deepEqual([...dir.keys()], ['a.txt', 'dir/b.bin']);
    const e = dir.get('a.txt');
    const data = zip.subarray(e.dataStart, e.dataStart + e.csize);
    assert.equal((deflate ? zlib.inflateRawSync(data) : Buffer.from(data)).toString(), 'hello');
    assert.equal(e.crc, crc32(new TextEncoder().encode('hello')));
  }
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('binary and ASCII STL decode to the same triangles', () => {
  const tris = [{ v: [0, 0, 0, 10, 0, 0, 0, 10, 0] }];
  const bin = decodeStl(encodeStl(tris, 'x'));
  const ascii = decodeStl(new TextEncoder().encode('solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid t\n'));
  assert.deepEqual(bin.map((t) => t.v), [tris[0].v]);
  assert.deepEqual(ascii.map((t) => t.v), [tris[0].v]);
});

test('stl2dat never invents a licence and maps axes back to LDraw', () => {
  const { text } = stlToDat([{ v: [0, 0, 0, 10, 0, 0, 0, 10, 0] }], { origin: 'keep' });
  assert.doesNotMatch(text, /!LICENSE/);
  assert.match(text, /^3 16 0 0 0 25 0 0 0 0 25$/m); // (X, Y, Z) mm -> (X, -Z, Y) LDU
  assert.match(stlToDat([], { license: 'Licensed under CC BY 4.0 : see CAreadme.txt' }).text, /^0 !LICENSE Licensed under CC BY 4\.0/m);
});

test('header fields for attribution', () => {
  const h = parseHeader('0 Brick  2 x  4\n0 Name: 3001.dat\n0 Author: James Jessiman\n0 !LDRAW_ORG Part UPDATE 2004-03\n0 !LICENSE Licensed under CC BY 4.0 : see CAreadme.txt\n0 !HISTORY 2002-08-18 [PTadmin] Official Update 2002-03\n0 !HISTORY 2007-05-04 [guyvivan] BFC\n0 !HISTORY 2012-01-01 {Steve Bliss} fix\n');
  assert.equal(h.title, 'Brick  2 x  4');
  assert.equal(h.author, 'James Jessiman');
  assert.match(h.license, /CC BY 4\.0/);
  assert.deepEqual(h.editors, ['guyvivan', 'Steve Bliss']);
});

test('MPD sub-files resolve locally', async () => {
  const { main, files } = splitMpd('0 FILE main.ldr\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 sub.ldr\n0 FILE sub.ldr\n0 BFC CERTIFY CCW\n3 16 0 0 0 1 0 0 0 1 0\n');
  assert.equal(main, 'main.ldr');
  const resolver = new Resolver({ has: () => false, read: () => null }, { local: files });
  const lines = files.get(main).split('\n');
  await resolver.prefetch(lines);
  const tris = flatten(resolver, lines);
  assert.equal(tris.length, 1);
  assert.equal(tris[0].c, '4');
});

test('BFC: a mirrored reference flips the winding back to outward', async () => {
  const cube = ['0 BFC CERTIFY CCW',
    '4 16 -1 -1 -1 -1 1 -1 1 1 -1 1 -1 -1', '4 16 -1 -1 1 1 -1 1 1 1 1 -1 1 1',
    '4 16 -1 -1 -1 1 -1 -1 1 -1 1 -1 -1 1', '4 16 -1 1 -1 -1 1 1 1 1 1 1 1 -1',
    '4 16 -1 -1 -1 -1 -1 1 -1 1 1 -1 1 -1', '4 16 1 -1 -1 1 1 -1 1 1 1 1 -1 1'].join('\n');
  const local = new Map([['cube.dat', cube]]);
  const signs = [];
  for (const matrix of ['1 0 0 0 1 0 0 0 1', '-1 0 0 0 1 0 0 0 1', '1 0 0 0 -1 0 0 0 1']) {
    const resolver = new Resolver({ has: () => false, read: () => null }, { local });
    const lines = [`1 4 0 0 0 ${matrix} cube.dat`];
    await resolver.prefetch(lines);
    const mesh = weld(flatten(resolver, lines).map(({ c, v }) => ({ c, v })), 1e-6);
    const report = meshReport(mesh);
    assert.equal(report.boundaryEdges, 0);
    assert.equal(report.inconsistentlyOrientedEdges, 0);
    assert.ok(Math.abs(Math.abs(report.volume) - 8) < 1e-9, matrix);
    signs.push(Math.sign(report.volume));
  }
  // a mirror reverses the geometry; BFC reverses the winding with it, so orientation is kept
  assert.deepEqual(signs, [signs[0], signs[0], signs[0]]);
});

test('T-junction repair and hole capping close a split face', () => {
  // a unit box whose top face is two triangles meeting a vertex in the middle of an edge
  const v = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1], [0.5, 0, 1]];
  const faces = [[0, 2, 1], [0, 3, 2], [0, 1, 5], [0, 5, 8], [0, 8, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7], [4, 5, 6], [4, 6, 7]].map((f) => [...f, '16']);
  const before = meshReport({ verts: v.map((p) => [...p]), faces });
  assert.ok(before.boundaryEdges > 0);
  const repaired = repairTJunctions({ verts: v.map((p) => [...p]), faces }, 1e-6);
  capPlanarLoops(repaired, 1e-6);
  const after = meshReport(repaired);
  assert.equal(after.boundaryEdges, 0);
  assert.ok(after.watertight);
  assert.ok(Math.abs(after.volume - 1) < 1e-9);
});
