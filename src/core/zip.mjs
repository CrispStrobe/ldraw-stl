// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Minimal zip reading and writing (no zip64), enough for 3MF packages and the library mirror.
// Compression is injected: zlib in Node, CompressionStream in browsers.

const encoder = new TextEncoder();
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// entries: [name, string | Uint8Array]; deflateRaw: optional (Uint8Array) -> Uint8Array | Promise.
// Without it entries are stored, which every zip/3MF reader accepts.
export async function createZip(entries, deflateRaw = null) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const data = typeof content === 'string' ? encoder.encode(content) : content;
    const packed = deflateRaw ? await deflateRaw(data) : data;
    const method = deflateRaw ? 8 : 0;
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const local = new Uint8Array(30);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, method, true);
    lv.setUint16(12, 0x21, true); // 1980-01-01: reproducible output
    lv.setUint32(14, crc, true);
    lv.setUint32(18, packed.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    const dir = new Uint8Array(46);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(10, method, true);
    dv.setUint16(14, 0x21, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, packed.length, true);
    dv.setUint32(24, data.length, true);
    dv.setUint16(28, nameBytes.length, true);
    dv.setUint32(42, offset, true);
    parts.push(local, nameBytes, packed);
    central.push(dir, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return concat([...parts, ...central, end]);
}

export function concat(chunks) {
  const out = new Uint8Array(chunks.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of chunks) { out.set(b, o); o += b.length; }
  return out;
}

// Central directory of a zip held in memory: name -> { method, csize, usize, local, dataStart, crc }.
export function readZipDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = new Map();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('bad zip central directory');
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const csize = view.getUint32(p + 20, true);
    const usize = view.getUint32(p + 24, true);
    const nlen = view.getUint16(p + 28, true);
    const elen = view.getUint16(p + 30, true);
    const clen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nlen));
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (!name.endsWith('/')) entries.set(name, { method, crc, csize, usize, local, dataStart });
    p += 46 + nlen + elen + clen;
  }
  return entries;
}
