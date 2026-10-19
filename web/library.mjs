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

  // Offline: every file read is kept (FILES), and the whole library can be stored (CHUNKS).
  // Both caches are tied to this library build; older ones are dropped.
  const storage = typeof caches !== 'undefined';
  const tag = manifest.zip.sha256.slice(0, 16);
  const FILES = `ldraw-stl-files-${tag}`;
  const CHUNKS = `ldraw-stl-chunks-${tag}`;
  const chunkUrl = (c) => new URL(base + chunks[c].file, location.href).href;
  const fileUrl = (rel) => new URL(`${base}file/${rel}`, location.href).href;
  if (storage) {
    caches.keys().then((names) => Promise.all(names
      .filter((n) => /^ldraw-stl-(files|chunks)-/.test(n) && n !== FILES && n !== CHUNKS)
      .map((n) => caches.delete(n)))).catch(() => {});
  }
  // a stored chunk is read as a Blob, which browsers keep on disk: slicing it reads only the range
  const blobs = new Map();
  const storedChunk = (c) => {
    if (!storage) return Promise.resolve(null);
    if (!blobs.has(c)) {
      blobs.set(c, caches.open(CHUNKS).then((cache) => cache.match(chunkUrl(c))).then((r) => (r ? r.blob() : null)).catch(() => null));
    }
    return blobs.get(c);
  };

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
    const stored = await storedChunk(c);
    if (stored) return new Uint8Array(await stored.slice(s, e).arrayBuffer());
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
      if (!texts.has(rel)) texts.set(rel, readFile(rel));
      return texts.get(rel);
    },
    get usesRanges() { return ranges; },

    // Offline use of the whole library: how much is stored, store it all, or drop it.
    async offlineStatus() {
      if (!storage) return { supported: false };
      const cache = await caches.open(CHUNKS);
      const stored = (await Promise.all(chunks.map((_, c) => cache.match(chunkUrl(c))))).filter(Boolean).length;
      const cachedFiles = (await (await caches.open(FILES)).keys()).length;
      return { supported: true, stored, total: chunks.length, bytes: manifest.zip.bytes, files: cachedFiles };
    },
    async downloadAll(onProgress = () => {}) {
      const cache = await caches.open(CHUNKS);
      await navigator.storage?.persist?.().catch(() => false);
      let done = 0;
      for (let c = 0; c < chunks.length; c++) {
        if (!(await cache.match(chunkUrl(c)))) {
          const r = await fetch(chunkUrl(c), { cache: 'no-store' });
          if (!r.ok) throw new Error(`${chunks[c].file}: HTTP ${r.status}`);
          const body = await r.arrayBuffer();
          if (body.byteLength !== chunks[c].size) throw new Error(`${chunks[c].file}: ${body.byteLength} bytes, expected ${chunks[c].size}`);
          await cache.put(chunkUrl(c), new Response(body, { headers: { 'Content-Type': 'application/octet-stream' } }));
          blobs.delete(c);
        }
        done += chunks[c].size;
        onProgress(done, manifest.zip.bytes);
      }
    },
    async removeOffline() {
      blobs.clear();
      await caches.delete(CHUNKS);
    },
  };

  async function readFile(rel) {
    const cache = storage ? await caches.open(FILES).catch(() => null) : null;
    const hit = await cache?.match(fileUrl(rel));
    if (hit) return hit.text();
    const [start, csize, , method] = files[rel];
    onFetch(rel);
    const data = await bytes(start, start + csize);
    const text = new TextDecoder().decode(method === 8 ? await inflateRaw(data) : data);
    cache?.put(fileUrl(rel), new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })).catch(() => {});
    return text;
  }
}
