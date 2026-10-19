// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The LDraw library mirror published next to the app (scripts/build-library.mjs): one zip cut
// into chunks. Single files are fetched with HTTP range requests and inflated in the browser.
// If a server ignores Range, whole chunks are fetched once and kept in memory.

export async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

export async function openMirror(base = './library/', { onFetch = () => {} } = {}) {
  const json = async (file) => {
    const r = await fetch(base + file);
    if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
    return r.json();
  };
  const [manifest, files] = await Promise.all([json('manifest.json'), json('files.json')]);
  const { chunkSize, chunks } = manifest;
  const whole = new Map();
  const texts = new Map();
  let ranges = null; // null: unknown yet, true: server answers 206, false: it does not

  const wholeChunk = (c) => {
    if (!whole.has(c)) {
      whole.set(c, fetch(base + chunks[c].file).then((r) => {
        if (!r.ok) throw new Error(`${chunks[c].file}: HTTP ${r.status}`);
        return r.arrayBuffer();
      }).then((b) => new Uint8Array(b)));
    }
    return whole.get(c);
  };

  async function slice(c, s, e) {
    if (ranges !== false) {
      const r = await fetch(base + chunks[c].file, { headers: { Range: `bytes=${s}-${e - 1}` } });
      if (r.status === 206) { ranges = true; return new Uint8Array(await r.arrayBuffer()); }
      if (!r.ok) throw new Error(`${chunks[c].file}: HTTP ${r.status}`);
      ranges = false;
      const all = new Uint8Array(await r.arrayBuffer());
      whole.set(c, Promise.resolve(all));
      return all.subarray(s, e);
    }
    return (await wholeChunk(c)).subarray(s, e);
  }

  async function bytes(start, end) {
    const parts = [];
    for (let c = Math.floor(start / chunkSize); c * chunkSize < end; c++) {
      const s = Math.max(start, c * chunkSize) - c * chunkSize;
      const e = Math.min(end, (c + 1) * chunkSize) - c * chunkSize;
      parts.push(await slice(c, s, e));
    }
    return parts.length === 1 ? parts[0] : concat(parts);
  }

  return {
    manifest,
    has: (rel) => Object.prototype.hasOwnProperty.call(files, rel),
    read(rel) {
      if (!texts.has(rel)) {
        const [start, csize, , method] = files[rel];
        onFetch(rel);
        texts.set(rel, bytes(start, start + csize)
          .then((data) => (method === 8 ? inflateRaw(data) : data))
          .then((data) => new TextDecoder().decode(data)));
      }
      return texts.get(rel);
    },
    get usesRanges() { return ranges; },
  };
}
