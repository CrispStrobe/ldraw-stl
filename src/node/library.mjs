// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// LDraw libraries on disk for Node: the official complete.zip (read in place) or an extracted
// library directory. (The web mirror is a zip too: concatenate its chunks to use it here.)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { readZipDirectory } from '../core/zip.mjs';

export class ZipLibrary {
  constructor(file) {
    this.file = file;
    this.bytes = new Uint8Array(fs.readFileSync(file));
    this.entries = new Map();
    for (const [name, e] of readZipDirectory(this.bytes)) this.entries.set(name.toLowerCase().replace(/^ldraw\//, ''), e);
  }
  has(rel) { return this.entries.has(rel); }
  read(rel) {
    const e = this.entries.get(rel);
    const data = this.bytes.subarray(e.dataStart, e.dataStart + e.csize);
    if (e.method === 0) return Buffer.from(data).toString('utf8');
    if (e.method === 8) return zlib.inflateRawSync(data).toString('utf8');
    throw new Error(`unsupported zip method ${e.method} for ${rel}`);
  }
  *list() { yield* this.entries.keys(); }
  describe() { return this.file; }
}

export class DirLibrary {
  constructor(dir) {
    this.dir = dir;
    this.entries = new Map(); // lowercase relative path -> real relative path
    const walk = (rel) => {
      for (const d of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${d.name}` : d.name;
        if (d.isDirectory()) walk(r);
        else this.entries.set(r.toLowerCase(), r);
      }
    };
    walk('');
  }
  has(rel) { return this.entries.has(rel); }
  read(rel) { return fs.readFileSync(path.join(this.dir, this.entries.get(rel)), 'utf8'); }
  *list() { yield* this.entries.keys(); }
  describe() { return this.dir; }
}

export function defaultLibraryCandidates() {
  return [
    process.env.LDRAW_LIB,
    path.join(os.homedir(), 'Library/Caches/BrickStore/ldraw/complete.zip'),
    path.join(os.homedir(), '.cache/ldraw/complete.zip'),
    path.join(os.homedir(), 'ldraw'),
  ].filter(Boolean);
}

const expandHome = (p) => p.replace(/^~(?=$|[\\/])/, os.homedir());

export function openLibrary(spec) {
  const candidates = (spec ? [spec] : defaultLibraryCandidates()).map(expandHome);
  for (const c of candidates) {
    if (!fs.existsSync(c)) continue;
    return fs.statSync(c).isDirectory() ? new DirLibrary(c) : new ZipLibrary(c);
  }
  throw new Error(`no LDraw library found (tried: ${candidates.join(', ')}); pass --lib <dir|complete.zip> ` +
    `or download https://library.ldraw.org/library/updates/complete.zip`);
}
