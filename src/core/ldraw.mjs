// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// LDraw parsing: name resolution, colours, MPD splitting and flattening to triangles.
//
// A library is any object with
//   has(rel)  -> boolean           (sync; rel is lowercase, '/'-separated, e.g. 'parts/3001.dat')
//   read(rel) -> string | Promise  (file text)
// so the same code runs on a zip on disk (CLI) and on a range-fetched mirror (browser).

export const MM_PER_LDU = 0.4;

export const normName = (ref) => ref.trim().replace(/\\/g, '/').toLowerCase();

export function parseColours(text) {
  const colours = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*0\s+!COLOUR\s+(\S+)\s+CODE\s+(\d+)\s+VALUE\s+#([0-9A-Fa-f]{6})(.*)$/);
    if (!m) continue;
    const alpha = m[4].match(/\bALPHA\s+(\d+)/)?.[1];
    colours.set(m[2], { name: m[1], hex: m[3].toUpperCase(), alpha: alpha == null ? 255 : Number(alpha) });
  }
  return colours;
}

export function colourInfo(colours, code) {
  if (colours.has(code)) return colours.get(code);
  const direct = /^0x2([0-9A-Fa-f]{6})$/.exec(code);
  if (direct) return { name: `Direct_${direct[1].toUpperCase()}`, hex: direct[1].toUpperCase(), alpha: 255 };
  return { name: code === '16' ? 'Main' : `Colour_${code}`, hex: 'A0A5A9', alpha: 255 };
}

export function splitMpd(text) {
  const files = new Map();
  let main = null;
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*0\s+FILE\s+(.+?)\s*$/);
    if (m) {
      current = normName(m[1]);
      if (main == null) main = current;
      files.set(current, []);
      continue;
    }
    if (/^\s*0\s+NOFILE/.test(line)) { current = null; continue; }
    if (current) files.get(current).push(line);
  }
  for (const [k, v] of files) files.set(k, v.join('\n'));
  return { main, files };
}

// Header fields needed for attribution (CC BY: creator, licence, source of each file).
export function parseHeader(text) {
  const first = text.match(/^\s*0\s+(.*?)\s*$/m)?.[1] ?? '';
  const field = (re) => text.match(re)?.[1]?.trim() ?? null;
  const editors = new Set();
  for (const m of text.matchAll(/^\s*0\s+!HISTORY\s+\S+\s+(?:\[([^\]]+)\]|\{([^}]+)\})/gm)) {
    const who = (m[1] ?? m[2]).trim();
    if (!/^PTadmin$/i.test(who)) editors.add(who);
  }
  return {
    title: first.startsWith('Name:') ? '' : first,
    name: field(/^\s*0\s+Name:\s*(.+?)\s*$/m),
    author: field(/^\s*0\s+Author:\s*(.+?)\s*$/m),
    license: field(/^\s*0\s+!LICENSE\s+(.+?)\s*$/m),
    org: field(/^\s*0\s+!LDRAW_ORG\s+(.+?)\s*$/m),
    editors: [...editors],
  };
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]; // row-major 3x4: a b c x / d e f y / g h i z

function mul(m, n) {
  const r = new Array(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 4 + j] = m[i * 4] * n[j] + m[i * 4 + 1] * n[4 + j] + m[i * 4 + 2] * n[8 + j];
    }
    r[i * 4 + 3] = m[i * 4] * n[3] + m[i * 4 + 1] * n[7] + m[i * 4 + 2] * n[11] + m[i * 4 + 3];
  }
  return r;
}

function det3(m) {
  return m[0] * (m[5] * m[10] - m[6] * m[9])
       - m[1] * (m[4] * m[10] - m[6] * m[8])
       + m[2] * (m[4] * m[9] - m[5] * m[8]);
}

function apply(m, x, y, z) {
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
  ];
}

const refsOf = (lines) => lines
  .map((l) => l.trim().split(/\s+/))
  .filter((t) => t[0] === '1' && t.length >= 15)
  .map((t) => t.slice(14).join(' '));

export class Resolver {
  // local: Map lowercase name -> text (MPD sub-files, uploaded companions);
  // loadLocal: optional async (ref) -> text | null, e.g. files next to a model on disk.
  constructor(library, { hires = false, local = new Map(), loadLocal = null } = {}) {
    this.lib = library;
    this.hires = hires;
    this.local = local;
    this.loadLocal = loadLocal;
    this.cache = new Map(); // name -> lines | null
    this.origin = new Map(); // name -> { rel, source: 'library' | 'local', header }
    this.parts = new Map(); // name -> true when the file is a real part (its own shell)
  }

  // Library path a reference resolves to, without reading it.
  locate(name) {
    const order = ['parts/', 'p/', 'models/', ''];
    if (this.hires && !name.startsWith('48/') && !name.startsWith('8/')) order.splice(1, 0, 'p/48/');
    for (const d of order) {
      // p/48 substitutes only make sense for primitives that exist at both resolutions
      if (d === 'p/48/' && !this.lib.has('p/' + name)) continue;
      if (this.lib.has(d + name)) return { rel: d + name, dir: d };
    }
    return null;
  }

  async load(ref) {
    const name = normName(ref);
    if (this.cache.has(name)) return this.cache.get(name);
    let text = null;
    let found = null;
    if (this.local.has(name)) text = this.local.get(name);
    if (text == null && this.loadLocal) text = await this.loadLocal(ref.trim());
    if (text != null) found = { rel: name, dir: null, source: 'local' };
    else {
      const loc = this.locate(name);
      if (loc) { text = await this.lib.read(loc.rel); found = { ...loc, source: 'library' }; }
    }
    if (text == null) { this.cache.set(name, null); return null; }
    const lines = text.split(/\r?\n/);
    this.cache.set(name, lines);
    const header = parseHeader(text);
    this.origin.set(name, { rel: found.rel, source: found.source, header });
    // a Part is one shell; a Shortcut (e.g. torso with arms) is several parts
    const org = header.org?.match(/^(?:Unofficial_)?(\w+)/)?.[1];
    let part = org ? org === 'Part' : found.dir === 'parts/' && !name.startsWith('s/');
    // some "Part"s are pure aliases/assemblies (970c00 -> 3815c01): no geometry of their
    // own, only references to other parts. Those are not a shell either.
    if (part) {
      const ownGeometry = lines.some((l) => /^\s*[34]\s/.test(l));
      const refs = refsOf(lines).map(normName);
      if (!ownGeometry && refs.length && refs.every((r) => !r.startsWith('s/') && this.lib.has('parts/' + r))) part = false;
    }
    this.parts.set(name, part);
    return lines;
  }

  get(ref) { return this.cache.get(normName(ref)) ?? null; }
  isPart(ref) { return this.parts.get(normName(ref)) === true; }

  // Load everything `lines` references, breadth first, a level at a time in parallel.
  async prefetch(lines, { concurrency = 24 } = {}) {
    let level = refsOf(lines);
    const seen = new Set();
    while (level.length) {
      const todo = [...new Set(level.map(normName))].filter((n) => !seen.has(n) && !this.cache.has(n));
      todo.forEach((n) => seen.add(n));
      const next = [];
      for (let i = 0; i < todo.length; i += concurrency) {
        const batch = await Promise.all(todo.slice(i, i + concurrency).map((n) => this.load(n)));
        for (const sub of batch) if (sub) next.push(...refsOf(sub));
      }
      level = next;
    }
  }

  // Every file that contributed to the model, with what attribution needs.
  usedFiles() {
    return [...this.origin].map(([name, o]) => ({ name, ...o }));
  }
}

// Flatten a model into triangles { c: colourCode, v: [x1,y1,z1, x2,y2,z2, x3,y3,z3] (LDU), p: shell }.
// Everything referenced must already be loaded (Resolver.prefetch).
export function flatten(resolver, lines, { stats = { uncertified: 0 }, missing = new Set(), names = new Map() } = {}) {
  const tris = [];
  let instances = 0;
  const walk = (lines, m, colour, invert, depth, inst) => {
    if (depth > 64) throw new Error('reference depth > 64 (recursive model?)');
    let certified = false;
    let localCW = false;
    let invertNext = false;
    const flipLeaf = det3(m) < 0;
    for (const raw of lines) {
      const t = raw.trim().split(/\s+/);
      if (!t[0]) continue;
      const type = t[0];
      if (type === '0') {
        if (t[1] !== 'BFC') continue;
        const words = t.slice(2);
        if (words.includes('CERTIFY')) certified = !words.includes('NOCERTIFY');
        if (words.includes('NOCERTIFY')) certified = false;
        if (words.includes('CW')) localCW = true;
        if (words.includes('CCW')) localCW = false;
        if (words.includes('INVERTNEXT')) invertNext = true;
        continue;
      }
      const c = t[1] === '16' ? colour : t[1];
      if (type === '1') {
        const n = t.slice(2, 14).map(Number);
        const child = [n[3], n[4], n[5], n[0], n[6], n[7], n[8], n[1], n[9], n[10], n[11], n[2]];
        const ref = t.slice(14).join(' ');
        const sub = resolver.get(ref);
        if (!sub) { missing.add(ref); invertNext = false; continue; }
        const childInst = inst ?? (resolver.isPart(ref) ? ++instances : null);
        if (childInst !== inst) names.set(childInst, ref.replace(/\.dat$/i, ''));
        walk(sub, mul(m, child), c, invert !== invertNext, depth + 1, childInst);
        invertNext = false;
      } else if (type === '3' || type === '4') {
        const p = t.slice(2).map(Number);
        const pts = [];
        for (let i = 0; i < (type === '3' ? 3 : 4); i++) pts.push(apply(m, p[i * 3], p[i * 3 + 1], p[i * 3 + 2]));
        const flip = flipLeaf !== invert !== localCW;
        if (!certified) stats.uncertified++;
        const emit = (a, b, d) => {
          const v = flip ? [...a, ...d, ...b] : [...a, ...b, ...d];
          tris.push({ c, v, p: inst ?? 0 });
        };
        emit(pts[0], pts[1], pts[2]);
        if (type === '4') emit(pts[0], pts[2], pts[3]);
      }
      // types 2 and 5 (edge / conditional lines) have no surface
    }
  };
  walk(lines, IDENTITY, '16', false, 0, null);
  return tris;
}
