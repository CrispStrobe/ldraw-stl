#!/usr/bin/env node
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Build the web mirror of the LDraw.org Parts Library from the official complete.zip.
//
//   node scripts/build-library.mjs <complete.zip> <out dir> [--source-date YYYY-MM-DD] [--source-url URL]
//
// Only CC BY-licensed library files are mirrored: parts/ (without textures/), p/, LDConfig.ldr
// and the licence documents. The rest of complete.zip (mklist tools, sample models, textures)
// is left out. Entries are copied with their original compressed bytes, packed into one zip and
// cut into chunks that browsers fetch with HTTP range requests. Concatenating the chunks gives
// back that zip.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { readZipDirectory } from '../src/core/zip.mjs';
import { parseColours, parseHeader } from '../src/core/ldraw.mjs';

const CHUNK = 8 * 1024 * 1024;
const LICENCE_DOCS = ['CAreadme.txt', 'CAlicense.txt', 'CAlicense4.txt'];

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const sourceUrl = opt('--source-url') ?? 'https://library.ldraw.org/library/updates/complete.zip';
let sourceDate = opt('--source-date');
const [src, outDir] = args;
if (!src || !outDir) { console.error('usage: build-library.mjs <complete.zip> <out dir> [--source-date D] [--source-url U]'); process.exit(2); }

const bytes = new Uint8Array(fs.readFileSync(src));
const sourceSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
sourceDate ??= fs.statSync(src).mtime.toISOString().slice(0, 10);
const entries = readZipDirectory(bytes);
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const keep = (name) => {
  const rel = name.replace(/^ldraw\//, '');
  if (/^parts\/textures\//i.test(rel)) return false;
  if (/^(parts|p)\/.+\.dat$/i.test(rel)) return true;
  return rel === 'LDConfig.ldr' || LICENCE_DOCS.includes(rel);
};

const text = (e) => {
  const data = bytes.subarray(e.dataStart, e.dataStart + e.csize);
  return (e.method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data)).toString('utf8');
};

fs.rmSync(path.join(outDir, 'library'), { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'library'), { recursive: true });

// repack: local header + original compressed data, then a fresh central directory
const pieces = [];
const central = [];
const files = {};
const catalog = [];
const excluded = new Map();
let offset = 0;
const enc = new TextEncoder();
for (const [name, e] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
  if (!keep(name)) {
    const group = name.replace(/^ldraw\//, '').split('/').slice(0, name.includes('textures') ? 2 : 1).join('/');
    excluded.set(group, (excluded.get(group) || 0) + 1);
    continue;
  }
  const rel = name.replace(/^ldraw\//, '');
  const nameBytes = enc.encode(name);
  const local = new Uint8Array(30);
  local.set(bytes.subarray(e.local, e.local + 30));
  const lv = new DataView(local.buffer);
  lv.setUint16(6, lv.getUint16(6, true) & ~0x0008, true); // sizes are in the header, no data descriptor
  lv.setUint32(14, e.crc, true);
  lv.setUint32(18, e.csize, true);
  lv.setUint32(22, e.usize, true);
  lv.setUint16(26, nameBytes.length, true);
  lv.setUint16(28, 0, true);
  const data = bytes.subarray(e.dataStart, e.dataStart + e.csize);
  const dataStart = offset + 30 + nameBytes.length;
  const dir = new Uint8Array(46);
  const dv = new DataView(dir.buffer);
  dv.setUint32(0, 0x02014b50, true);
  dv.setUint16(4, 20, true);
  dv.setUint16(6, 20, true);
  dv.setUint16(10, e.method, true);
  dv.setUint16(12, view.getUint16(e.local + 10, true), true);
  dv.setUint16(14, view.getUint16(e.local + 12, true), true);
  dv.setUint32(16, e.crc, true);
  dv.setUint32(20, e.csize, true);
  dv.setUint32(24, e.usize, true);
  dv.setUint16(28, nameBytes.length, true);
  dv.setUint32(42, offset, true);
  pieces.push(local, nameBytes, data);
  central.push(dir, nameBytes);
  offset += 30 + nameBytes.length + e.csize;
  files[rel.toLowerCase()] = [dataStart, e.csize, e.usize, e.method];

  if (/^parts\/[^/]+\.dat$/i.test(rel)) {
    const t = text(e);
    const h = parseHeader(t);
    const title = h.title;
    if (/^~Moved to /i.test(title)) continue;
    const category = t.match(/^\s*0\s+!CATEGORY\s+(.+?)\s*$/m)?.[1] ?? title.replace(/^[~_=|]+/, '').split(/\s+/)[0];
    const keywords = [...t.matchAll(/^\s*0\s+!KEYWORDS\s+(.+?)\s*$/gm)].map((m) => m[1]).join(', ');
    const type = h.org?.replace(/^Unofficial_/, '').split(/\s+/)[0] ?? 'Part';
    catalog.push([rel.slice(6, -4), title, category, keywords, type]);
  }
}
const cdSize = central.reduce((n, b) => n + b.length, 0);
const end = new Uint8Array(22);
const ev = new DataView(end.buffer);
ev.setUint32(0, 0x06054b50, true);
ev.setUint16(8, central.length / 2, true);
ev.setUint16(10, central.length / 2, true);
ev.setUint32(12, cdSize, true);
ev.setUint32(16, offset, true);

const zip = Buffer.concat([...pieces, ...central, end]);
const chunks = [];
for (let i = 0, n = 0; i < zip.length; i += CHUNK, n++) {
  const file = `ldraw-library.zip.${String(n).padStart(3, '0')}`;
  const part = zip.subarray(i, i + CHUNK);
  fs.writeFileSync(path.join(outDir, 'library', file), part);
  chunks.push({ file, size: part.length });
}

const colours = [...parseColours(text(entries.get('ldraw/LDConfig.ldr')))].map(([code, c]) => [code, c.name, c.hex, c.alpha]);
for (const doc of LICENCE_DOCS) {
  const e = entries.get(`ldraw/${doc}`);
  if (e) fs.writeFileSync(path.join(outDir, 'library', doc), text(e));
}
const fileCount = Object.keys(files).length;
const manifest = {
  format: 1,
  source: { url: sourceUrl, sha256: sourceSha256, date: sourceDate, bytes: bytes.length },
  builtAt: new Date().toISOString(),
  zip: { file: 'ldraw-library.zip', bytes: zip.length, sha256: crypto.createHash('sha256').update(zip).digest('hex') },
  chunkSize: CHUNK,
  chunks,
  fileCount,
  partCount: catalog.length,
  licences: {
    summary: 'LDraw.org Parts Library: CC BY 4.0, some files CC BY 2.0 and CC BY 4.0 (see the !LICENSE line of each file and CAreadme.txt)',
    documents: LICENCE_DOCS,
    'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
    'CC BY 2.0': 'https://creativecommons.org/licenses/by/2.0/',
  },
  excluded: Object.fromEntries([...excluded].sort()),
};
const json = (file, value) => fs.writeFileSync(path.join(outDir, 'library', file), JSON.stringify(value));
json('files.json', files);
json('catalog.json', { fields: ['name', 'title', 'category', 'keywords', 'type'], parts: catalog });
json('colours.json', colours);
fs.writeFileSync(path.join(outDir, 'library', 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`library: ${fileCount} files, ${catalog.length} catalog parts, ${(zip.length / 1e6).toFixed(1)} MB in ${chunks.length} chunks; excluded ${JSON.stringify(manifest.excluded)}`);
