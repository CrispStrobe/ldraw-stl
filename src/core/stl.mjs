// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Binary STL out, binary or ASCII STL in. Units are whatever the caller uses (here: mm).

import { normal } from './mesh.mjs';

export function shellTriangles(shells) {
  const out = [];
  for (const { mesh } of shells) for (const [a, b, c] of mesh.faces) out.push({ v: [...mesh.verts[a], ...mesh.verts[b], ...mesh.verts[c]] });
  return out;
}

export function encodeStl(tris, label = '') {
  const bytes = new Uint8Array(84 + 50 * tris.length);
  const view = new DataView(bytes.buffer);
  const head = label.slice(0, 80);
  for (let i = 0; i < head.length; i++) bytes[i] = head.charCodeAt(i) & 0x7f;
  view.setUint32(80, tris.length, true);
  let o = 84;
  for (const { v } of tris) {
    const n = normal(v) || [0, 0, 0];
    for (let i = 0; i < 3; i++) view.setFloat32(o + i * 4, n[i], true);
    for (let i = 0; i < 9; i++) view.setFloat32(o + 12 + i * 4, v[i], true);
    o += 50;
  }
  return bytes;
}

export function decodeStl(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tris = [];
  if (bytes.length >= 84 && 84 + 50 * view.getUint32(80, true) === bytes.length) {
    const n = view.getUint32(80, true);
    for (let i = 0, o = 84; i < n; i++, o += 50) {
      const v = new Array(9);
      for (let j = 0; j < 9; j++) v[j] = view.getFloat32(o + 12 + j * 4, true);
      tris.push({ c: '16', v });
    }
    return tris;
  }
  const text = new TextDecoder().decode(bytes);
  const nums = [];
  for (const m of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) {
    nums.push(+m[1], +m[2], +m[3]);
    if (nums.length === 9) tris.push({ c: '16', v: nums.splice(0, 9) });
  }
  return tris;
}
